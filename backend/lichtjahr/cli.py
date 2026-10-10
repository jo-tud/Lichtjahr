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


def _lichtjahr_at(port: int) -> str | None:
    """Läuft auf diesem Port schon Lichtjahr? Dann dessen Version, sonst None."""
    import json
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1.5) as r:
            data = json.loads(r.read().decode("utf-8"))
        return str(data.get("version", "?")) if data.get("ok") else None
    except Exception:                                 # nichts oder ein anderes Programm
        return None


def _port_free(host: str, port: int) -> bool:
    import socket
    bind = "" if host in ("0.0.0.0", "::") else host
    family = socket.AF_INET6 if ":" in bind else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as s:
        if os.name != "nt":                           # wie uvicorn; unter Windows hieße das „Port teilen“
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((bind, port))
            return True
        except OSError:
            return False


def _open_when_ready(url: str, port: int) -> None:
    """Browser öffnen, sobald der Dienst antwortet (im Hintergrund, damit uvicorn starten kann)."""
    import threading
    import time
    import webbrowser

    def wait() -> None:
        for _ in range(100):
            if _lichtjahr_at(port):
                webbrowser.open(url)
                return
            time.sleep(.2)
    threading.Thread(target=wait, daemon=True).start()


def cmd_serve(args: argparse.Namespace) -> int:
    import webbrowser

    import uvicorn

    from .api import create_app
    from .config import Settings

    token = args.token
    if not _is_loopback(args.host) and not token:
        token = secrets.token_urlsafe(16)
        print(_t("Hinweis: Der Dienst ist im Netz erreichbar ({host}). Zugriff nur mit Schlüssel.", host=args.host))
    settings = Settings.default(args.data_dir, args.cache_dir, token)
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
    if token:
        query["token"] = token
    port = args.port
    if not _port_free(args.host, port):
        running = _lichtjahr_at(port)
        if running and _is_loopback(args.host) and not args.path:
            url = f"http://localhost:{port}/"         # schon gestartet, z. B. zweimal doppelgeklickt
            print(_t("Lichtjahr {version} läuft bereits: {url}", version=running, url=url))
            if not args.no_browser:
                webbrowser.open(url)
            return 0
        port = next((p for p in range(args.port + 1, args.port + 20) if _port_free(args.host, p)), 0)
        if not port:
            print(_t("Port {port} ist belegt, und kein freier in der Nähe gefunden. Mit --port einen anderen wählen.", port=args.port), file=sys.stderr)
            return 1
        print(_t("Port {old} ist belegt, Lichtjahr nimmt {new}.", old=args.port, new=port))
    app = create_app(settings, static_dir=args.static or _repo_static())
    shown = "localhost" if _is_loopback(args.host) else args.host
    if shown in ("0.0.0.0", "::"):
        shown = _lan_ip() or "localhost"
    url = f"http://{shown}:{port}/" + ("?" + urlencode(query) if query else "")
    print(_t("Lichtjahr {version} läuft: {url}", version=__version__, url=url))
    if not _is_loopback(args.host):
        print(_t("Diese Adresse (mit Schlüssel) auf dem Handy öffnen; sie gilt nur in eurem Netz."))
    print(_t("API-Dokumentation: {url}", url=f"http://{shown}:{port}/api/docs"))
    print(_t("Dieses Fenster offen lassen, solange du am Kalender arbeitest. Beenden mit Strg+C oder Fenster schließen."))
    if not args.no_browser:
        local = f"http://localhost:{port}/" + ("?" + urlencode(query) if query else "")
        _open_when_ready(local, port)
    try:
        uvicorn.run(app, host=args.host, port=port, log_level="warning")
    except KeyboardInterrupt:
        pass
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
