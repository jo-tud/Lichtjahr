"""Bilder verbessern: dasselbe Rezept in Oberfläche (JavaScript) und Dienst (numpy), Druckausgleich, Schärfung."""

import io
import json
import os
import shutil
import subprocess

import pikepdf
import pytest
from PIL import Image, ImageChops, ImageStat

from iccgen import rgb_profile
from lichtjahr.printing import PrinterRegistry, apply_adjust, compose_lut, make_print_pdf, print_tune

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RECIPES = [{"exposure": .4, "contrast": .3, "warmth": .5, "saturation": .4},
           {"exposure": .2, "lvlB": .05, "lvlW": .9, "wbR": 1.06, "wbB": .92},
           {"mono": 1, "contrast": .4, "fade": .05, "warmth": .2},
           {"exposure": -.6, "contrast": -.5, "warmth": -.7, "tint": .4, "saturation": -.8, "shadows": .6, "highlights": -.5}]
PIXELS = [[0, 0, 0], [255, 255, 255], [128, 128, 128], [200, 120, 60], [30, 80, 200], [250, 10, 10], [12, 240, 90]]


@pytest.fixture
def printers(tmp_path):
    return PrinterRegistry(str(tmp_path))


@pytest.mark.skipif(not shutil.which("node"), reason="Node.js fehlt")
def test_same_result_in_app_and_service():
    js = open(os.path.join(ROOT, "prototyp", "src", "b4_adjust.js"), encoding="utf-8").read()
    script = js + f"""
const S = {{ doc: {{ adjust: {{}} }} }};
const out = {json.dumps(RECIPES)}.map(r => {{ const c = compileAdjust(r); return {{ c, px: {json.dumps(PIXELS)}.map(p => adjustRGB(p, c)) }}; }});
process.stdout.write(JSON.stringify(out));"""
    res = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
    im = Image.new("RGB", (len(PIXELS), 1))
    im.putdata([tuple(p) for p in PIXELS])
    for r in res:
        out = apply_adjust(im, r["c"]["m"], r["c"]["lut"])
        got = [out.getpixel((i, 0)) for i in range(len(PIXELS))]
        for a, b in zip(got, r["px"]):
            assert max(abs(x - y) for x, y in zip(a, b)) <= 1, (a, b)


def test_tune_depends_on_paper(printers):
    coated, uncoated = print_tune(printers.get("fogra39")), print_tune(printers.get("fogra47"))
    assert coated["blackL"] < 15 < uncoated["blackL"]
    assert 0 < coated["midtones"] < uncoated["midtones"] and coated["sharpen"]["percent"] < uncoated["sharpen"]["percent"]
    lut = coated["lut"]
    assert lut[0] == 0 and abs(lut[-1] - 1) < 1e-6 and all(b >= a for a, b in zip(lut, lut[1:]))
    assert compose_lut([0, .5, 1], [0, 1]) == [0, .5, 1]


def _pdf(img: Image.Image, extra: str = "") -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=95)
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(200, 100))
    xo = pikepdf.Stream(pdf, buf.getvalue(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=img.width,
                        Height=img.height, ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8, Filter=pikepdf.Name.DCTDecode)
    if extra:
        xo.LJSource = pikepdf.Object.parse(extra.encode())
    pdf.pages[0].Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=xo))
    pdf.pages[0].Contents = pdf.make_stream(b"q 200 0 0 100 0 0 cm /Im0 Do Q")
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


def _cmyk(out: bytes) -> Image.Image:
    with pikepdf.open(io.BytesIO(out)) as pdf:
        return ImageChops.invert(Image.open(io.BytesIO(pdf.pages[0].Resources.XObject.Im0.read_raw_bytes())).convert("CMYK"))


def test_print_tune_sharpens_and_reports(printers):
    im = Image.new("RGB", (200, 100), (230, 230, 230))
    im.paste((40, 40, 40), (100, 0, 200, 100))                        # harte Kante
    plain, r0 = make_print_pdf(_pdf(im), printers.get("fogra39"))
    tuned, r1 = make_print_pdf(_pdf(im), printers.get("fogra39"), tune=True)
    assert "tune" not in r0 and r1["tune"]["midtones"] > 0 and any(s["code"] == "tune" for s in r1["summary"])
    a, b = _cmyk(plain), _cmyk(tuned)
    edge = lambda c: ImageStat.Stat(c.crop((92, 10, 108, 90)).split()[3]).stddev[0]   # noqa: E731
    assert edge(b) > edge(a)                                           # Kante nach dem Schärfen steiler
    assert ImageChops.difference(a.crop((10, 10, 60, 90)), b.crop((10, 10, 60, 90))).getbbox() is None   # Flächen bleiben gleich


