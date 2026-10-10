"""Druck-PDF: Farbmanagement, PDF/X-1a und Preflight.

Die Oberfläche setzt die Seiten wie gewohnt (Text und Flächen als CMYK-Vektoren), liefert die Fotos aber
als sRGB-JPEG. Hier werden sie mit LittleCMS (Pillow ImageCms) über das Farbprofil der Druckerei nach CMYK
umgerechnet; dann entsteht ein PDF/X-1a:2001 mit OutputIntent. Zum Schluss prüft der Preflight die fertige
Datei selbst – nicht die Annahmen, mit denen sie gebaut wurde.

Druckprofile beschreiben die Vorgaben einer Druckerei: ICC-Profil, Druckbedingung, Rendering Intent,
maximaler Gesamtfarbauftrag, Beschnitt, Mindestauflösung. Mitgelieferte Profile liegen in ``lichtjahr/icc``,
eigene im Datenordner unter ``printers/`` (ICC-Datei plus JSON mit den Vorgaben).
"""

from __future__ import annotations

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
from PIL import Image, ImageChops, ImageCms

from .i18n import _t

PT_PER_MM = 72 / 25.4
PDFX_VERSION = "PDF/X-1:2001"
PDFX_CONFORMANCE = "PDF/X-1a:2001"
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
        if info["version"] >= 4:
            raise PrintError(_t("Das Profil hat ICC-Version 4. PDF/X-1a braucht ein Profil der Version 2; die Druckereien bieten meist beide an."))
        os.makedirs(self.dir, exist_ok=True)
        pid = "eigen-" + uuid.uuid4().hex[:8]
        icc_name = pid + ".icc"
        with open(os.path.join(self.dir, icc_name), "wb") as fh:
            fh.write(icc_bytes)
        allowed = {k: v for k, v in settings.items() if k in ("intent", "tac", "bleed", "minDpi", "goodDpi", "note") and v not in (None, "")}
        p = PrinterProfile(id=pid, name=(name or info["description"] or _t("Eigenes Profil")).strip()[:80], icc=icc_name,
                           condition=info["condition"] or "Custom", info=info["description"], conditionText=info["conditionText"], **allowed)
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


def _transform(profile: PrinterProfile):
    src = ImageCms.createProfile("sRGB")
    dst = ImageCms.getOpenProfile(profile.path)
    intent = ImageCms.Intent.PERCEPTUAL if profile.intent == "perceptual" else ImageCms.Intent.RELATIVE_COLORIMETRIC
    flags = ImageCms.Flags.BLACKPOINTCOMPENSATION if profile.intent != "perceptual" else ImageCms.Flags.NONE
    return ImageCms.buildTransform(src, dst, "RGB", "CMYK", renderingIntent=intent, flags=flags)


def make_print_pdf(data: bytes, profile: PrinterProfile, title: str = "Kalender", progress=None) -> tuple[bytes, dict]:
    """sRGB-Bilder nach CMYK umrechnen, PDF/X-1a-Merkmale setzen, Preflight auf das Ergebnis."""
    try:
        pdf = pikepdf.open(io.BytesIO(data))
    except pikepdf.PdfError as e:
        raise PrintError(_t("Das PDF der Oberfläche ist unlesbar: {error}", error=e)) from e
    transform = _transform(profile)
    images = [(n, xo) for page in pdf.pages for n, xo in (page.Resources.get("/XObject") or {}).items()
              if xo.get("/Subtype") == pikepdf.Name.Image]
    tacs: dict = {}
    for idx, (_, xo) in enumerate(images):
        if progress:
            progress(idx / max(1, len(images)))
        if xo.objgen in tacs:
            continue
        cs = xo.get("/ColorSpace")
        if cs == pikepdf.Name.DeviceRGB:
            rgb = pikepdf.PdfImage(xo).as_pil_image().convert("RGB")
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
    # PDF/X-1a:2001: Ausgabebedingung, Kennungen, Datum, Überfüllung
    with open(profile.path, "rb") as fh:
        icc = fh.read()
    dest = pdf.make_stream(icc)
    dest.N = 4
    pdf.Root.OutputIntents = pikepdf.Array([pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name.OutputIntent, S=pikepdf.Name.GTS_PDFX,
        OutputConditionIdentifier=profile.condition or "Custom", OutputCondition=profile.conditionText or profile.info or profile.name,
        RegistryName=profile.registry, Info=profile.info or profile.name, DestOutputProfile=dest))])
    now = datetime.now(timezone.utc).strftime("D:%Y%m%d%H%M%SZ")
    info = pdf.docinfo
    info.Title = title
    info.Creator = "Lichtjahr"
    info.Producer = "Lichtjahr (LittleCMS, qpdf)"
    if "/CreationDate" not in info:
        info.CreationDate = now
    info.ModDate = now
    info.Trapped = pikepdf.Name("/False")
    info.GTS_PDFXVersion = PDFX_VERSION
    info.GTS_PDFXConformance = PDFX_CONFORMANCE
    out = io.BytesIO()
    pdf.save(out, force_version="1.3", object_stream_mode=pikepdf.ObjectStreamMode.disable,
             compress_streams=True, qdf=False)
    result = out.getvalue()
    report = preflight(result, profile, image_tac=list(tacs.values()))
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


