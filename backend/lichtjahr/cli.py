"""Befehlszeile: ``lichtjahr serve`` startet den Dienst, ``lichtjahr init`` legt ein Projekt an."""

from __future__ import annotations

import argparse
import ipaddress
import os
import secrets
import sys
from datetime import date
from urllib.parse import urlencode

from . import __version__
from .i18n import _t, set_lang, system_lang


def _repo_static() -> str | None:
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in (os.path.join(here, "static"), os.path.join(here, "..", "..", "prototyp", "dist")):
        if os.path.isfile(os.path.join(candidate, "index.html")):
            return os.path.abspath(candidate)
    return None


def _is_loopback(host: str) -> bool:
    if host in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _lan_ip() -> str | None:
    """Adresse dieses Rechners im Heimnetz (für den Link aufs Handy). Es wird nichts gesendet."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))                  # Dokumentationsadresse, nur zur Routenwahl
            ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


def _url_host(host: str, for_browser: bool = False) -> str:
    """Rechnername für Adressen: localhost für diesen Rechner, sonst die Bind-Adresse (IPv6 in Klammern)."""
    if host in ("", "localhost", "127.0.0.1", "0.0.0.0", "::"):
        if host in ("0.0.0.0", "::") and not for_browser:
            return _lan_ip() or "localhost"
        return "localhost"
    return f"[{host}]" if ":" in host else host


def _probe(host: str, port: int) -> dict | None:
    """Antwort von /api/health, wenn dort Lichtjahr läuft, sonst None."""
    import json
    import urllib.request
    target = "127.0.0.1" if host in ("", "localhost", "0.0.0.0") else "::1" if host == "::" else host
    target = f"[{target}]" if ":" in target else target
    try:
        with urllib.request.urlopen(f"http://{target}:{port}/api/health", timeout=1.5) as r:
            data = json.loads(r.read().decode("utf-8"))
        return data if isinstance(data, dict) and data.get("ok") else None
    except Exception:                                 # nichts oder ein anderes Programm
        return None


def _bind(host: str, port: int):
    """Socket auf host:port binden und lauschen lassen; None, wenn der Port belegt ist. Der Dienst übernimmt
    genau diesen Socket, damit zwischen Prüfen und Starten niemand anderes den Port nehmen kann.
    Andere Fehler (Adresse gibt es auf diesem Rechner nicht, kein IPv6) gehen als OSError weiter."""
    import errno
    import socket
    if not 0 < port < 65536:
        return None
    bind = "" if host == "0.0.0.0" else host
    family = socket.AF_INET6 if ":" in bind else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    try:
        if os.name == "nt":                           # nicht teilen: kein zweites Programm auf demselben Port
            sock.setsockopt(socket.SOL_SOCKET, getattr(socket, "SO_EXCLUSIVEADDRUSE", socket.SO_REUSEADDR), 1)
        else:                                         # wie uvicorn: Neustart direkt nach dem Beenden möglich
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((bind, port))
        sock.listen(128)
        sock.set_inheritable(True)
        return sock
    except OSError as e:
        sock.close()
        if e.errno in (errno.EADDRINUSE, errno.EACCES) or getattr(e, "winerror", None) in (10048, 10013):
            return None
        raise


class _Running:
    """Die laufende Instanz in diesem Datenordner (running.json, nur für den Besitzer lesbar, enthält den
    Zugriffsschlüssel). So öffnet ein zweiter Start dieselbe Adresse, statt einen zweiten Dienst zu starten."""

    def __init__(self, data_dir: str) -> None:
        self.path = os.path.join(data_dir, "running.json")

    def read(self) -> dict:
        import json
        try:
            with open(self.path, encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def write(self, info: dict) -> None:
        import json
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = f"{self.path}.{os.getpid()}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(info, fh)
        os.replace(tmp, self.path)

    def clear(self, instance: str) -> None:
        if self.read().get("instance") == instance:
            try:
                os.remove(self.path)
            except OSError:
                pass

    def find(self) -> tuple[dict, dict] | None:
        """(running.json, Health) der Instanz dieses Datenordners, wenn sie noch antwortet – auf welchem Port
        auch immer sie läuft (sie kann einem belegten Port ausgewichen sein)."""
        info = self.read()
        port = info.get("port")
        if not isinstance(port, int):
            return None
        health = _probe(info.get("host", "127.0.0.1"), port)
        if health and health.get("instance") == info.get("instance"):
            return info, health
        return None


def _open_when_started(server, url: str) -> None:
    """Browser öffnen, sobald uvicorn wirklich lauscht (im Hintergrund)."""
    import threading
    import time
    import webbrowser

    def wait() -> None:
        for _ in range(300):
            if getattr(server, "started", False):
                webbrowser.open(url)
                return
            if getattr(server, "should_exit", False):
                return
            time.sleep(.1)
    threading.Thread(target=wait, daemon=True).start()


def _run_server(app, sock, browser_url: str | None) -> None:
    import uvicorn
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
    if browser_url:
        _open_when_started(server, browser_url)
    server.run(sockets=[sock])


def cmd_serve(args: argparse.Namespace) -> int:
    import webbrowser

    from .api import create_app
    from .config import Settings

    token = args.token
    settings = Settings.default(args.data_dir, args.cache_dir, token)
    running = _Running(settings.data_dir)
    query = {}
    if args.path:                                    # Projekt gleich öffnen: in die Liste aufnehmen
        from .config import Registry
        from .project import Project, ProjectError
        from .storage import LocalStorage
        try:
            s = Project.open(LocalStorage(args.path), "").summary()
        except ProjectError as e:
            print(_t("{path}: {error}  Neues Projekt mit „lichtjahr init {path}“ anlegen.", path=args.path, error=e), file=sys.stderr)
            return 1
        Registry(settings).remember({"id": s["id"], "title": s["title"], "calendarYear": s["calendarYear"], "storage": s["storage"]})
        query["projekt"] = s["id"]
        print(_t("Projekt: {title} {year} ({location})", title=s["title"], year=s["calendarYear"], location=s["storage"]["location"]))

    # Zuerst nach der eigenen Instanz sehen (vor dem Binden: unter macOS gelänge das Binden an 127.0.0.1 auch
    # neben einer Instanz, die auf allen Adressen lauscht)
    mine = running.find()
    if mine:                                         # schon gestartet (z. B. zweimal doppelgeklickt): dorthin
        info, health = mine
        if health.get("version") != __version__:
            print(_t("Lichtjahr {version} läuft noch in einem anderen Fenster. Bitte dort beenden und dann neu starten.",
                     version=health.get("version", "?")), file=sys.stderr)
            return 1
        q = dict(query)
        if info.get("token"):
            q["token"] = info["token"]
        url = f"http://{_url_host(info.get('host', args.host), True)}:{info['port']}/"
        print(_t("Lichtjahr {version} läuft bereits: {url}", version=__version__, url=url))
        if not args.no_browser:
            webbrowser.open(url + ("?" + urlencode(q) if q else ""))
        return 0
    try:
        port, sock = args.port, None
        for port in range(args.port, min(args.port + 20, 65536)):      # belegt: die nächsten freien probieren
            sock = _bind(args.host, port)
            if sock:
                break
    except OSError as e:
        print(_t("Die Adresse {host} lässt sich auf diesem Rechner nicht nutzen: {error}", host=args.host, error=e.strerror or e), file=sys.stderr)
        return 1
    if sock is None:
        print(_t("Port {port} ist belegt, und kein freier in der Nähe gefunden. Mit --port einen anderen wählen.", port=args.port), file=sys.stderr)
        return 1
    if port != args.port:
        print(_t("Port {old} ist belegt, Lichtjahr nimmt {new}.", old=args.port, new=port))

    if not _is_loopback(args.host) and not token:
        token = settings.token = secrets.token_urlsafe(16)
        print(_t("Hinweis: Der Dienst ist im Netz erreichbar ({host}). Zugriff nur mit Schlüssel.", host=args.host))
    if token:
        query["token"] = token
    app = create_app(settings, static_dir=args.static or _repo_static())
    suffix = "?" + urlencode(query) if query else ""
    shown = _url_host(args.host)
    print(_t("Lichtjahr {version} läuft: {url}", version=__version__, url=f"http://{shown}:{port}/{suffix}"))
    if not _is_loopback(args.host):
        print(_t("Diese Adresse (mit Schlüssel) auf dem Handy öffnen; sie gilt nur in eurem Netz."))
    print(_t("API-Dokumentation: {url}", url=f"http://{shown}:{port}/api/docs"))
    print(_t("Dieses Fenster offen lassen, solange du am Kalender arbeitest. Beenden mit Strg+C oder Fenster schließen."))
    running.write({"instance": settings.instance, "pid": os.getpid(), "host": args.host, "port": port,
                   "token": token, "version": __version__})
    try:
        _run_server(app, sock, None if args.no_browser else f"http://{_url_host(args.host, True)}:{port}/{suffix}")
    except KeyboardInterrupt:
        pass
    finally:
        running.clear(settings.instance)
        sock.close()
    return 0


def cmd_init(args: argparse.Namespace) -> int:
    from .config import Registry, Settings
    from .project import Project
    from .storage import LocalStorage

    storage = LocalStorage(args.path)
    os.makedirs(storage.root, exist_ok=True)
    settings = Settings.default(args.data_dir, args.cache_dir)
    lang = args.language or system_lang()
    title = args.title or _t("Familienkalender")
    p = Project.create(storage, "", title=title, calendar_year=args.year, source_year=args.source_year or args.year - 1, language=lang)
    s = p.summary()
    Registry(settings).remember({"id": s["id"], "title": s["title"], "calendarYear": s["calendarYear"], "storage": s["storage"]})
    print(_t("Projekt „{title}“ für {year} angelegt in {root}", title=title, year=args.year, root=storage.root))
    print(_t("Fotos in die Monatsordner unter {photos}/ legen oder später in der App hinzufügen.", photos=s["storage"]["folders"]["photos"]))
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="lichtjahr", description="Lokaler Dienst für den Familien-Fotokalender.")
    parser.add_argument("--version", action="version", version=f"lichtjahr {__version__}")
    parser.add_argument("--data-dir", help="Ort für Projektliste und Entwürfe (Standard je nach Betriebssystem, siehe README)")
    parser.add_argument("--cache-dir", help="Ort für Vorschaubilder (Standard je nach Betriebssystem)")
    sub = parser.add_subparsers(dest="cmd")

    s = sub.add_parser("serve", help="Dienst starten (Standard: nur auf diesem Rechner erreichbar)")
    s.add_argument("path", nargs="?", help="Projektordner, der beim Start gleich geöffnet wird")
    s.add_argument("--host", default="127.0.0.1", help="Bind-Adresse; 0.0.0.0 für Zugriff aus dem Heimnetz")
    s.add_argument("--port", type=int, default=8470)
    s.add_argument("--token", help="Zugriffsschlüssel; wird bei Netzzugriff automatisch erzeugt")
    s.add_argument("--static", help="Ordner mit der Oberfläche (Standard: im Paket bzw. prototyp/dist)")
    s.add_argument("--no-browser", action="store_true", help="Browser nicht automatisch öffnen")
    s.set_defaults(func=cmd_serve)

    i = sub.add_parser("init", help="Neues Projekt in einem Ordner anlegen")
    i.add_argument("path")
    i.add_argument("--year", type=int, default=date.today().year + 1, help="Kalenderjahr (Standard: nächstes Jahr)")
    i.add_argument("--source-year", type=int, help="Jahr, aus dem die Fotos stammen (Standard: Kalenderjahr − 1)")
    i.add_argument("--title", help="Titel (Standard: „Family Calendar“ bzw. „Familienkalender“)")
    i.add_argument("--language", choices=["en", "de"], help="Sprache der Ordnernamen (Standard: Systemsprache)")
    i.set_defaults(func=cmd_init)

    for stream in (sys.stdout, sys.stderr):           # Umlaute und Pfeile auch in alten Windows-Konsolen
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    set_lang(system_lang())
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        args = parser.parse_args(["serve", *(argv or sys.argv[1:])])
    sys.exit(args.func(args))
