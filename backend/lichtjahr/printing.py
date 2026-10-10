"""Druck-PDF: Farbmanagement, PDF/X-1a und Preflight.

Die Oberfläche setzt die Seiten wie gewohnt (Text und Flächen als CMYK-Vektoren), liefert die Fotos aber
als sRGB-JPEG. Hier werden sie mit LittleCMS (Pillow ImageCms) über das Farbprofil der Druckerei nach CMYK
umgerechnet; dann entsteht ein PDF/X-1a:2001 oder PDF/X-4 mit OutputIntent.

Fotos mit eigenem, größerem Farbraum (Display P3 vom iPhone, Adobe RGB von Kameras) würde der Browser beim
Setzen auf sRGB beschneiden. Für sie schreibt die Oberfläche in das Bild, aus welchem Foto und welchem
Ausschnitt es stammt (``/LJSource``); der Dienst rendert den Ausschnitt dann aus dem Original und rechnet
direkt aus dessen Farbraum nach CMYK um. Zum Schluss prüft der Preflight die fertige
Datei selbst – nicht die Annahmen, mit denen sie gebaut wurde.

Druckprofile beschreiben die Vorgaben einer Druckerei: ICC-Profil, Druckbedingung, Rendering Intent,
maximaler Gesamtfarbauftrag, Beschnitt, Mindestauflösung. Mitgelieferte Profile liegen in ``lichtjahr/icc``,
eigene im Datenordner unter ``printers/`` (ICC-Datei plus JSON mit den Vorgaben).
"""

from __future__ import annotations

import functools
import io
import json
import math
import os
import re
import struct
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

import pikepdf
from PIL import Image, ImageChops, ImageCms, ImageFilter, ImageOps

from . import detail
from .i18n import _t
from .media import rgb_profile

PT_PER_MM = 72 / 25.4
PDFX_VERSION = "PDF/X-1:2001"
PDFX_CONFORMANCE = "PDF/X-1a:2001"
# Zwei Standards: PDF/X-1a (am weitesten verbreitet, nur CMYK, keine Transparenz, ICC v2) und PDF/X-4
# (neuer: PDF 1.6, XMP-Metadaten, Transparenz und ICC v4 erlaubt). Die Fotos rechnet Lichtjahr in beiden Fällen
# selbst nach CMYK um, damit das Ergebnis vorhersehbar bleibt.
STANDARDS = {
    "x1a": {"label": "PDF/X-1a:2001", "version": "1.3", "info": {"/GTS_PDFXVersion": PDFX_VERSION, "/GTS_PDFXConformance": PDFX_CONFORMANCE},
            "transparency": False, "icc_max": 4.0},
    "x4": {"label": "PDF/X-4", "version": "1.6", "info": {"/GTS_PDFXVersion": "PDF/X-4"}, "transparency": True, "icc_max": 5.0},
}
XMP_PDFX = "{http://www.npes.org/pdfx/ns/id/}GTS_PDFXVersion"
BUNDLED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icc")


class PrintError(Exception):
    pass


@dataclass
class PrinterProfile:
    id: str
    name: str
    icc: str                                # Dateiname der ICC-Datei
    condition: str                          # OutputConditionIdentifier, z. B. „FOGRA39“
    info: str = ""                          # Name des ICC-Profils (OutputIntent /Info)
    conditionText: str = ""                 # ausführliche Druckbedingung (OutputIntent /OutputCondition)
    registry: str = "http://www.color.org"
    intent: str = "perceptual"              # oder „relative“ (relativ farbmetrisch mit Tiefenkompensierung)
    tac: int = 300                          # maximaler Gesamtfarbauftrag in Prozent
    bleed: float = 3.0                      # Beschnitt je Seite in mm
    minDpi: int = 150                       # darunter Warnung (sichtbar unscharf)
    goodDpi: int = 240                      # darunter nur eine Information
    quality: int = 92                       # JPEG-Qualität der CMYK-Bilder
    iccVersion: float = 2.1                 # Version des ICC-Profils (v4 nur mit PDF/X-4)
    note: str = ""
    builtin: bool = False
    available: bool = True
    path: str = field(default="", repr=False)

    def public(self) -> dict:
        d = asdict(self)
        d.pop("path")
        return d


# Mitgelieferte Druckprofile (ICC-Dateien von basICColor unter zlib-Lizenz, siehe lichtjahr/icc/README.md)
BUILTIN = [
    dict(id="fogra39", name="Gestrichenes Papier · FOGRA39", icc="ISOcoated_v2_300_bas.icc", condition="FOGRA39",
         info="ISO Coated v2 300% (basICColor)",
         conditionText="Offset commercial and specialty printing according to ISO 12647-2:2004 / Amd 1, paper type 1 or 2 (gloss or matte coated offset, 115 g/m2), screen frequency 60/cm.",
         tac=300, note="Verbreiteter Standard für Fotokalender auf glänzendem oder mattem Papier. Verlangt die Druckerei PSO Coated v3 (FOGRA51), deren Profil als eigenes Druckprofil hinzufügen; frei mitliefern dürfen wir es nicht."),
    dict(id="fogra47", name="Ungestrichenes Papier · FOGRA47", icc="PSO_Uncoated_ISO12647_bas.icc", condition="FOGRA47",
         info="PSO Uncoated ISO12647 (basICColor)",
         conditionText="Offset commercial and specialty printing according to ISO 12647-2:2004 / Amd 1, paper type 4 (uncoated white offset, 120 g/m2), screen frequency 60/cm.",
         tac=300, note="Für Naturpapier, das Farben etwas weicher und matter wiedergibt."),
]


