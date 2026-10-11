"""Schriften für den Kalender: Google Fonts und eigene Dateien.

Die Oberfläche setzt Text selbst (Breiten aus der Schrift) und bettet die Schrift als TrueType mit
WinAnsi-Kodierung ins PDF ein. Darum bringt der Dienst jede Schrift in dieselbe Form, bevor sie ins Projekt
kommt:

* statisch: variable Schriften werden auf die gewünschte Strichstärke festgelegt,
* TrueType-Umrisse: OpenType mit CFF-Umrissen wird umgerechnet (kubisch → quadratisch),
* Teilmenge: nur die Zeichen, die der Kalender druckt (Latin-1 und die Windows-Sonderzeichen),
* Einbetten erlaubt: Schriften mit „Restricted License“ (OS/2 fsType) werden abgelehnt.

Google Fonts lädt der Dienst, nicht der Browser: Erst wenn jemand eine Schrift auswählt, fragt er Google
nach dem Verzeichnis bzw. der Schrift. Die Dateien landen im Projektordner unter ``.lichtjahr/fonts``, damit
alle, die am Kalender arbeiten, dieselben Schriften haben – auch ohne Internet.
"""

from __future__ import annotations

import io
import json
import os
import re
import time

from .i18n import _t
from .schema import META_DIR

CATALOG_URL = "https://fonts.google.com/metadata/fonts"
CSS_URL = "https://fonts.googleapis.com/css2"
LEGACY_UA = "Lichtjahr (+https://github.com/jo-tud/Lichtjahr)"   # ohne Browser-Kennung liefert Google TrueType statt WOFF2
CATALOG_MAX_AGE = 7 * 86400
REGULAR, BOLD = 400, 600                       # „fett“ im Kalender ist halbfett, wie bei Jost
CP1252 = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"
WINANSI = [*range(0x20, 0x7F), *range(0xA0, 0x100), *(ord(c) for c in CP1252)]
NEEDED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÄÖÜäöüß.,:;-–()/"   # ohne die geht es nicht
MAX_FONT_BYTES = 30 * 1024 * 1024


class FontError(Exception):
    pass


