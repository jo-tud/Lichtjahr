"""Orte auf dem eigenen Rechner: Liste der bekannten Projekte, Vorschau-Cache, Entwürfe.

Nichts davon liegt im Projektordner. Standard je Betriebssystem:

- Linux (XDG): ``~/.local/share/lichtjahr`` (Daten) und ``~/.cache/lichtjahr`` (Vorschaubilder)
- macOS: ``~/Library/Application Support/Lichtjahr`` und ``~/Library/Caches/Lichtjahr``
- Windows: ``%LOCALAPPDATA%\\Lichtjahr`` und ``%LOCALAPPDATA%\\Lichtjahr\\Cache``

Wer schon einen Datenordner am Linux-Ort hat (frühere Versionen nutzten ihn überall), behält ihn.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
from dataclasses import dataclass, field


def _xdg(var: str, fallback: str) -> str:
    return os.environ.get(var) or os.path.expanduser(fallback)


def default_dirs(platform: str | None = None) -> tuple[str, str]:
    """(Datenordner, Cache-Ordner) für dieses Betriebssystem."""
    platform = platform or sys.platform
    xdg = (os.path.join(_xdg("XDG_DATA_HOME", "~/.local/share"), "lichtjahr"),
           os.path.join(_xdg("XDG_CACHE_HOME", "~/.cache"), "lichtjahr"))
    if platform.startswith("linux") or "XDG_DATA_HOME" in os.environ or os.path.isdir(xdg[0]):
        return xdg
    if platform == "darwin":
        lib = os.path.expanduser("~/Library")
        return os.path.join(lib, "Application Support", "Lichtjahr"), os.path.join(lib, "Caches", "Lichtjahr")
    if platform == "win32":
        base = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/AppData/Local"), "Lichtjahr")
        return base, os.path.join(base, "Cache")
    return xdg


@dataclass
class Settings:
    data_dir: str
    cache_dir: str
    token: str | None = None
    instance: str = field(default_factory=lambda: secrets.token_hex(8))   # erkennt die eigene laufende Instanz

    @classmethod
    def default(cls, data_dir: str | None = None, cache_dir: str | None = None, token: str | None = None) -> "Settings":
        data, cache = default_dirs()
        return cls(data_dir=data_dir or data, cache_dir=cache_dir or cache, token=token)


class Registry:
    """Bekannte Projekte dieses Rechners (Titel und Speicherort), ohne Zugangsdaten."""

    def __init__(self, settings: Settings) -> None:
        self.path = os.path.join(settings.data_dir, "projects.json")

    def all(self) -> list[dict]:
        try:
            with open(self.path, encoding="utf-8") as fh:
                return json.load(fh)
        except (FileNotFoundError, ValueError):
            return []

    def remember(self, entry: dict) -> None:
        items = [e for e in self.all() if e.get("id") != entry["id"]]
        items.insert(0, entry)
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(items, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    def get(self, project_id: str) -> dict | None:
        return next((e for e in self.all() if e.get("id") == project_id), None)

    def forget(self, project_id: str) -> None:
        items = [e for e in self.all() if e.get("id") != project_id]
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(items, fh, ensure_ascii=False, indent=2)


class Credentials:
    """Zugangsdaten für WebDAV-Projekte, nur auf diesem Rechner: ``credentials.json`` im Datenordner mit
    Rechten 0600. Nie im Manifest, nie in der Projektliste, nie im Browser. Empfohlen ist ein
    App-Passwort (in Nextcloud unter Einstellungen → Sicherheit), das sich jederzeit widerrufen lässt."""

    def __init__(self, settings: Settings) -> None:
        self.path = os.path.join(settings.data_dir, "credentials.json")

    def _all(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as fh:
                return json.load(fh)
        except (FileNotFoundError, ValueError):
            return {}

    def get(self, location: str) -> dict:
        return self._all().get(location, {})

    def set(self, location: str, username: str, password: str) -> None:
        items = self._all()
        items[location] = {"username": username, "password": password}
        self._write(items)

    def forget(self, location: str) -> None:
        items = self._all()
        if items.pop(location, None) is not None:
            self._write(items)

    def _write(self, items: dict) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)   # von Anfang an nur für den Besitzer lesbar
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(items, fh, indent=2)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)
