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


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .api import create_app
    from .config import Settings

    token = args.token
    if not _is_loopback(args.host) and not token:
        token = secrets.token_urlsafe(16)
        print(f"Hinweis: Der Dienst ist im Netz erreichbar ({args.host}). Zugriff nur mit Schlüssel.")
    settings = Settings.default(args.data_dir, args.cache_dir, token)
    query = {}
    if args.path:                                    # Projekt gleich öffnen: in die Liste aufnehmen
        from .config import Registry
        from .project import Project, ProjectError
        from .storage import LocalStorage
        try:
            s = Project.open(LocalStorage(args.path), "").summary()
        except ProjectError as e:
            print(f"{args.path}: {e}  Neues Projekt mit „lichtjahr init {args.path}“ anlegen.", file=sys.stderr)
            return 1
        Registry(settings).remember({"id": s["id"], "title": s["title"], "calendarYear": s["calendarYear"], "storage": s["storage"]})
        query["projekt"] = s["id"]
        print(f"Projekt: {s['title']} {s['calendarYear']} ({s['storage']['location']})")
    if token:
        query["token"] = token
    app = create_app(settings, static_dir=args.static or _repo_static())
    shown = "localhost" if _is_loopback(args.host) else args.host
    if shown in ("0.0.0.0", "::"):
        shown = _lan_ip() or "localhost"
    url = f"http://{shown}:{args.port}/" + ("?" + urlencode(query) if query else "")
    print(f"Lichtjahr {__version__} läuft: {url}")
    if not _is_loopback(args.host):
        print("Diese Adresse (mit Schlüssel) auf dem Handy öffnen; sie gilt nur in eurem Netz.")
    print(f"API-Dokumentation: http://{shown}:{args.port}/api/docs")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


def cmd_init(args: argparse.Namespace) -> int:
    from .config import Registry, Settings
    from .project import Project
    from .storage import LocalStorage

    storage = LocalStorage(args.path)
    os.makedirs(storage.root, exist_ok=True)
    settings = Settings.default(args.data_dir, args.cache_dir)
    p = Project.create(storage, "", title=args.title, calendar_year=args.year, source_year=args.source_year or args.year - 1)
    s = p.summary()
    Registry(settings).remember({"id": s["id"], "title": s["title"], "calendarYear": s["calendarYear"], "storage": s["storage"]})
    print(f"Projekt „{args.title}“ für {args.year} angelegt in {storage.root}")
    print("Fotos in die Monatsordner unter Fotos/ legen oder später in der App hinzufügen.")
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="lichtjahr", description="Lokaler Dienst für den Familien-Fotokalender.")
    parser.add_argument("--version", action="version", version=f"lichtjahr {__version__}")
    parser.add_argument("--data-dir", help="Ort für Projektliste und Entwürfe (Standard: ~/.local/share/lichtjahr)")
    parser.add_argument("--cache-dir", help="Ort für Vorschaubilder (Standard: ~/.cache/lichtjahr)")
    sub = parser.add_subparsers(dest="cmd")

    s = sub.add_parser("serve", help="Dienst starten (Standard: nur auf diesem Rechner erreichbar)")
    s.add_argument("path", nargs="?", help="Projektordner, der beim Start gleich geöffnet wird")
    s.add_argument("--host", default="127.0.0.1", help="Bind-Adresse; 0.0.0.0 für Zugriff aus dem Heimnetz")
    s.add_argument("--port", type=int, default=8470)
    s.add_argument("--token", help="Zugriffsschlüssel; wird bei Netzzugriff automatisch erzeugt")
    s.add_argument("--static", help="Ordner mit der Oberfläche (Standard: prototyp/dist)")
    s.set_defaults(func=cmd_serve)

    i = sub.add_parser("init", help="Neues Projekt in einem Ordner anlegen")
    i.add_argument("path")
    i.add_argument("--year", type=int, default=date.today().year + 1, help="Kalenderjahr (Standard: nächstes Jahr)")
    i.add_argument("--source-year", type=int, help="Jahr, aus dem die Fotos stammen (Standard: Kalenderjahr − 1)")
    i.add_argument("--title", default="Familienkalender")
    i.set_defaults(func=cmd_init)

    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        args = parser.parse_args(["serve", *(argv or sys.argv[1:])])
    sys.exit(args.func(args))
