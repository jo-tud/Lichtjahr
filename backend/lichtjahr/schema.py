"""Projektformat (Manifest ``lichtjahr.json``), Schema-Version 1.

Fotos werden streng beschrieben; der Gestaltungsstand (Seiten, Rahmen, Kalendarium) gehört dem Editor und
wird hier als JSON-Objekt mitgeführt, damit Editor und Dienst unabhängig weiterentwickelt werden können.
Zugangsdaten werden niemals im Manifest gespeichert.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = 1
MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
PHOTO_DIR = "Fotos"
NO_MONTH_DIR = "Ohne Monat"
EXPORT_DIR = "Export"
MANIFEST = "lichtjahr.json"
META_DIR = ".lichtjahr"


def month_dir(month: int | None) -> str:
    """Ordner eines Monats, z. B. ``Fotos/03 März``; ``None`` ist ``Fotos/Ohne Monat``."""
    if month is None:
        return f"{PHOTO_DIR}/{NO_MONTH_DIR}"
    return f"{PHOTO_DIR}/{month + 1:02d} {MONTHS[month]}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Format(BaseModel):
    id: str = "sq297"
    widthMm: float = 297
    heightMm: float = 297
    bleedMm: float = 3


class Asset(BaseModel):
    id: str = Field(default_factory=lambda: "a_" + uuid.uuid4().hex[:12])
    path: str                                   # relativ zum Projektordner
    month: int | None = None                    # 0–11, None = ohne Monat
    suggestedMonth: int | None = None           # aus Aufnahmedatum oder Dateiname, nur ein Vorschlag
    contentHash: str
    size: int
    mtimeNs: int
    widthPx: int = 0
    heightPx: int = 0
    captureDate: str | None = None
    caption: str = ""
    rating: int = 0
    favorite: bool = False
    copyOf: str | None = None
    status: Literal["ok", "missing", "changed"] = "ok"
    added: str = Field(default_factory=now_iso)


class Manifest(BaseModel):
    schemaVersion: int = SCHEMA_VERSION
    id: str = Field(default_factory=lambda: "p_" + uuid.uuid4().hex[:12])
    title: str = "Familienkalender"
    calendarYear: int
    sourceYear: int
    format: Format = Field(default_factory=Format)
    printerProfileId: str | None = None
    revision: int = 0
    updated: str = Field(default_factory=now_iso)
    assets: list[Asset] = Field(default_factory=list)
    editor: dict[str, Any] = Field(default_factory=dict)   # Gestaltungsstand des Editors (doc, pages, …)

    def asset(self, asset_id: str) -> Asset | None:
        return next((a for a in self.assets if a.id == asset_id), None)