# -- Profile verwalten --------------------------------------------------------------------------
class PrinterRegistry:
    def __init__(self, data_dir: str) -> None:
        self.dir = os.path.join(data_dir, "printers")

    def all(self) -> list[PrinterProfile]:
        out = []
        for b in BUILTIN:
            path = os.path.join(BUNDLED_DIR, b["icc"])
            out.append(PrinterProfile(**{**b, "name": _t(b["name"]), "note": _t(b["note"])}, builtin=True, available=os.path.exists(path), path=path))
        if os.path.isdir(self.dir):
            for name in sorted(os.listdir(self.dir)):
                if not name.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(self.dir, name), encoding="utf-8") as fh:
                        d = json.load(fh)
                    d = {k: v for k, v in d.items() if k in PrinterProfile.__dataclass_fields__ and k not in ("builtin", "available", "path")}
                    path = os.path.join(self.dir, d["icc"])
                    out.append(PrinterProfile(**d, available=os.path.exists(path), path=path))
                except (OSError, ValueError, KeyError, TypeError):
                    continue
        return out

    def get(self, pid: str) -> PrinterProfile:
        p = next((p for p in self.all() if p.id == pid), None)
        if not p:
            raise PrintError(_t("Unbekanntes Druckprofil."))
        if not p.available:
            raise PrintError(_t("Für „{name}“ fehlt die ICC-Datei {icc}.", name=p.name, icc=p.icc))
        return p

    def add(self, icc_bytes: bytes, name: str | None = None, **settings) -> PrinterProfile:
        """Eigenes Profil aus der ICC-Datei der Druckerei. Prüft, dass es ein CMYK-Ausgabeprofil ist."""
        info = inspect_icc(icc_bytes)
        os.makedirs(self.dir, exist_ok=True)
        pid = "eigen-" + uuid.uuid4().hex[:8]
        icc_name = pid + ".icc"
        with open(os.path.join(self.dir, icc_name), "wb") as fh:
            fh.write(icc_bytes)
        allowed = {k: v for k, v in settings.items() if k in ("intent", "tac", "bleed", "minDpi", "goodDpi", "note") and v not in (None, "")}
        p = PrinterProfile(id=pid, name=(name or info["description"] or _t("Eigenes Profil")).strip()[:80], icc=icc_name,
                           condition=info["condition"] or "Custom", info=info["description"], conditionText=info["conditionText"],
                           iccVersion=round(float(info["version"]), 2), **allowed)
        if p.intent not in ("perceptual", "relative"):
            p.intent = "perceptual"
        p.tac = int(max(200, min(400, p.tac)))
        p.bleed = float(max(0, min(10, p.bleed)))
        with open(os.path.join(self.dir, pid + ".json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in p.public().items() if k not in ("builtin", "available")}, fh, ensure_ascii=False, indent=2)
        p.path = os.path.join(self.dir, icc_name)
        return p

    def remove(self, pid: str) -> None:
        if not pid.startswith("eigen-") or "/" in pid or "\\" in pid:
            raise PrintError(_t("Mitgelieferte Profile lassen sich nicht löschen."))
        for ext in (".json", ".icc"):
            try:
                os.unlink(os.path.join(self.dir, pid + ext))
            except FileNotFoundError:
                pass


def inspect_icc(data: bytes) -> dict:
    try:
        prof = ImageCms.ImageCmsProfile(io.BytesIO(data))
    except (OSError, ImageCms.PyCMSError) as e:
        raise PrintError(_t("Keine gültige ICC-Datei: {error}", error=e)) from e
    p = prof.profile
    if p.xcolor_space.strip() != "CMYK":
        raise PrintError(_t("Das Profil beschreibt {space}, gebraucht wird ein CMYK-Druckprofil.", space=p.xcolor_space.strip()))
    if p.device_class != "prtr":
        raise PrintError(_t("Das ist kein Ausgabeprofil für den Druck."))
    desc = (p.profile_description or "").strip()
    try:
        target = (p.target or "")[:2000]        # Charakterisierungsdaten, nennen oft „FOGRA51“
    except Exception:  # noqa: BLE001 – fehlt bei manchen Profilen
        target = ""
    cond = condition_of(desc) or condition_of(target)
    return {"description": desc, "condition": cond, "conditionText": CONDITION_TEXT.get(cond, ""), "version": p.version}


# Gebräuchliche Beschreibungen der Druckbedingungen für den OutputIntent
CONDITION_TEXT = {
    "FOGRA39": "Offset commercial and specialty printing according to ISO 12647-2:2004 / Amd 1, paper type 1 or 2 (gloss or matte coated offset, 115 g/m2), screen frequency 60/cm.",
    "FOGRA47": "Offset commercial and specialty printing according to ISO 12647-2:2004 / Amd 1, paper type 4 (uncoated white offset, 120 g/m2), screen frequency 60/cm.",
    "FOGRA51": "Offset printing, according to ISO 12647-2:2013, OFCOM, print substrate 1 = premium coated, fluorescence moderate, 115 g/m2, tone value increase curves A (CMYK).",
    "FOGRA52": "Offset printing, according to ISO 12647-2:2013, OFCOM, print substrate 5 = wood-free uncoated, fluorescence high, 120 g/m2, tone value increase curves C (CMYK).",
}


# Bekannte Profile ohne FOGRA-Nummer im Namen → Druckbedingung (Charakterisierungsdaten)
KNOWN_CONDITIONS = [
    (r"ISO\s*Coated\s*v2", "FOGRA39"), (r"PSO\s*Coated\s*v3", "FOGRA51"), (r"PSO\s*Uncoated\s*v3", "FOGRA52"),
    (r"PSO\s*Coated\s*NP\s*screen", "FOGRA43"), (r"PSO\s*Uncoated\s*NP\s*screen", "FOGRA44"),
    (r"PSO\s*Uncoated\s*ISO\s*12647", "FOGRA47"), (r"ISO\s*Uncoated(?!\s*yellowish)", "FOGRA29"),
    (r"ISO\s*Uncoated\s*yellowish", "FOGRA30"), (r"SC\s*paper", "FOGRA40"), (r"PSO\s*LWC\s*Improved", "FOGRA45"),
    (r"PSO\s*LWC\s*Standard", "FOGRA46"), (r"PSO\s*MFC\s*Paper", "FOGRA41"), (r"PSO\s*SNP\s*Paper", "FOGRA42"),
]


def condition_of(description: str) -> str:
    m = re.search(r"FOGRA\s?(\d{2})", description, re.I)
    if m:
        return f"FOGRA{m.group(1)}"
    for pattern, cond in KNOWN_CONDITIONS:
        if re.search(pattern, description, re.I):
            return cond
    return ""


# -- Umrechnen ----------------------------------------------------------------------------------
def _strip_adobe(jpeg: bytes) -> bytes:
    """APP14-„Adobe“-Segment entfernen. Zusammen mit vorab invertierten Daten ergibt das ein CMYK-JPEG
    ohne Adobe-Konvention, das alle PDF-Leser gleich (nicht invertiert) darstellen."""
    out, i = bytearray(jpeg[:2]), 2
    while i < len(jpeg):
        if jpeg[i] != 0xFF:
            raise PrintError(_t("Unerwarteter JPEG-Aufbau."))
        marker = jpeg[i + 1]
        if marker == 0xDA:                      # Bilddaten: Rest unverändert übernehmen
            out += jpeg[i:]
            break
        length = struct.unpack(">H", jpeg[i + 2:i + 4])[0]
        seg = jpeg[i:i + 2 + length]
        if not (marker == 0xEE and seg[4:9] == b"Adobe"):
            out += seg
        i += 2 + length
    return bytes(out)


def cmyk_jpeg(im: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    ImageChops.invert(im).save(buf, "JPEG", quality=quality, optimize=True)
    return _strip_adobe(buf.getvalue())


def max_tac(im: Image.Image) -> float:
    """Höchster Gesamtfarbauftrag (C+M+Y+K in %) auf einer verkleinerten Fassung (Mittel über ~1 mm)."""
    f = max(1, math.ceil(max(im.size) / 500))
    small = im.reduce(f) if f > 1 else im
    pixels = small.get_flattened_data() if hasattr(small, "get_flattened_data") else small.getdata()
    return max(map(sum, pixels), default=0) / 2.55


@functools.lru_cache(maxsize=16)
def _rgb_source(icc: bytes | None):
    """Quellprofil: eingebettetes ICC-Profil des Fotos oder sRGB."""
    return ImageCms.ImageCmsProfile(io.BytesIO(icc)) if icc else ImageCms.createProfile("sRGB")


@functools.lru_cache(maxsize=16)
def _cmyk_transform(path: str, intent: str, mtime: float, icc: bytes | None = None):
    dst = ImageCms.getOpenProfile(path)
    render = ImageCms.Intent.PERCEPTUAL if intent == "perceptual" else ImageCms.Intent.RELATIVE_COLORIMETRIC
    flags = ImageCms.Flags.BLACKPOINTCOMPENSATION if intent != "perceptual" else ImageCms.Flags.NONE
    return ImageCms.buildTransform(_rgb_source(icc), dst, "RGB", "CMYK", renderingIntent=render, flags=flags)


def _transform(profile: PrinterProfile, icc: bytes | None = None):
    return _cmyk_transform(profile.path, profile.intent, _mtime(profile), icc)


# -- Bilder verbessern und für den Druck anpassen ---------------------------------------------
# Rezepte je Foto rechnet die Oberfläche in eine Farbmatrix (3×3) und eine Tonkurve (65 Stützstellen) um; hier
# werden sie nur angewendet, genauso wie im SVG-Filter der Vorschau. Der Druckausgleich hängt vom Profil ab:
# Papier leuchtet nicht und hat weniger Kontrast als ein Bildschirm, darum Mitteltöne leicht anheben, Tiefen
# öffnen und für den Druck schärfen – auf Naturpapier (helleres Schwarz) stärker als auf gestrichenem.
def apply_adjust(im: Image.Image, m=None, lut=None) -> Image.Image:
    import numpy as np
    a = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    if m is not None:
        a = np.clip(a @ np.asarray(m, dtype=np.float32).reshape(3, 3).T, 0.0, 1.0)
    if lut is not None:
        a = np.interp(a, np.linspace(0.0, 1.0, len(lut)), np.asarray(lut, dtype=np.float32))
    out = Image.fromarray((a * 255.0 + 0.5).astype(np.uint8), "RGB")
    if im.info.get("icc_profile"):
        out.info["icc_profile"] = im.info["icc_profile"]
    return out


def compose_lut(first, then):
    """Erst Kurve ``first``, dann ``then``, als eine Kurve mit den Stützstellen von ``first``."""
    import numpy as np
    if first is None:
        return then
    if then is None:
        return first
    return [float(v) for v in np.interp(np.asarray(first), np.linspace(0.0, 1.0, len(then)), np.asarray(then))]


def parse_adjust(text: str):
    """„m0,…,m8;l0,…,l64“ aus der Abfrage der Druckansicht → (m, lut); leer → (None, None)."""
    if not text:
        return None, None
    try:
        m_txt, l_txt = text.split(";", 1)
        m = [float(v) for v in m_txt.split(",")] if m_txt else None
        lut = [float(v) for v in l_txt.split(",")] if l_txt else None
    except ValueError:
        return None, None
    if (m is not None and len(m) != 9) or (lut is not None and not 2 <= len(lut) <= 1025):
        return None, None
    return m, lut


@functools.lru_cache(maxsize=16)
def _tune(path: str, intent: str, mtime: float) -> dict:
    prof = ImageCms.getOpenProfile(path)
    to_lab = ImageCms.buildTransform(prof, ImageCms.createProfile("LAB"), "CMYK", "LAB",
                                     renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC)
    black = ImageCms.applyTransform(Image.new("CMYK", (1, 1), (255, 255, 255, 255)), to_lab).getpixel((0, 0))[0] / 2.55
    p = min(1.0, max(0.4, 0.4 + (black - 10) / 30))          # gestrichen (Schwarz ≈ L* 10) mild, Naturpapier stärker
    g, lift = 1 / (1 + .16 * p), .25 * p
    lut = []
    for i in range(65):
        x = (i / 64) ** g
        lut.append(round(min(1.0, x + lift * x * (1 - x) ** 3), 5))
    return {"strength": round(p, 2), "blackL": round(black, 1), "lut": lut, "midtones": round((lut[32] - .5) * 200),
            "sharpen": {"radius": 1.2, "percent": round(45 + 45 * p), "threshold": 3}}


def print_tune(profile: PrinterProfile) -> dict:
    """Druckausgleich für dieses Profil: Kurve, Stärke, Schärfung."""
    return _tune(profile.path, profile.intent, _mtime(profile))


def sharpen_for_print(im: Image.Image, tune: dict) -> Image.Image:
    """Ausgabeschärfung nur auf der Helligkeit (keine Farbsäume), in der Auflösung des Druckbilds."""
    s = tune["sharpen"]
    y, cb, cr = im.convert("YCbCr").split()
    y = y.filter(ImageFilter.UnsharpMask(radius=s["radius"], percent=s["percent"], threshold=s["threshold"]))
    out = Image.merge("YCbCr", (y, cb, cr)).convert("RGB")
    if im.info.get("icc_profile"):
        out.info["icc_profile"] = im.info["icc_profile"]
    return out


def _source_spec(xo) -> dict | None:
    """Herkunftsangabe der Oberfläche aus dem Bildobjekt lesen (und entfernen, sie gehört nicht ins Druck-PDF)."""
    src = xo.get("/LJSource")
    if src is None:
        return None
    del xo["/LJSource"]
    try:
        panels = [float(v) for v in src.get("/Panels", [])]
        return {
            "asset": str(src.Asset),
            "m": [float(v) for v in src.M][:6],
            "photo": [float(v) for v in src.Photo][:2],
            "bg": tuple(max(0, min(255, int(v))) for v in src.BG)[:3],
            "panels": [panels[i:i + 8] for i in range(0, len(panels) - 7, 8)],
            "adjM": [float(v) for v in src.AdjM] if "/AdjM" in src else None,
            "adjL": [float(v) for v in src.AdjL] if "/AdjL" in src else None,
            "fx": str(src.FX) if "/FX" in src else "",
        }
    except (AttributeError, KeyError, TypeError, ValueError):
        return None


def render_wide(original: bytes, spec: dict, size: tuple[int, int], tune_lut=None) -> tuple[Image.Image, bytes, str] | None:
    """Ausschnitt aus dem Original rendern, im Farbraum des Originals. ``None``, wenn das Foto sRGB ist oder
    kein eigenes Profil hat – dann ist die Fassung der Oberfläche schon richtig."""
    with Image.open(io.BytesIO(original)) as im:
        icc, name = rgb_profile(im)
        if not icc:
            return None
        a, b, c, d, e, f = spec["m"]                      # Zielpixel → Fotopixel (wie angezeigt)
        pw, ph = spec["photo"]
        step = math.sqrt(abs(a * e - b * d)) or 1.0       # Fotopixel je Zielpixel
        if step > 2:                                      # JPEG gleich verkleinert dekodieren (schnell)
            im.draft("RGB", (math.ceil(im.width / step), math.ceil(im.height / step)))
        im = ImageOps.exif_transpose(im).convert("RGB")
        sx, sy = im.width / pw, im.height / ph
        a, b, c, d, e, f = a * sx, b * sx, c * sx, d * sy, e * sy, f * sy
        r = int(math.sqrt(abs(a * e - b * d)))            # weiter verkleinern, damit bikubisch nicht flimmert
        if r > 1:
            im = im.reduce(r)
            a, b, c, d, e, f = a / r, b / r, c / r, d / r, e / r, f / r
        fx = detail.parse_fx(spec.get("fx"))
        if fx:                                                # Gegenlicht und Rauschen vor dem Rezept, wie in der Vorschau
            im = detail.apply(im, fx)
        lut = compose_lut(spec.get("adjL"), tune_lut)         # Rezept des Fotos, dann Druckausgleich
        if spec.get("adjM") is not None or lut is not None:
            im = apply_adjust(im, spec.get("adjM"), lut)      # nur aufs Foto, nicht auf Hintergrund und Flächen
        to_src = ImageCms.buildTransform(_rgb_source(None), _rgb_source(icc), "RGB", "RGB")

        def own(rgb):                                     # sRGB-Farbe der Oberfläche im Farbraum des Fotos
            rgb = tuple(max(0, min(255, int(round(v)))) for v in rgb)
            return ImageCms.applyTransform(Image.new("RGB", (1, 1), rgb), to_src).getpixel((0, 0))
        out = im.transform(size, Image.Transform.AFFINE, (a, b, c, d, e, f), resample=Image.Resampling.BICUBIC,
                           fillcolor=own(spec["bg"]))
        for x, y, w, h, pr, pg, pb, alpha in spec["panels"]:
            box = tuple(int(round(v)) for v in (x, y, x + w, y + h))
            box = (max(0, box[0]), max(0, box[1]), min(size[0], box[2]), min(size[1], box[3]))
            if box[2] > box[0] and box[3] > box[1]:
                part = out.crop(box)
                out.paste(Image.blend(part, Image.new("RGB", part.size, own((pr, pg, pb))), max(0.0, min(1.0, alpha))), box)
        return out, icc, name


def make_print_pdf(data: bytes, profile: PrinterProfile, title: str = "Kalender", progress=None,
                   standard: str = "x1a", original=None, tune: bool = False) -> tuple[bytes, dict]:
    """sRGB-Bilder nach CMYK umrechnen, PDF/X-Merkmale setzen (X-1a oder X-4), Preflight auf das Ergebnis.
    ``original(asset_id)`` liefert die Originaldatei (oder ``None``) für Fotos mit eigenem Farbraum."""
    std = STANDARDS.get(standard)
    if not std:
        raise PrintError(_t("Unbekannter PDF/X-Standard."))
    if profile.iccVersion >= std["icc_max"]:
        raise PrintError(_t("Das Profil hat ICC-Version 4. Dafür PDF/X-4 wählen; PDF/X-1a braucht ein Profil der Version 2."))
    try:
        pdf = pikepdf.open(io.BytesIO(data))
    except pikepdf.PdfError as e:
        raise PrintError(_t("Das PDF der Oberfläche ist unlesbar: {error}", error=e)) from e
    transform = _transform(profile)
    images = [(n, xo) for page in pdf.pages for n, xo in (page.Resources.get("/XObject") or {}).items()
              if xo.get("/Subtype") == pikepdf.Name.Image]
    tacs: dict = {}
    tuned = print_tune(profile) if tune else None          # Kurve hat die Oberfläche schon angewendet; hier schärfen
    wide: dict[str, set] = {}                              # Farbraum → Fotos, die aus dem Original kamen
    originals: dict = {}
    for idx, (_, xo) in enumerate(images):
        if progress:
            progress(idx / max(1, len(images)))
        if xo.objgen in tacs:
            continue
        spec = _source_spec(xo)
        cs = xo.get("/ColorSpace")
        if cs == pikepdf.Name.DeviceRGB:
            rendered = None
            if spec and original:
                if spec["asset"] not in originals:
                    try:
                        originals[spec["asset"]] = original(spec["asset"])
                    except Exception:                      # Original nicht lesbar: Fassung der Oberfläche nehmen
                        originals[spec["asset"]] = None
                src = originals[spec["asset"]]
                if src:
                    try:
                        rendered = render_wide(src, spec, (int(xo.Width), int(xo.Height)), tuned and tuned["lut"])
                    except (OSError, ValueError, ImageCms.PyCMSError):
                        rendered = None
            if rendered:
                rgb, icc, name = rendered
                if tuned:
                    rgb = sharpen_for_print(rgb, tuned)
                cmyk = ImageCms.applyTransform(rgb, _transform(profile, icc))
                wide.setdefault(name, set()).add(spec["asset"])
            else:
                rgb = pikepdf.PdfImage(xo).as_pil_image().convert("RGB")
                if tuned:
                    rgb = sharpen_for_print(rgb, tuned)
                cmyk = ImageCms.applyTransform(rgb, transform)
            tacs[xo.objgen] = max_tac(cmyk)
            xo.write(cmyk_jpeg(cmyk, profile.quality), filter=pikepdf.Name.DCTDecode)
            xo.ColorSpace = pikepdf.Name.DeviceCMYK
            xo.BitsPerComponent = 8
            for k in ("/Decode", "/DecodeParms", "/SMask", "/Intent"):
                if k in xo:
                    del xo[k]
        else:
            tacs[xo.objgen] = None
    # Ausgabebedingung mit eingebettetem Profil (in beiden Standards Pflicht bzw. hier immer gesetzt)
    with open(profile.path, "rb") as fh:
        icc = fh.read()
    dest = pdf.make_stream(icc)
    dest.N = 4
    pdf.Root.OutputIntents = pikepdf.Array([pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name.OutputIntent, S=pikepdf.Name.GTS_PDFX,
        OutputConditionIdentifier=profile.condition or "Custom", OutputCondition=profile.conditionText or profile.info or profile.name,
        RegistryName=profile.registry, Info=profile.info or profile.name, DestOutputProfile=dest))])
    # Dokumentinfo; Datum für Info und XMP gleich, damit beide übereinstimmen
    stamp = datetime.now(timezone.utc).replace(microsecond=0)
    pdf_date = stamp.strftime("D:%Y%m%d%H%M%SZ")
    info = pdf.docinfo
    info.Title = title
    info.Creator = "Lichtjahr"
    info.Producer = "Lichtjahr (LittleCMS, qpdf)"
    info.CreationDate = pdf_date
    info.ModDate = pdf_date
    info.Trapped = pikepdf.Name("/False")
    for k in ("/GTS_PDFXVersion", "/GTS_PDFXConformance"):
        if k in info:
            del info[k]
    for k, v in std["info"].items():
        info[k] = v
    if standard == "x4":
        # PDF/X-4 verlangt XMP-Metadaten mit Kennung, Dokument- und Versions-ID, passend zur Dokumentinfo
        iso = stamp.isoformat().replace("+00:00", "Z")
        with pdf.open_metadata(set_pikepdf_as_editor=False, update_docinfo=False) as meta:
            meta["dc:title"] = title
            meta["xmp:CreateDate"] = iso
            meta["xmp:ModifyDate"] = iso
            meta["xmp:MetadataDate"] = iso
            meta["xmp:CreatorTool"] = "Lichtjahr"
            meta["pdf:Producer"] = str(info.Producer)
            meta["pdf:Trapped"] = "False"
            meta[XMP_PDFX] = "PDF/X-4"
            meta["xmpMM:DocumentID"] = f"uuid:{uuid.uuid4()}"
            meta["xmpMM:InstanceID"] = f"uuid:{uuid.uuid4()}"
            meta["xmpMM:VersionID"] = "1"
            meta["xmpMM:RenditionClass"] = "default"
    out = io.BytesIO()
    pdf.save(out, force_version=std["version"], object_stream_mode=pikepdf.ObjectStreamMode.disable,
             compress_streams=True, qdf=False)
    result = out.getvalue()
    report = preflight(result, profile, image_tac=list(tacs.values()), standard=standard)
    if wide:
        n = len(set().union(*wide.values()))
        names = ", ".join(sorted(wide))
        text = (_t("1 Foto mit großem Farbraum ({names}) direkt aus dem Original umgerechnet", names=names) if n == 1
                else _t("{n} Fotos mit großem Farbraum ({names}) direkt aus dem Original umgerechnet", n=n, names=names))
        report["summary"].insert(2, {"level": "ok", "code": "wide", "text": text})
        report["wide"] = {k: len(v) for k, v in wide.items()}
    if tuned:
        report["summary"].insert(2, {"level": "ok", "code": "tune", "text": _t(
            "Für den Druck angepasst: Mitteltöne {mid} % heller, Tiefen geöffnet, geschärft", mid=tuned["midtones"])})
        report["tune"] = {"strength": tuned["strength"], "midtones": tuned["midtones"]}
    if progress:
        progress(1.0)
    return result, report


# -- Preflight ----------------------------------------------------------------------------------
def _mul(a, b):
    return (a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2],
            a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5])