def slug(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return s[:60] or "schrift"


# -- Google Fonts ------------------------------------------------------------------------------
def _client():
    import httpx
    return httpx.Client(timeout=30, follow_redirects=True)


def catalog(cache_dir: str, fetch=None) -> list[dict]:
    """Verzeichnis der Google Fonts mit lateinischen Zeichen und normalem Schnitt, beliebteste zuerst.
    Wird eine Woche zwischengespeichert; ohne Internet gilt der letzte Stand."""
    path = os.path.join(cache_dir, "fonts", "google-catalog.json")
    try:
        if time.time() - os.path.getmtime(path) < CATALOG_MAX_AGE:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
    except (OSError, ValueError):
        pass
    try:
        raw = fetch() if fetch else _get(CATALOG_URL).decode("utf-8")
    except Exception as e:
        try:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            raise FontError(_t("Das Verzeichnis der Google Fonts ist gerade nicht erreichbar: {error}", error=e)) from e
    if raw.startswith(")]}'"):
        raw = raw.split("\n", 1)[1]
    out = []
    for f in json.loads(raw).get("familyMetadataList", []):
        weights = sorted({int(k) for k in (f.get("fonts") or {}) if k.isdigit()})
        if "latin" not in (f.get("subsets") or []) or (REGULAR not in weights and not f.get("axes")):
            continue
        axes = {a["tag"]: (a["min"], a["max"]) for a in f.get("axes") or []}
        if "wght" in axes:
            weights = sorted(set(weights) | {w for w in range(100, 1000, 100) if axes["wght"][0] <= w <= axes["wght"][1]})
        out.append({"family": f["family"], "category": f.get("category") or "", "popularity": f.get("popularity") or 9999,
                    "weights": weights, "designers": f.get("designers") or []})
    out.sort(key=lambda x: x["popularity"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    return out


def _get(url: str, **kw) -> bytes:
    with _client() as c:
        r = c.get(url, **kw)
        r.raise_for_status()
        return r.content


def bold_weight(weights: list[int]) -> int | None:
    """Halbfett, sonst fett, sonst der nächste kräftigere Schnitt; None, wenn es nur den normalen gibt."""
    for w in (BOLD, 700, 500, 800, 900):
        if w in weights:
            return w
    return None


def google_files(family: str, cache_dir: str, weights: list[int] | None = None, get=_get) -> dict:
    """Normalen und kräftigen Schnitt einer Google-Schrift laden und aufbereiten (zwischengespeichert)."""
    folder = os.path.join(cache_dir, "fonts", "google", slug(family))
    meta_path = os.path.join(folder, "font.json")
    try:
        with open(meta_path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        pass
    if weights is None:
        weights = [REGULAR, BOLD]
    bw = bold_weight(weights)
    want = [REGULAR] + ([bw] if bw else [])
    try:
        css = get(CSS_URL, params={"family": f"{family}:wght@{';'.join(map(str, want))}"}, headers={"User-Agent": LEGACY_UA}).decode("utf-8")
    except Exception as e:
        raise FontError(_t("Google Fonts ist gerade nicht erreichbar: {error}", error=e)) from e
    urls = {}
    for block in re.findall(r"@font-face\s*{([^}]*)}", css):
        w = re.search(r"font-weight:\s*(\d+)", block)
        u = re.search(r"url\((https://[^)]+)\)\s*format\(['\"]truetype['\"]\)", block)
        if w and u and "font-style: italic" not in block:
            urls.setdefault(int(w.group(1)), u.group(1))
    if REGULAR not in urls:
        raise FontError(_t("„{family}“ gibt es bei Google Fonts nicht im normalen Schnitt.", family=family))
    os.makedirs(folder, exist_ok=True)
    info = {"family": family, "source": "google", "license": "Google Fonts (open source)", "files": {}, "missing": []}
    for cut, w in (("regular", REGULAR), ("bold", bw)):
        if w is None or w not in urls:
            continue
        try:
            raw = get(urls[w])
        except Exception as e:
            raise FontError(_t("Google Fonts ist gerade nicht erreichbar: {error}", error=e)) from e
        data, meta = normalize(raw, w)
        with open(os.path.join(folder, f"{cut}.ttf"), "wb") as fh:
            fh.write(data)
        info["files"][cut] = f"{cut}.ttf"
        info["missing"] = sorted(set(info["missing"]) | set(meta["missing"]))
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(info, fh)
    return info


# -- Aufbereiten -------------------------------------------------------------------------------
def _to_truetype(font) -> None:
    """CFF-Umrisse (OpenType/PostScript) in TrueType-Umrisse umrechnen."""
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib import newTable

    order = font.getGlyphOrder()
    gs = font.getGlyphSet()
    glyf = newTable("glyf")
    glyf.glyphOrder = order
    glyf.glyphs = {}
    for name in order:
        pen = TTGlyphPen(gs)
        gs[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
        glyf[name] = pen.glyph()
    font["glyf"] = glyf
    font["loca"] = newTable("loca")
    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for k in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs",
              "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
        setattr(maxp, k, 0)
    maxp.maxZones = 1
    maxp.maxComponentDepth = 1
    for tag in ("CFF ", "CFF2", "VORG"):
        if tag in font:
            del font[tag]
    font["head"].glyphDataFormat = 0
    font.sfntVersion = "\x00\x01\x00\x00"
    if "post" in font:
        font["post"].formatType = 3.0          # ohne Glyphennamen; das PDF findet die Zeichen über die cmap


def normalize(data: bytes, weight: int = REGULAR) -> tuple[bytes, dict]:
    """Beliebige TTF/OTF/WOFF-Datei → statische TrueType-Schrift mit den Zeichen des Kalenders."""
    from fontTools import subset
    from fontTools.ttLib import TTFont

    if len(data) > MAX_FONT_BYTES:
        raise FontError(_t("Die Schriftdatei ist zu groß."))
    try:
        font = TTFont(io.BytesIO(data), lazy=False)
    except Exception as e:                      # TTLibError, aber auch kaputte Tabellen
        raise FontError(_t("Keine lesbare Schriftdatei (TrueType, OpenType oder WOFF erwartet).")) from e
    if "OS/2" in font and font["OS/2"].fsType & 0x000F == 0x0002:
        raise FontError(_t("Die Lizenz dieser Schrift erlaubt nicht, sie in ein PDF einzubetten."))
    if "fvar" in font:
        from fontTools.varLib import instancer
        loc = {}
        for a in font["fvar"].axes:
            loc[a.axisTag] = max(a.minValue, min(a.maxValue, weight)) if a.axisTag == "wght" else a.defaultValue
        font = instancer.instantiateVariableFont(font, loc)
    if "glyf" not in font:
        if "CFF " not in font and "CFF2" not in font:
            raise FontError(_t("Keine lesbare Schriftdatei (TrueType, OpenType oder WOFF erwartet)."))
        _to_truetype(font)
    cmap = font.getBestCmap() or {}
    missing = [c for c in NEEDED if ord(c) not in cmap]
    if sum(c.isalpha() for c in missing) > 10:
        raise FontError(_t("Diese Schrift hat keine lateinischen Buchstaben."))
    opts = subset.Options()
    opts.layout_features = []                  # Kerning und Ligaturen setzt der Kalender nicht
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = True
    opts.hinting = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[u for u in WINANSI if u in cmap])
    sub.subset(font)
    font.flavor = None                          # WOFF → TTF
    out = io.BytesIO()
    font.save(out)
    name = font["name"]
    family = (name.getDebugName(16) or name.getDebugName(1) or "").strip()
    return out.getvalue(), {"family": family, "ps": (name.getDebugName(6) or "").strip(), "missing": missing,
                            "weight": font["OS/2"].usWeightClass if "OS/2" in font else weight}


def from_uploads(regular: bytes, bold: bytes | None) -> tuple[dict, dict]:
    """Eigene Schrift: ein oder zwei Dateien. Eine variable Datei liefert beide Schnitte."""
    reg, meta = normalize(regular, REGULAR)
    files = {"regular": reg}
    if bold:
        files["bold"], mb = normalize(bold, BOLD)
        meta["missing"] = sorted(set(meta["missing"]) | set(mb["missing"]))
    else:
        from fontTools.ttLib import TTFont
        if "fvar" in TTFont(io.BytesIO(regular)):
            files["bold"], _ = normalize(regular, BOLD)
    return files, meta


# -- Im Projekt --------------------------------------------------------------------------------
FONT_DIR = f"{META_DIR}/fonts"
INDEX = f"{FONT_DIR}/fonts.json"


def project_fonts(storage) -> list[dict]:
    from .storage import NotFound
    try:
        data, _ = storage.read(INDEX)
        items = json.loads(data)
        return items if isinstance(items, list) else []
    except (NotFound, ValueError):
        return []


def add_to_project(storage, family: str, files: dict[str, bytes], source: str, license: str, missing: list[str]) -> dict:
    """Schnitte ablegen und ins Verzeichnis der Projektschriften eintragen (gleiche Familie: ersetzen)."""
    storage.makedirs(FONT_DIR)
    base = slug(f"{source}-{family}")
    entry = {"id": base, "family": family, "source": source, "license": license, "missing": missing, "files": {}}
    for cut, data in files.items():
        name = f"{base}-{cut}.ttf"
        storage.write(f"{FONT_DIR}/{name}", data)
        entry["files"][cut] = name
    items = [x for x in project_fonts(storage) if x.get("id") != base] + [entry]
    storage.write(INDEX, json.dumps(items, indent=2, ensure_ascii=False).encode("utf-8"))
    return entry


def font_file(storage, name: str) -> bytes:
    if not re.fullmatch(r"[a-z0-9-]+-(regular|bold)\.ttf", name):
        raise FontError(_t("Unbekannte Schriftdatei."))
    data, _ = storage.read(f"{FONT_DIR}/{name}")
    return data