def preflight(data: bytes, profile: PrinterProfile, image_tac: list | None = None) -> dict:
    """Prüft ein PDF gegen PDF/X-1a:2001 (die Teile, die für diesen Ablauf relevant sind) und das Druckprofil."""
    items: list[dict] = []

    def add(level, code, text, page=None):
        items.append({"level": level, "code": code, "text": text, **({"page": page} if page is not None else {})})

    pdf = pikepdf.open(io.BytesIO(data))
    info = pdf.docinfo
    if str(info.get("/GTS_PDFXVersion", "")) != PDFX_VERSION or str(info.get("/GTS_PDFXConformance", "")) != PDFX_CONFORMANCE:
        add("error", "pdfx-id", _t("PDF/X-Kennung fehlt."))
    if info.get("/Trapped") not in (pikepdf.Name("/False"), pikepdf.Name("/True")):
        add("error", "trapped", _t("Angabe zur Überfüllung (Trapped) fehlt."))
    if not str(info.get("/Title", "")):
        add("error", "title", _t("Titel fehlt."))
    if pdf.pdf_version > "1.3":
        add("error", "version", _t("PDF-Version {version}, für PDF/X-1a:2001 höchstens 1.3.", version=pdf.pdf_version))
    if pdf.is_encrypted:
        add("error", "encrypted", _t("Das PDF ist verschlüsselt."))
    if "/ID" not in pdf.trailer:
        add("error", "id", _t("Dokument-ID fehlt."))
    oi = pdf.Root.get("/OutputIntents")
    if not oi or not any(o.get("/S") == pikepdf.Name.GTS_PDFX and "/DestOutputProfile" in o for o in oi):
        add("error", "outputintent", _t("Ausgabebedingung (OutputIntent mit ICC-Profil) fehlt."))

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
        if "/Group" in page.obj and page.obj.Group.get("/S") == pikepdf.Name.Transparency:
            add("error", "transparency", _t("Seite verwendet Transparenz."), pno)
        res = page.Resources
        for _, gs in (res.get("/ExtGState") or {}).items():
            smask = gs.get("/SMask")
            if float(gs.get("/CA", 1)) < 1 or float(gs.get("/ca", 1)) < 1 or (smask is not None and smask != pikepdf.Name("/None")) \
                    or gs.get("/BM", pikepdf.Name.Normal) not in (pikepdf.Name.Normal, pikepdf.Name.Compatible):
                add("error", "transparency", _t("Transparenz-Einstellung gefunden."), pno)
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
                add("error", "transparency", _t("Bild {name} hat eine Transparenzmaske.", name=name[1:]), pno)
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
        {"level": "ok" if not any(i["code"] in ("pdfx-id", "outputintent", "version", "trapped", "title", "id") for i in errors) else "error",
         "code": "pdfx", "text": _t("{pdfx} mit Ausgabebedingung {condition}", pdfx=PDFX_CONFORMANCE, condition=profile.condition)},
        {"level": "ok" if not any(i["code"] in ("rgb-image", "rgb-vector") for i in errors) else "error", "code": "cmyk",
         "text": _t("Alle Farben in CMYK, Fotos mit Farbprofil umgerechnet ({intent})", intent=_t("wahrnehmungsorientiert") if profile.intent == "perceptual" else _t("relativ farbmetrisch"))},
        {"level": "ok" if tac <= profile.tac + 0.5 else "error", "code": "tac", "text": _t("Gesamtfarbauftrag höchstens {tac} % (Grenze {limit} %)", tac=f"{tac:.0f}", limit=profile.tac)},
        {"level": "ok" if not bleed_short else "error", "code": "bleed", "text": _t("Beschnitt mindestens {bleed} mm an allen Seiten", bleed=f"{profile.bleed:g}")},
        {"level": "ok" if fonts_ok else "error", "code": "fonts", "text": _t("Schriften vollständig eingebettet")},
        {"level": "ok" if not any(i["code"] == "transparency" for i in errors) else "error", "code": "transparency", "text": _t("Keine Transparenz")},
    ]
    if min_dpi < math.inf:
        lvl = "warn" if min_dpi < profile.minDpi else "ok"
        summary.append({"level": lvl, "code": "dpi", "text": _t("Kleinste Bildauflösung {dpi} dpi", dpi=f"{min_dpi:.0f}")})
    return {
        "ok": not errors,
        "pdfx": PDFX_CONFORMANCE,
        "profile": profile.public(),
        "pages": len(pdf.pages),
        "maxTac": round(tac, 1),
        "minDpi": None if min_dpi == math.inf else round(min_dpi),
        "summary": summary,
        "items": items,
    }