def _boxes(page) -> dict:
    def box(key):
        v = page.obj.get(key)
        return [float(x) for x in v] if v is not None else None
    media = box("/MediaBox")
    return {"media": media, "bleed": box("/BleedBox") or media, "trim": box("/TrimBox"), "art": box("/ArtBox")}


def preflight(data: bytes, profile: PrinterProfile, image_tac: list | None = None, standard: str = "x1a") -> dict:
    """Prüft ein PDF gegen PDF/X-1a:2001 oder PDF/X-4 (die Teile, die für diesen Ablauf relevant sind) und das Druckprofil."""
    std = STANDARDS[standard]
    items: list[dict] = []

    def add(level, code, text, page=None):
        items.append({"level": level, "code": code, "text": text, **({"page": page} if page is not None else {})})

    pdf = pikepdf.open(io.BytesIO(data))
    info = pdf.docinfo
    if any(str(info.get(k, "")) != v for k, v in std["info"].items()):
        add("error", "pdfx-id", _t("PDF/X-Kennung fehlt."))
    if standard == "x4":
        try:
            meta = pdf.open_metadata()
            missing = [k for k, key in (("GTS_PDFXVersion", XMP_PDFX), ("DocumentID", "xmpMM:DocumentID"), ("VersionID", "xmpMM:VersionID"),
                                        ("RenditionClass", "xmpMM:RenditionClass"), ("Trapped", "pdf:Trapped"), ("CreateDate", "xmp:CreateDate"))
                       if not str(meta.get(key, ""))]
            if str(meta.get(XMP_PDFX, "")) not in ("", "PDF/X-4"):
                missing.append("GTS_PDFXVersion")
        except Exception:  # noqa: BLE001 – unlesbare Metadaten
            missing = ["XMP"]
        if missing:
            add("error", "xmp", _t("XMP-Metadaten fehlen oder sind unvollständig ({missing}).", missing=", ".join(missing)))
    if info.get("/Trapped") not in (pikepdf.Name("/False"), pikepdf.Name("/True")):
        add("error", "trapped", _t("Angabe zur Überfüllung (Trapped) fehlt."))
    if not str(info.get("/Title", "")):
        add("error", "title", _t("Titel fehlt."))
    if pdf.pdf_version > std["version"]:
        add("error", "version", _t("PDF-Version {version}, für {std} höchstens {max}.", version=pdf.pdf_version, std=std["label"], max=std["version"]))
    if pdf.is_encrypted:
        add("error", "encrypted", _t("Das PDF ist verschlüsselt."))
    if "/ID" not in pdf.trailer:
        add("error", "id", _t("Dokument-ID fehlt."))
    oi = pdf.Root.get("/OutputIntents")
    if not oi or not any(o.get("/S") == pikepdf.Name.GTS_PDFX and "/DestOutputProfile" in o for o in oi):
        add("error", "outputintent", _t("Ausgabebedingung (OutputIntent mit ICC-Profil) fehlt."))
    else:
        head = next(o for o in oi if "/DestOutputProfile" in o).DestOutputProfile.read_bytes()[:12]
        icc_major = head[8] if len(head) > 8 else 2
        if icc_major >= std["icc_max"]:
            add("error", "icc-version", _t("Das eingebettete Profil hat ICC-Version {version}; PDF/X-1a erlaubt nur Version 2.", version=icc_major))

    min_dpi, vector_tac, fonts_ok = math.inf, 0.0, True
    bleed_short = []
    for pno, page in enumerate(pdf.pages, start=1):
        b = _boxes(page)
        if not b["trim"] and not b["art"]:
            add("error", "trimbox", _t("Endformat (TrimBox) fehlt."), pno)
        else:
            t, bl = b["trim"] or b["art"], b["bleed"]
            short = min(t[0] - bl[0], t[1] - bl[1], bl[2] - t[2], bl[3] - t[3]) / PT_PER_MM
            if short < profile.bleed - 0.05:
                bleed_short.append((pno, short))
            m = b["media"]
            if bl[0] < m[0] - .01 or bl[1] < m[1] - .01 or bl[2] > m[2] + .01 or bl[3] > m[3] + .01:
                add("error", "bleedbox", _t("Beschnittrahmen ragt über das Papierformat hinaus."), pno)
        # Transparenz: in PDF/X-1a verboten, in PDF/X-4 erlaubt (dann nur als Hinweis gezählt)
        tlevel = "info" if std["transparency"] else "error"
        if "/Group" in page.obj and page.obj.Group.get("/S") == pikepdf.Name.Transparency:
            add(tlevel, "transparency", _t("Seite verwendet Transparenz."), pno)
        res = page.Resources
        for _, gs in (res.get("/ExtGState") or {}).items():
            smask = gs.get("/SMask")
            if float(gs.get("/CA", 1)) < 1 or float(gs.get("/ca", 1)) < 1 or (smask is not None and smask != pikepdf.Name("/None")) \
                    or gs.get("/BM", pikepdf.Name.Normal) not in (pikepdf.Name.Normal, pikepdf.Name.Compatible):
                add(tlevel, "transparency", _t("Transparenz-Einstellung gefunden."), pno)
        for _, font in (res.get("/Font") or {}).items():
            fd = font.get("/FontDescriptor")
            if font.get("/Subtype") == pikepdf.Name.Type0:
                fd = font.DescendantFonts[0].get("/FontDescriptor")
            if fd is None or not any(k in fd for k in ("/FontFile", "/FontFile2", "/FontFile3")):
                fonts_ok = False
                add("error", "font", _t("Schrift {font} ist nicht eingebettet.", font=font.get('/BaseFont', '?')), pno)
        xobjects = res.get("/XObject") or {}
        for name, xo in xobjects.items():
            if xo.get("/Subtype") != pikepdf.Name.Image:
                continue
            cs = xo.get("/ColorSpace")
            if cs not in (pikepdf.Name.DeviceCMYK, pikepdf.Name.DeviceGray):
                add("error", "rgb-image", _t("Bild {name} ist nicht in CMYK ({cs}).", name=name[1:], cs=cs), pno)
            if "/SMask" in xo or "/Mask" in xo:
                add(tlevel, "transparency", _t("Bild {name} hat eine Transparenzmaske.", name=name[1:]), pno)
        # Inhalt: Farboperatoren und Bildgrößen
        ctm, stack = (1, 0, 0, 1, 0, 0), []
        for operands, op in pikepdf.parse_content_stream(page):
            o = str(op)
            if o == "q":
                stack.append(ctm)
            elif o == "Q":
                ctm = stack.pop() if stack else (1, 0, 0, 1, 0, 0)
            elif o == "cm":
                ctm = _mul(tuple(float(v) for v in operands), ctm)
            elif o in ("k", "K"):
                vector_tac = max(vector_tac, sum(float(v) for v in operands) * 100)
            elif o in ("rg", "RG", "sc", "SC", "scn", "SCN", "cs", "CS"):
                if o in ("cs", "CS") and str(operands[0]) in ("/DeviceCMYK", "/DeviceGray"):
                    continue
                add("error", "rgb-vector", _t("Farbe außerhalb von CMYK im Seiteninhalt ({op}).", op=o), pno)
            elif o == "Do":
                xo = xobjects.get(str(operands[0]))
                if xo is not None and xo.get("/Subtype") == pikepdf.Name.Image:
                    w_pt = math.hypot(ctm[0], ctm[1]) / 72
                    h_pt = math.hypot(ctm[2], ctm[3]) / 72
                    if w_pt > 0 and h_pt > 0:
                        dpi = min(int(xo.Width) / w_pt, int(xo.Height) / h_pt)
                        min_dpi = min(min_dpi, dpi)
                        # Geringe Auflösung macht ein Foto unscharf, die Datei aber nicht ungültig: Hinweis, kein Fehler
                        if dpi < profile.minDpi:
                            add("warn", "dpi", _t("Foto mit nur {dpi} dpi wird sichtbar unscharf (ab {min} dpi gut).", dpi=f"{dpi:.0f}", min=profile.minDpi), pno)
                        elif dpi < profile.goodDpi:
                            add("info", "dpi", _t("Foto mit {dpi} dpi (bestens ab {good} dpi).", dpi=f"{dpi:.0f}", good=profile.goodDpi), pno)
            elif o == "BI":
                add("error", "inline-image", _t("Eingebettetes Inline-Bild gefunden."), pno)
    for pno, short in bleed_short:
        add("error", "bleed", _t("Beschnitt nur {short} mm, verlangt {bleed} mm.", short=f"{short:.1f}", bleed=f"{profile.bleed:g}"), pno)
    tacs = [t for t in (image_tac or []) if t is not None]
    tac = max([vector_tac, *tacs], default=0)
    if tac > profile.tac + 0.5:
        add("error", "tac", _t("Gesamtfarbauftrag bis {tac} %, erlaubt sind {limit} %.", tac=f"{tac:.0f}", limit=profile.tac))
    errors = [i for i in items if i["level"] == "error"]
    summary = [
        {"level": "ok" if not any(i["code"] in ("pdfx-id", "outputintent", "version", "trapped", "title", "id", "xmp", "icc-version") for i in errors) else "error",
         "code": "pdfx", "text": _t("{pdfx} mit Ausgabebedingung {condition}", pdfx=std["label"], condition=profile.condition)},
        {"level": "ok" if not any(i["code"] in ("rgb-image", "rgb-vector") for i in errors) else "error", "code": "cmyk",
         "text": _t("Alle Farben in CMYK, Fotos mit Farbprofil umgerechnet ({intent})", intent=_t("wahrnehmungsorientiert") if profile.intent == "perceptual" else _t("relativ farbmetrisch"))},
        {"level": "ok" if tac <= profile.tac + 0.5 else "error", "code": "tac", "text": _t("Gesamtfarbauftrag höchstens {tac} % (Grenze {limit} %)", tac=f"{tac:.0f}", limit=profile.tac)},
        {"level": "ok" if not bleed_short else "error", "code": "bleed", "text": _t("Beschnitt mindestens {bleed} mm an allen Seiten", bleed=f"{profile.bleed:g}")},
        {"level": "ok" if fonts_ok else "error", "code": "fonts", "text": _t("Schriften vollständig eingebettet")},
        {"level": "error" if any(i["code"] == "transparency" for i in errors) else "ok", "code": "transparency",
         "text": _t("Transparenz (in PDF/X-4 erlaubt)") if any(i["code"] == "transparency" for i in items) else _t("Keine Transparenz")},
    ]
    if min_dpi < math.inf:
        lvl = "warn" if min_dpi < profile.minDpi else "ok"
        summary.append({"level": lvl, "code": "dpi", "text": _t("Kleinste Bildauflösung {dpi} dpi", dpi=f"{min_dpi:.0f}")})
    return {
        "ok": not errors,
        "pdfx": std["label"],
        "standard": standard,
        "profile": profile.public(),
        "pages": len(pdf.pages),
        "maxTac": round(tac, 1),
        "minDpi": None if min_dpi == math.inf else round(min_dpi),
        "summary": summary,
        "items": items,
    }


