"""Fotos lesen: Prüfsumme, Größe, Aufnahmedatum, Monat aus Ordner- oder Dateiname, Vorschaubilder."""

from __future__ import annotations

import hashlib
import io
import os
import re
from datetime import date

from PIL import Image, ImageCms, ImageOps

PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".gif"}
_ORIENT_SWAP = {5, 6, 7, 8}
_MONTH_WORDS = [
    ["januar", "jänner", "jaenner", "january", "jan"], ["februar", "feber", "february", "feb"],
    ["märz", "maerz", "march", "mär", "mrz", "mar"], ["april", "apr"], ["mai", "may"], ["juni", "june", "jun"],
    ["juli", "july", "jul"], ["august", "aug"], ["september", "sept", "sep"], ["oktober", "october", "okt", "oct"],
    ["november", "nov"], ["dezember", "december", "dez", "dec"],
]


def is_photo(name: str) -> bool:
    return os.path.splitext(name)[1].lower() in PHOTO_EXT


def sha256_stream(fh, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    for block in iter(lambda: fh.read(chunk), b""):
        h.update(block)
    return h.hexdigest()


def month_from_folder(folder: str) -> int | None:
    """Monat aus einem Ordnernamen wie „03 März“, „2026-03“ oder „März Ausflug“."""
    s = folder.lower()
    m = re.search(r"(?:^|\D)(?:19|20)\d{2}[-_ .](0[1-9]|1[0-2])(?:\D|$)", s)
    if m:
        return int(m.group(1)) - 1
    m = re.match(r"^(0?[1-9]|1[0-2])(?:[ _.\-]|$)", s)
    if m:
        return int(m.group(1)) - 1
    words = set(re.split(r"[^a-zäöü]+", s))
    for i, names in enumerate(_MONTH_WORDS):
        if words.intersection(names):
            return i
    return None


def date_from_name(name: str) -> date | None:
    m = re.search(r"(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:\D|$)", name)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def inspect(fh) -> dict:
    """Breite und Höhe (wie angezeigt, also nach EXIF-Drehung) und Aufnahmedatum."""
    info: dict = {"widthPx": 0, "heightPx": 0, "captureDate": None}
    try:
        with Image.open(fh) as im:
            w, h = im.size
            exif = im.getexif()
            if exif.get(0x0112) in _ORIENT_SWAP:
                w, h = h, w
            info["widthPx"], info["heightPx"] = w, h
            raw = exif.get_ifd(0x8769).get(0x9003) or exif.get(0x0132)
            if isinstance(raw, str):
                m = re.match(r"(\d{4}):(\d{2}):(\d{2})", raw)
                if m and 1900 < int(m.group(1)) < 2200 and 1 <= int(m.group(2)) <= 12:
                    info["captureDate"] = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    except Exception:  # beschädigte oder unbekannte Datei: ohne Metadaten weiter
        pass
    return info


def rgb_profile(im: Image.Image) -> tuple[bytes | None, str]:
    """Eingebettetes RGB-Farbprofil und sein Name. ``None``, wenn keins da ist oder es sRGB beschreibt
    (dann gilt das Foto ohnehin als sRGB). Typisch sonst: „Display P3“ vom iPhone, „Adobe RGB“ von Kameras."""
    icc = im.info.get("icc_profile")
    if not icc or im.mode not in ("RGB", "RGBA", "RGBX", "P", "I;16", "I;16B"):
        return None, "sRGB"
    try:
        prof = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        if prof.profile.xcolor_space.strip() != "RGB":
            return None, "sRGB"
        name = (ImageCms.getProfileDescription(prof) or "").strip() or "RGB"
    except (OSError, ImageCms.PyCMSError):
        return None, "sRGB"
    if "srgb" in name.lower().replace(" ", "") or "iec61966-2" in name.lower():
        return None, "sRGB"
    return icc, name


def make_thumbnail(src_fh, max_px: int, quality: int = 85) -> bytes:
    """JPEG-Vorschau mit korrekter Ausrichtung; das Original bleibt unverändert.
    Ein eigenes Farbprofil (etwa Display P3) wird mitgegeben: Browser zeigen die Farben dann richtig und
    die Druckansicht rechnet vom echten Farbraum aus."""
    with Image.open(src_fh) as im:
        im.draft("RGB", (max_px, max_px))         # JPEG schon beim Dekodieren verkleinern (schnell)
        icc, _ = rgb_profile(im)
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGB")
        im.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=quality, optimize=True, **({"icc_profile": icc} if icc else {}))
        return out.getvalue()
