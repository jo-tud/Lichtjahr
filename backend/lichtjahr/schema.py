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
# Ordnernamen in der Sprache des Projekts (beim Anlegen festgelegt; ältere Projekte sind deutsch)
MONTH_NAMES = {
    "de": ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
}
PHOTO_DIRS = {"de": "Fotos", "en": "Photos"}
NO_MONTH_DIRS = {"de": "Ohne Monat", "en": "No month"}
MONTHS = MONTH_NAMES["de"]
PHOTO_DIR = PHOTO_DIRS["de"]
NO_MONTH_DIR = NO_MONTH_DIRS["de"]
EXPORT_DIR = "Export"
MANIFEST = "lichtjahr.json"
META_DIR = ".lichtjahr"


def lang_of(lang: str | None) -> str:
    return lang if lang in PHOTO_DIRS else "de"


def month_dir(month: int | None, lang: str | None = "de") -> str:
    """Ordner eines Monats, z. B. ``Fotos/03 März`` bzw. ``Photos/03 March``; ``None`` ist „ohne Monat“."""
    lang = lang_of(lang)
    if month is None:
        return f"{PHOTO_DIRS[lang]}/{NO_MONTH_DIRS[lang]}"
    return f"{PHOTO_DIRS[lang]}/{month + 1:02d} {MONTH_NAMES[lang][month]}"


def folders(lang: str | None) -> dict:
    """Ordnernamen eines Projekts, z. B. für die Anzeige in der Oberfläche."""
    lang = lang_of(lang)
    return {"photos": PHOTO_DIRS[lang], "months": [f"{m + 1:02d} {n}" for m, n in enumerate(MONTH_NAMES[lang])],
            "noMonth": NO_MONTH_DIRS[lang], "export": EXPORT_DIR}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Format(BaseModel):
    id: str = "sq297"
    widthMm: float = 297
    heightMm: float = 297
    bleedMm: float = 3


class Asset(BaseModel):
    id: str = Field(default_factory=lambda: "a_" + uuid.uuid4().hex[:12], pattern=r"^a_[0-9a-f]{12}$")
    path: str                                   # relativ zum Projektordner
    month: int | None = Field(default=None, ge=0, le=11)            # None = ohne Monat
    suggestedMonth: int | None = Field(default=None, ge=0, le=11)   # aus Aufnahmedatum oder Dateiname, nur ein Vorschlag
    contentHash: str = Field(pattern=r"^[0-9a-f]{64}$")   # SHA-256; landet in Pfaden des Zwischenspeichers
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
    excluded: bool = False                      # in der App aussortiert; die Datei bleibt, wo sie ist
    added: str = Field(default_factory=now_iso)


class Manifest(BaseModel):
    schemaVersion: int = SCHEMA_VERSION
    id: str = Field(default_factory=lambda: "p_" + uuid.uuid4().hex[:12], pattern=r"^p_[0-9a-f]{12}$")   # Name des Cache-Ordners
    title: str = "Familienkalender"
    language: str = "de"                                   # Sprache der Ordnernamen („de“ oder „en“)
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