# -- Softproof ----------------------------------------------------------------------------------
# Wie sieht das Foto gedruckt aus? sRGB → CMYK (wie beim Export) → zurück nach sRGB für den Bildschirm.
# Mit „Papierweiß“ absolut farbmetrisch, dann erscheint Weiß im Ton des Papiers. Die Farbumfangswarnung
# markiert Stellen, die sich durch den Druck deutlich ändern (ΔE76 über 12 zwischen Original und Proof), mit
# einer grauen Schraffur: hebt sich von jedem Fotoinhalt ab, auch von Wiese oder Himmel.
GAMUT_DE = 12
GAMUT_COLOR = (128, 128, 128)


@functools.lru_cache(maxsize=32)
def _proof_transform(path: str, intent: str, paper: bool, mtime: float, icc: bytes | None = None):
    srgb = ImageCms.createProfile("sRGB")
    prof = ImageCms.getOpenProfile(path)
    render = ImageCms.Intent.PERCEPTUAL if intent == "perceptual" else ImageCms.Intent.RELATIVE_COLORIMETRIC
    proof = ImageCms.Intent.ABSOLUTE_COLORIMETRIC if paper else ImageCms.Intent.RELATIVE_COLORIMETRIC
    flags = ImageCms.Flags.SOFTPROOFING | (ImageCms.Flags.BLACKPOINTCOMPENSATION if intent != "perceptual" else ImageCms.Flags.NONE)
    return ImageCms.buildProofTransform(_rgb_source(icc), srgb, prof, "RGB", "RGB", renderingIntent=render,
                                        proofRenderingIntent=proof, flags=flags)