def test_wide_photo_gets_recipe_and_tune_in_service(printers):
    buf = io.BytesIO()
    Image.new("RGB", (400, 200), (90, 90, 90)).save(buf, "JPEG", quality=95, icc_profile=rgb_profile("Display P3"))
    original = buf.getvalue()
    base = "/Asset (a) /M [4 0 0 0 4 0] /Photo [400 200] /BG [255 255 255] /Panels []"
    bright = {"exposure": .8}

    if shutil.which("node"):
        js = open(os.path.join(ROOT, "prototyp", "src", "b4_adjust.js"), encoding="utf-8").read()
        c = json.loads(subprocess.run(["node", "-e", js + f"const S={{doc:{{}}}};process.stdout.write(JSON.stringify(compileAdjust({json.dumps(bright)})))"],
                              capture_output=True, text=True, check=True).stdout)
    else:
        pytest.skip("Node.js fehlt")
    adj = f" /AdjM [{' '.join(map(str, c['m']))}] /AdjL [{' '.join(map(str, c['lut']))}]"
    grey = Image.new("RGB", (100, 50), (90, 90, 90))
    k = lambda out: _cmyk(out).getpixel((50, 25))[3]                   # noqa: E731  Schwarzanteil
    p0, _ = make_print_pdf(_pdf(grey, f"<< {base} >>"), printers.get("fogra39"), original=lambda a: original)
    p1, _ = make_print_pdf(_pdf(grey, f"<< {base}{adj} >>"), printers.get("fogra39"), original=lambda a: original)
    p2, _ = make_print_pdf(_pdf(grey, f"<< {base}{adj} >>"), printers.get("fogra39"), original=lambda a: original, tune=True)
    assert k(p1) < k(p0) - 10 and k(p2) < k(p1)                        # heller durch Rezept, noch heller mit Ausgleich


def test_proof_applies_recipe_and_tune(tmp_path):
    from fastapi.testclient import TestClient
    from conftest import photo_bytes, put
    from lichtjahr.api import create_app
    from lichtjahr.config import Settings
    c = TestClient(create_app(Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))), base_url="http://localhost")
    root = tmp_path / "K"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    put(str(root), "Photos/01 January/a.jpg", photo_bytes(color=(100, 110, 120)))
    c.post(f"/api/projects/{pid}/scan", headers=H)
    aid = c.get(f"/api/projects/{pid}/manifest").json()["assets"][0]["id"]
    q = f"/api/projects/{pid}/assets/{aid}/proof?printer=fogra39&size=120&paper=0"
    L = lambda r: ImageStat.Stat(Image.open(io.BytesIO(r.content)).convert("L")).mean[0]   # noqa: E731
    plain, tuned = L(c.get(q)), L(c.get(q + "&tune=1"))
    ident = ",".join(["1", "0", "0", "0", "1", "0", "0", "0", "1"])
    brighter = L(c.get(q + "&adj=" + ident + ";" + ",".join(str(min(1, (i / 64) ** .6)) for i in range(65))))
    assert tuned > plain + 1 and brighter > plain + 5
    assert c.get(f"/api/printers/fogra47/tune").json()["strength"] > c.get("/api/printers/fogra39/tune").json()["strength"]


@pytest.mark.skipif(not shutil.which("node"), reason="Node.js fehlt")
def test_auto_rules():
    """Automatik: dunkel/blaustichig wird heller und neutraler, Sonnenuntergang bleibt warm, ein gut belichtetes Foto
    mit dunklem Hintergrund und dunklem Gesicht wird kaum aufgehellt (kein Hautton als Ziel)."""
    js = open(os.path.join(ROOT, "prototyp", "src", "b4_adjust.js"), encoding="utf-8").read()
    script = js + """
const S = { doc: {} };
function img(w, h, fn) { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x / w, y / h), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } return { w, h, data: d }; }
const dark = img(100, 80, (x, y) => [40 + 50 * x, 50 + 50 * x, 90 + 60 * x]);
const sunset = img(100, 80, (x, y) => y < .75 ? [250 - 40 * y, 140 - 60 * y, 60] : [40, 22, 30]);
// dunkler Hintergrund, dunkles Gesicht in der Mitte, helle Lichter (weißer Anzug unten)
const portrait = img(100, 100, (x, y) => (x > .35 && x < .65 && y > .2 && y < .5) ? [95, 65, 50] : y > .75 ? [245, 245, 240] : [30, 40, 60]);
const face = [{ x: .35, y: .2, w: .3, h: .3, score: .95 }];
// Gegenlicht: großer heller Himmel, dunkles Motiv in der Mitte
const backlit = img(100, 100, (x, y) => (x > .3 && x < .7 && y > .3) ? [40, 34, 30] : [236, 240, 248]);
process.stdout.write(JSON.stringify({ dark: autoRecipe(photoStats(dark)), sunset: autoRecipe(photoStats(sunset)), portrait: autoRecipe(photoStats(portrait, face)),
  brightScene: autoRecipe(photoStats(backlit)), backlit: autoRecipe(photoStats(backlit), { backlit: true }),
  detailOnly: compileAdjust({ fusion: .5, denoise: .3 }) }));"""
    r = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
    assert r["dark"]["exposure"] > .2 and r["dark"]["wbB"] < 1
    assert "wbR" not in r["sunset"] and "wbB" not in r["sunset"]
    assert r["portrait"].get("exposure", 0) <= .2
    # Gegenlicht (Vorschlag des Dienstes): nicht abdunkeln, sonst versinkt das Motiv wieder
    assert r["brightScene"].get("exposure", 0) < 0 and r["backlit"].get("exposure", 0) >= 0
    assert r["detailOnly"] is None                     # nur Detailbearbeitung: kein Farbfilter in der Vorschau
