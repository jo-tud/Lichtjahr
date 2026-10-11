"""Schriften: aufbereiten (statisch, TrueType, Teilmenge, Einbett-Recht), Google Fonts, Ablage im Projekt."""

import base64
import io
import json
import os
import re

import pytest
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fastapi.testclient import TestClient

from lichtjahr import fonts
from lichtjahr.api import create_app
from lichtjahr.config import Settings

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHARS = fonts.NEEDED + " !?ÉéèàçñÅå€„“"


def jost() -> bytes:
    """Die mitgelieferte Jost aus der Oberfläche: eine echte, statische TrueType-Schrift."""
    js = open(os.path.join(ROOT, "prototyp", "fonts", "fonts.js"), encoding="utf-8").read()
    return base64.b64decode(re.search(r'"regular":\{"ps":"[^"]+","b64":"([^"]+)"', js).group(1))


def built(kind="ttf", fs_type=0, variable=False, chars=CHARS, family="Testschrift") -> bytes:
    """Kleine Schrift mit einem Rechteck je Zeichen: TrueType, CFF-OpenType oder variabel (wght)."""
    names = [".notdef"] + [f"u{ord(c):04X}" for c in chars]
    cmap = {ord(c): f"u{ord(c):04X}" for c in chars}
    fb = FontBuilder(1000, isTTF=kind == "ttf")
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(cmap)
    if kind == "ttf":
        glyphs = {}
        for n in names:
            pen = TTGlyphPen(None)
            pen.moveTo((50, 0)); pen.lineTo((50, 700)); pen.lineTo((450, 700)); pen.lineTo((450, 0)); pen.closePath()
            glyphs[n] = pen.glyph()
        fb.setupGlyf(glyphs)
    else:
        cs = {}
        for n in names:
            pen = T2CharStringPen(500, None)
            pen.moveTo((50, 0)); pen.lineTo((50, 700)); pen.lineTo((450, 700)); pen.lineTo((450, 0)); pen.closePath()
            cs[n] = pen.getCharString()
        fb.setupCFF(family.replace(" ", ""), {"FullName": family}, cs, {})
    fb.setupHorizontalMetrics({n: (500, 50) for n in names})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": family, "styleName": "Regular", "psName": family.replace(" ", "") + "-Regular"})
    fb.setupOS2(fsType=fs_type, sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    if variable:
        fb.setupFvar([("wght", 100, 400, 900, "Weight")], [])
        fb.setupGvar({n: [TupleVariation({"wght": (0, 1, 1)}, [(0, 0), (0, 0), (80, 0), (80, 0), (0, 0), (0, 0), (0, 0), (0, 0)])] for n in names})
    out = io.BytesIO()
    fb.save(out)
    return out.getvalue()


def advance(data: bytes, ch: str) -> int:
    f = TTFont(io.BytesIO(data))
    return f["hmtx"][f.getBestCmap()[ord(ch)]][0]


def test_static_truetype_is_subset_to_the_calendar_characters():
    data, meta = fonts.normalize(jost())
    f = TTFont(io.BytesIO(data))
    cmap = f.getBestCmap()
    assert "glyf" in f and "fvar" not in f
    assert all(ord(c) in cmap for c in "Aäß€„") and 0x0410 not in cmap        # kein Kyrillisch mehr
    assert meta["family"] == "Jost" and meta["missing"] == []
    assert len(data) < len(jost())


def test_cff_opentype_becomes_truetype():
    data, meta = fonts.normalize(built("otf"))
    f = TTFont(io.BytesIO(data))
    assert "glyf" in f and "CFF " not in f and meta["missing"] == []
    g = f["glyf"][f.getBestCmap()[ord("A")]]
    assert g.numberOfContours == 1                                               # Umriss ist erhalten


def test_variable_font_is_pinned_to_the_weight():
    var = built("ttf", variable=True)
    reg, _ = fonts.normalize(var, 400)
    bold, _ = fonts.normalize(var, 900)
    fr, fb = TTFont(io.BytesIO(reg)), TTFont(io.BytesIO(bold))
    assert "fvar" not in fr and "fvar" not in fb
    gr, gb = fr["glyf"][fr.getBestCmap()[65]], fb["glyf"][fb.getBestCmap()[65]]
    gr.recalcBounds(fr["glyf"]); gb.recalcBounds(fb["glyf"])
    assert gb.xMax - gr.xMax == pytest.approx(80, abs=1)                        # kräftiger Schnitt ist breiter
    files, meta = fonts.from_uploads(var, None)
    assert set(files) == {"regular", "bold"}                                      # eine variable Datei liefert beide


def test_restricted_license_and_garbage_are_refused():
    with pytest.raises(fonts.FontError, match="(?i)lizenz|licen"):
        fonts.normalize(built(fs_type=0x0002))
    fonts.normalize(built(fs_type=0x0004))                                       # „Preview & Print“ ist erlaubt
    with pytest.raises(fonts.FontError):
        fonts.normalize(b"kein font")
    with pytest.raises(fonts.FontError, match="(?i)lateinisch|latin"):
        fonts.normalize(built(chars="0123456789"))
    _, meta = fonts.normalize(built(chars=CHARS.replace("ß", "")))
    assert meta["missing"] == ["ß"]


def test_google_catalog_and_files_with_cache(tmp_path):
    cat = {"familyMetadataList": [
        {"family": "Gute Schrift", "category": "Serif", "subsets": ["latin"], "fonts": {"400": {}, "700": {}}, "popularity": 5, "axes": []},
        {"family": "Nur Kyrillisch", "category": "Sans Serif", "subsets": ["cyrillic"], "fonts": {"400": {}}, "popularity": 1, "axes": []},
        {"family": "Variabel", "category": "Sans Serif", "subsets": ["latin"], "fonts": {"400": {}}, "popularity": 2,
         "axes": [{"tag": "wght", "min": 300, "max": 800}]}]}
    out = fonts.catalog(str(tmp_path), fetch=lambda: ")]}'\n" + json.dumps(cat))
    assert [f["family"] for f in out] == ["Variabel", "Gute Schrift"]
    assert 600 in out[0]["weights"] and out[1]["weights"] == [400, 700]
    assert fonts.catalog(str(tmp_path), fetch=lambda: 1 / 0) == out                 # aus dem Zwischenspeicher
    calls = []

    def get(url, **kw):
        calls.append(url)
        if "css2" in url:
            assert kw["headers"]["User-Agent"] == fonts.LEGACY_UA and kw["params"]["family"] == "Gute Schrift:wght@400;700"
            return (b"@font-face { font-family: 'Gute Schrift'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/r.ttf) format('truetype'); }"
                    b"@font-face { font-family: 'Gute Schrift'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/b.ttf) format('truetype'); }")
        return built("ttf", family="Gute Schrift")
    info = fonts.google_files("Gute Schrift", str(tmp_path), [400, 700], get=get)
    assert set(info["files"]) == {"regular", "bold"} and len(calls) == 3
    again = fonts.google_files("Gute Schrift", str(tmp_path), [400, 700], get=lambda *a, **k: 1 / 0)
    assert again == info                                                          # zweites Mal ohne Netz


def test_api_upload_lists_and_serves_project_fonts(tmp_path):
    settings = Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))
    c = TestClient(create_app(settings), base_url="http://localhost")
    pid = c.post("/api/projects", json={"path": str(tmp_path / "K"), "calendarYear": 2027}).json()["id"]
    up = {"regular": ("Testschrift.otf", built("otf"), "font/otf")}
    assert c.post(f"/api/projects/{pid}/fonts", files=up).status_code == 423        # nur mit Sperre
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    r = c.post(f"/api/projects/{pid}/fonts", headers=H, files={**up, "bold": ("B.ttf", built("ttf", variable=True), "font/ttf")})
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["family"] == "Testschrift" and e["source"] == "upload" and set(e["files"]) == {"regular", "bold"}
    assert os.path.exists(tmp_path / "K" / ".lichtjahr" / "fonts" / e["files"]["regular"])
    assert c.get(f"/api/projects/{pid}/fonts").json()["fonts"] == [e]
    f = c.get(f"/api/projects/{pid}/fonts/{e['files']['bold']}")
    assert f.status_code == 200 and f.headers["content-type"] == "font/ttf" and "glyf" in TTFont(io.BytesIO(f.content))
    assert c.get(f"/api/projects/{pid}/fonts/..%2Flock.json").status_code in (400, 404)
    bad = c.post(f"/api/projects/{pid}/fonts", headers=H, files={"regular": ("x.ttf", built(fs_type=2), "font/ttf")})
    assert bad.status_code == 400 and "PDF" in bad.json()["detail"]
    # gleiche Familie noch einmal: ersetzt den Eintrag statt ihn zu verdoppeln
    c.post(f"/api/projects/{pid}/fonts", headers=H, files={"regular": ("Testschrift.ttf", built("ttf"), "font/ttf")})
    assert len(c.get(f"/api/projects/{pid}/fonts").json()["fonts"]) == 1