@functools.lru_cache(maxsize=32)
def _cmyk_to_screen(path: str, paper: bool, mtime: float):
    srgb = ImageCms.createProfile("sRGB")
    prof = ImageCms.getOpenProfile(path)
    intent = ImageCms.Intent.ABSOLUTE_COLORIMETRIC if paper else ImageCms.Intent.RELATIVE_COLORIMETRIC
    flags = ImageCms.Flags.NONE if paper else ImageCms.Flags.BLACKPOINTCOMPENSATION
    return ImageCms.buildTransform(prof, srgb, "CMYK", "RGB", renderingIntent=intent, flags=flags)


@functools.lru_cache(maxsize=8)
def _to_lab(icc: bytes | None = None):
    return ImageCms.buildTransform(_rgb_source(icc), ImageCms.createProfile("LAB"), "RGB", "LAB")


def _mtime(profile: PrinterProfile) -> float:
    try:
        return os.path.getmtime(profile.path)
    except OSError:
        return 0.0


def gamut_mask(original: Image.Image, printed: Image.Image, threshold: float = GAMUT_DE, icc: bytes | None = None) -> Image.Image:
    """Maske (Modus „L“) der Stellen, an denen sich die Farbe im Druck um mehr als ``threshold`` ΔE76 ändert.
    Ohne numpy: jeder Lab-Kanal wird so skaliert, dass die gekappte Summe genau bei ΔE² = threshold² 255 erreicht."""
    la, lb = ImageCms.applyTransform(original, _to_lab(icc)), ImageCms.applyTransform(printed, _to_lab())
    t2 = threshold * threshold
    scales = (1 / 2.55, 1.0, 1.0)                      # L liegt in Pillow auf 0–255 für 0–100, a/b in Einheiten
    terms = []
    for x, y, s in zip(la.split(), lb.split(), scales):
        lut = [min(255, round((v * s) ** 2 * 255 / t2)) for v in range(256)]
        terms.append(ImageChops.difference(x, y).point(lut))
    total = ImageChops.add(ImageChops.add(terms[0], terms[1]), terms[2])
    return total.point(lambda v: 255 if v >= 255 else 0)


