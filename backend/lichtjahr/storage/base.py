"""Gemeinsame Schnittstelle aller Speicherorte.

Pfade sind immer relativ zum Projektordner und verwenden ``/`` als Trenner. Für Sperre und Manifest
braucht es zwei atomare Grundoperationen, die jeder Adapter verlässlich anbieten muss:

* ``create_exclusive`` – Datei nur anlegen, wenn sie noch nicht existiert
* ``replace`` mit ``if_match`` – Datei nur ersetzen, wenn ihr Inhalt (ETag) unverändert ist

Ein Adapter, der das nicht garantieren kann, darf keine Sperre vortäuschen.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, Protocol


class StorageError(Exception):
    """Basisklasse für Fehler des Speichers."""


class NotFound(StorageError):
    pass


class AlreadyExists(StorageError):
    pass


class Conflict(StorageError):
    """Die Datei wurde zwischenzeitlich verändert (ETag passt nicht)."""


@dataclass(frozen=True)
class Entry:
    path: str          # relativ zum Projektordner
    size: int
    mtime_ns: int
    is_dir: bool = False


class Storage(Protocol):
    kind: str

    def describe(self) -> str: ...
    def exists(self, path: str) -> bool: ...
    def stat(self, path: str) -> Entry: ...
    def age(self, path: str) -> float: ...  # Sekunden seit dem letzten Schreiben, gemessen mit der Uhr des Speichers
    def walk(self, prefix: str) -> Iterator[Entry]: ...
    def read(self, path: str) -> tuple[bytes, str]: ...
    def open_read(self, path: str): ...
    def local_path(self, path: str) -> str | None: ...
    def write(self, path: str, data: bytes) -> str: ...
    def create_exclusive(self, path: str, data: bytes) -> str: ...
    def replace(self, path: str, data: bytes, if_match: str | None) -> str: ...
    def delete(self, path: str, if_match: str | None = None) -> None: ...
    def move(self, src: str, dst: str) -> None: ...
    def copy(self, src: str, dst: str) -> None: ...
    def makedirs(self, path: str) -> None: ...