@functools.lru_cache(maxsize=8)
def _stripes(size: tuple[int, int], period: int = 9, width: int = 4) -> Image.Image:
    """Diagonale Streifen als Maske (Modus „L“), Streifenabstand an die Bildgröße angepasst."""
    period = max(period, round(max(size) / 180))
    width = max(2, period * width // 9)
    row = Image.new("L", (size[0] + size[1], 1))
    row.putdata([255 if i % period < width else 0 for i in range(size[0] + size[1])])
    out = Image.new("L", size)
    for y in range(size[1]):
        out.paste(row.crop((y, 0, y + size[0], 1)), (0, y))
    return out


def proof_image(src: Image.Image, profile: PrinterProfile, paper: bool = True, gamut: bool = False) -> Image.Image:
    """Ergebnis in sRGB. Hat das Bild ein eigenes Farbprofil (Display P3 …), wird von diesem aus gerechnet."""
    icc, _ = rgb_profile(src)
    rgb = src.convert("RGB")
    out = ImageCms.applyTransform(rgb, _proof_transform(profile.path, profile.intent, paper, _mtime(profile), icc))
    if gamut:
        rel = out if not paper else ImageCms.applyTransform(rgb, _proof_transform(profile.path, profile.intent, False, _mtime(profile), icc))
        mask = ImageChops.multiply(gamut_mask(rgb, rel, icc=icc), _stripes(out.size))
        out = Image.composite(Image.new("RGB", out.size, GAMUT_COLOR), out, mask)
    return out


def proof_colors(profile: PrinterProfile, colors: dict, paper: bool = True) -> dict:
    """CMYK-Werte (0–1) der Vektorfarben → so erscheinen sie gedruckt, als #rrggbb; dazu „paper“ (unbedrucktes Papier)."""
    items = {str(k): v for k, v in colors.items() if isinstance(v, (list, tuple)) and len(v) == 4}
    items["paper"] = [0, 0, 0, 0]
    im = Image.new("CMYK", (len(items), 1))
    for i, v in enumerate(items.values()):
        im.putpixel((i, 0), tuple(max(0, min(255, round(float(c) * 255))) for c in v))
    rgb = ImageCms.applyTransform(im, _cmyk_to_screen(profile.path, paper, _mtime(profile)))
    return {k: "#%02x%02x%02x" % rgb.getpixel((i, 0)) for i, k in enumerate(items)}
