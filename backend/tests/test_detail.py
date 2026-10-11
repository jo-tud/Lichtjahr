"""Detailbearbeitung: Gegenlicht ausgleichen (Belichtungsfusion), Rauschen mindern, Analyse mit Vorschlag."""

import io
import os

import numpy as np
import pikepdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageFilter

from conftest import put
from iccgen import rgb_profile
from lichtjahr import detail
from lichtjahr.api import create_app
from lichtjahr.config import Settings
from lichtjahr.printing import PrinterRegistry, make_print_pdf

pytestmark = pytest.mark.skipif(not detail.available(), reason="OpenCV fehlt")
DATA = os.path.join(os.path.dirname(__file__), "data")


def portrait() -> np.ndarray:
    return np.asarray(Image.open(os.path.join(DATA, "portrait.jpg")).convert("RGB"), np.float32) / 255


def backlit():
    """Person im Gegenlicht: Motiv stark abgedunkelt vor hellem Himmel; dazu die Maske des Motivs."""
    a = portrait()
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    mask = np.clip(1.3 - np.hypot((xx - w / 2) / (w * .33), (yy - h * .55) / (h * .45)), 0, 1)
    mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(8)), np.float32) / 255
    sky = np.dstack([np.full((h, w), .93), np.full((h, w), .95), np.full((h, w), 1.0)]) - (yy / h * .15)[..., None]
    out = mask[..., None] * a * .28 + (1 - mask[..., None]) * sky
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)), mask


def noisy(level=1.0, seed=7) -> Image.Image:
    """Unterbelichtetes Handyfoto: Rauschen im Linearlicht, grobes Farbrauschen, aufgehellt, JPEG."""
    rng = np.random.default_rng(seed)
    lin = portrait() ** 2.2 * .18
    h, w = lin.shape[:2]
    blotch = np.asarray(Image.fromarray((rng.normal(128, 40, (h // 3 + 1, w // 3 + 1, 3))).clip(0, 255).astype(np.uint8))
                        .resize((w + 3, h + 3), Image.BICUBIC), np.float32)[:h, :w] / 40 * .01 * level - 128 / 40 * .01 * level
    n = lin + rng.normal(0, 1, lin.shape) * np.sqrt(lin * .004 * level) + rng.normal(0, .004 * level, lin.shape) + blotch
    buf = io.BytesIO()
    Image.fromarray((np.clip(np.clip(n, 0, 1) ** (1 / 2.2) * 1.9, 0, 1) * 255).astype(np.uint8)).save(buf, "JPEG", quality=85)
    return Image.open(io.BytesIO(buf.getvalue()))


def luma(im):
    return detail._luma(np.asarray(im.convert("RGB"), np.float32) / 255)


def test_fx_text():
    zero = {"fusion": 0.0, "denoise": 0.0, "highlights": 0.0, "shadows": 0.0, "clarity": 0.0, "texture": 0.0}
    assert detail.parse_fx("f0.6n0.4") == {**zero, "fusion": .6, "denoise": .4}
    assert detail.parse_fx("n2f-1") == {**zero, "denoise": 1.0}                  # begrenzt, Fusion nie negativ
    assert detail.parse_fx("h-0.3s0.5c2") == {**zero, "highlights": -.3, "shadows": .5, "clarity": 1.0}
    assert detail.parse_fx("") is None and detail.parse_fx("f0n0") is None and detail.parse_fx("x") is None
    assert detail.fx_key(detail.parse_fx("n.5f.25s-.1")) == "f0.25n0.50s-0.10"
    assert detail.parse_fx("t-0.4")["texture"] == -.4 and detail.fx_key(detail.parse_fx("t.3n.2")) == "n0.20t0.30"


def test_fusion_lifts_the_subject_and_keeps_white_sky():
    im, mask = backlit()
    out = detail.apply(im, {"fusion": 1.0})
    y0, y1 = luma(im), luma(out)
    subject, sky = mask > .9, mask < .05
    assert y1[subject].mean() - y0[subject].mean() > .08                         # Motiv deutlich heller
    assert y1[sky].mean() > y0[sky].mean() - .02                               # Himmel wird nicht grau


def test_fusion_looks_the_same_in_preview_and_print():
    """Die Helligkeitskarte entsteht immer auf 1600 Pixeln: groß gerechnet und verkleinert ≈ klein gerechnet."""
    im, _ = backlit()
    big = im.resize((im.width * 4, im.height * 4), Image.BICUBIC)      # 2240 × 2800, wie ein Original
    small = big.resize((1280, 1600), Image.LANCZOS)                    # wie die Vorschau mit 1600 Pixeln
    a = np.asarray(detail.apply(big, {"fusion": .7}).resize(small.size, Image.LANCZOS), np.float32)
    b = np.asarray(detail.apply(small, {"fusion": .7}), np.float32)
    assert np.abs(a - b).mean() < 4.0


def test_denoise_lowers_noise_and_keeps_detail():
    im = noisy()
    out = detail.apply(im, {"denoise": .8})
    gray = lambda x: np.asarray(x.convert("L"), np.float32)          # noqa: E731
    assert detail.noise_sigma(gray(out)) < .6 * detail.noise_sigma(gray(im))
    assert abs(luma(out).mean() - luma(im).mean()) < .01                       # Helligkeit bleibt


def test_profile_survives():
    im, _ = backlit()
    im.info["icc_profile"] = rgb_profile("Display P3")
    assert detail.apply(im, {"fusion": .5, "denoise": .3}).info["icc_profile"] == im.info["icc_profile"]
    assert detail.apply(im, None) is im


def test_analysis_suggests_only_where_needed():
    im, _ = backlit()
    clean = Image.open(os.path.join(DATA, "portrait.jpg"))
    assert detail.analyze(im, im)["backlit"] and detail.analyze(im, im)["fusion"] > .3
    q = detail.analyze(clean, clean)
    assert q["fusion"] == 0 and q["denoise"] == 0
    assert detail.analyze(noisy(), noisy())["denoise"] > .3


def jpeg(im, **kw) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92, **kw)
    return buf.getvalue()


def test_api_preview_proof_original_and_quality(tmp_path):
    c = TestClient(create_app(Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))), base_url="http://localhost")
    root = tmp_path / "Kalender"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    im, _ = backlit()
    put(str(root), "Photos/07 July/beach.jpg", jpeg(im))
    added = c.post(f"/api/projects/{pid}/scan", headers=H).json()["added"][0]
    aid = added["id"] if isinstance(added, dict) else added
    base = f"/api/projects/{pid}/assets/{aid}"

    plain = c.get(f"{base}/thumb?size=360")
    lifted = c.get(f"{base}/thumb?size=360&fx=f0.7")
    assert lifted.status_code == 200 and lifted.content != plain.content
    assert luma(Image.open(io.BytesIO(lifted.content))).mean() > luma(Image.open(io.BytesIO(plain.content))).mean()
    assert c.get(f"{base}/thumb?size=360&fx=f0").content == plain.content            # nichts Wirksames: normale Vorschau

    orig = c.get(f"{base}/original?fx=f0.7n0.3")
    assert orig.status_code == 200 and orig.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(orig.content)).size == im.size

    p0 = c.get(f"{base}/proof?printer=fogra39&size=360")
    p1 = c.get(f"{base}/proof?printer=fogra39&size=360&fx=f0.7")
    assert p1.status_code == 200 and p1.content != p0.content

    q = c.post(f"/api/projects/{pid}/quality", json={"ids": [aid, "gibtsnicht"]}).json()
    assert q["available"] and set(q["quality"]) == {aid}
    assert q["quality"][aid]["backlit"] and q["quality"][aid]["fusion"] > 0


def test_print_applies_fx_to_wide_photo(tmp_path):
    """Fotos mit großem Farbraum rendert der Dienst selbst aus dem Original – auch dort mit der Detailbearbeitung."""
    p3 = rgb_profile("Display P3")
    im, _ = backlit()
    original = jpeg(im, icc_profile=p3)
    printers = PrinterRegistry(str(tmp_path))

    def pdf_with(fx):
        buf = io.BytesIO()
        im.resize((112, 140)).save(buf, "JPEG", quality=95)
        pdf = pikepdf.new()
        pdf.add_blank_page(page_size=(112, 140))
        xo = pikepdf.Stream(pdf, buf.getvalue(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=112, Height=140,
                            ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8, Filter=pikepdf.Name.DCTDecode)
        fxs = f" /FX ({fx})" if fx else ""
        xo.LJSource = pikepdf.Object.parse(f"<< /Asset (a1) /M [5 0 0 0 5 0] /Photo [560 700] /BG [255 255 255] /Panels []{fxs} >>".encode())
        pdf.pages[0].Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=xo))
        pdf.pages[0].Contents = pdf.make_stream(b"q 112 0 0 140 0 0 cm /Im0 Do Q")
        out = io.BytesIO()
        pdf.save(out)
        res, _ = make_print_pdf(out.getvalue(), printers.get("fogra39"), standard="x4", original=lambda a: original)
        with pikepdf.open(io.BytesIO(res)) as doc:
            return Image.open(io.BytesIO(doc.pages[0].Resources.XObject.Im0.read_raw_bytes())).convert("CMYK")

    plain, lifted = pdf_with(""), pdf_with("f0.8")
    k = lambda c: np.asarray(c, np.float32)[50:90, 40:70, 3].mean()   # noqa: E731  (Schwarzanteil im Motiv)
    assert k(lifted) > k(plain) + 5         # im PDF ist das CMYK-JPEG invertiert: höher = weniger Schwarz = heller


def fairness_scene(skin: float, flat: bool):
    """Dieselbe Szene mit heller (1.0) oder dunkler Haut (0.3: Reflexion der Haut × 0,3), vor hellem Himmel;
    flat: flaches, schwaches Licht wie im Gegenlicht."""
    src = portrait() ** 2.2
    h, w = src.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    subj = np.clip(1.3 - np.hypot((xx - w / 2) / (w * .33), (yy - h * .55) / (h * .45)), 0, 1)
    subj = np.asarray(Image.fromarray((subj * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(8)), np.float32) / 255
    fm = np.zeros((h, w), np.float32)
    a0, a1, b0, b1 = detail._boxes((h, w), {"x": FACE["x"] + FACE["w"] * .1, "y": FACE["y"] + FACE["h"] * .05, "w": FACE["w"] * .8, "h": FACE["h"] * .9}, 0)
    fm[a0:a1, b0:b1] = 1
    fm = np.asarray(Image.fromarray((fm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
    lin = src * (1 - fm[..., None] * (1 - skin))
    if flat:
        m = (lin * subj[..., None]).sum((0, 1)) / subj.sum()
        lin = (m + (lin - m) * .45) * .1
    sky = np.dstack([np.full((h, w), .85), np.full((h, w), .88), np.full((h, w), .95)])
    return (np.clip(subj[..., None] * lin + (1 - subj[..., None]) * sky, 0, 1) ** (1 / 2.2)).astype(np.float32)


FACE = {"x": .386, "y": .236, "w": .247, "h": .232, "score": .95}       # Gesicht in portrait.jpg (YuNet)


@pytest.mark.parametrize("flat", [False, True])
def test_same_decision_and_lift_for_light_and_dark_skin(flat):
    """Fairness: Gegenlicht-Entscheidung und Aufhellung im Gesicht hängen nicht von der Hautfarbe ab."""
    h, w = portrait().shape[:2]
    a0, a1, b0, b1 = detail._boxes((h, w), FACE, 0)
    res = {}
    for skin in (1.0, .3):
        p = fairness_scene(skin, flat)
        im = Image.fromarray((p * 255).astype(np.uint8))
        q = detail.analyze(im, im, [FACE])
        g = detail.tone_log_gain(p, {"fusion": .6, "shadows": .5}, [FACE])
        res[skin] = (q["backlit"], q["fusion"], 2.2 * float(g[a0:a1, b0:b1].mean()))
    assert res[1.0][:2] == res[.3][:2]                                    # gleiche Entscheidung
    assert abs(res[1.0][2] - res[.3][2]) < .2                             # gleiche Aufhellung (Blenden)


def test_face_never_lifted_more_than_its_surroundings():
    p = fairness_scene(.3, True)
    g = detail.tone_log_gain(p, {"fusion": .8, "shadows": .8}, [FACE])
    h, w = g.shape
    a0, a1, b0, b1 = detail._boxes((h, w), FACE, 0)
    ring = np.zeros((h, w), bool)
    r0, r1, c0, c1 = detail._boxes((h, w), FACE, 1.2)
    ring[r0:r1, c0:c1] = True
    i0, i1, j0, j1 = detail._boxes((h, w), FACE, .35)
    ring[i0:i1, j0:j1] = False
    lifted = g[ring][g[ring] > .05]
    assert np.percentile(g[a0:a1, b0:b1], 90) <= np.median(lifted) + .02


def test_lit_faces_are_not_backlit():
    """Ein deutlich von der Seite beleuchtetes Gesicht vor hellem Himmel ist kein Gegenlicht – egal wie hell die Haut."""
    im, _ = backlit()
    a = np.asarray(im, np.float32) / 255
    h, w = a.shape[:2]
    a0, a1, b0, b1 = detail._boxes((h, w), FACE, 0)
    lin = a ** 2.2
    lin[a0:a1, b0:b1] *= np.linspace(.4, 3.0, b1 - b0)[None, :, None]   # Licht von rechts: starkes Gefälle im Gesicht
    lit = Image.fromarray((np.clip(lin, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8))
    assert detail.analyze(im, im, [])["backlit"]
    assert not detail.analyze(lit, lit, [FACE])["backlit"]


def test_local_tone_controls():
    """Lichter/Tiefen wirken nach Beleuchtung und lassen Weiß weiß; Klarheit verstärkt mittlere Details."""
    im, mask = backlit()
    y0 = luma(im)
    shadows = luma(detail.apply(im, {"shadows": .8}))
    assert shadows[mask > .9].mean() > y0[mask > .9].mean() + .03
    white = Image.new("RGB", (400, 300), (250, 250, 250))
    white.paste(Image.new("RGB", (200, 150), (120, 110, 100)), (100, 75))
    hl = np.asarray(detail.apply(white, {"highlights": -1.0}), np.float32)
    assert hl[10, 10].min() >= 245                                       # Weiß bleibt weiß
    # Klarheit am Muster mit bekannter Größe: mittelgroße Details (64 px auf 1600) kräftiger, feine (8 px, dort
    # sitzt das Rauschen) unverändert, große Kanten (der Helligkeitsverlauf) bleiben
    import cv2
    yy, xx = np.mgrid[0:1200, 0:1600].astype(np.float32)
    def amp(period, amount):
        L = -3 + .2 * np.sin(2 * np.pi * xx / period) + xx / 1600 * 2
        out = detail.clarity(L, amount)
        d = lambda x: np.abs((x - cv2.GaussianBlur(x, (0, 0), period))[100:-100, 100:-100]).mean()   # noqa: E731
        return d(out) / d(L)
    assert amp(64, .8) > 1.4 and amp(8, .8) < 1.05 and amp(64, -.8) < .8


# -- Rauschen nach Aufhellung, Struktur, Ausgabeschärfung, Drucklupe --------------------------
def grain(seed=3, sigma=6.0, size=(240, 320)):
    rng = np.random.default_rng(seed)
    return np.clip(np.full((*size, 3), .35, np.float32) + rng.normal(0, sigma / 255, (*size, 1)).astype(np.float32), 0, 1)


def test_denoise_is_stronger_where_lifted():
    """Was danach aufgehellt wird, rauscht sichtbar stärker – dort wird kräftiger entrauscht, der Rest wie zuvor."""
    a = grain()
    lift = np.zeros(a.shape[:2], np.float32)
    lift[:, :160] = 1.5                                                # linke Hälfte wird 1,5 Blenden heller
    plain, aware = detail.denoise(a, .5), detail.denoise(a, .5, lift)
    noise = lambda x: detail.noise_sigma(detail._luma(x) * 255)       # noqa: E731
    assert noise(aware[:, 20:140]) < noise(plain[:, 20:140]) * .8
    assert abs(noise(aware[:, 180:300]) - noise(plain[:, 180:300])) < .25


def test_texture_lifts_fine_detail_but_not_noise_or_edges():
    h, w = 240, 320
    yy, xx = np.mgrid[0:h, 0:w]
    fine = (.45 + .03 * np.sin(xx / .8) * (xx > w // 3))[..., None].repeat(3, 2).astype(np.float32)   # glatt | feine Struktur
    amp = lambda x: float(detail._luma(x)[:, 140:300].std())           # noqa: E731
    assert amp(detail.texture(fine, .8)) > amp(fine) * 1.3
    assert amp(detail.texture(fine, -.8)) < amp(fine) * .7              # negativ: glätten
    noise = grain(sigma=4.0)
    assert detail.noise_sigma(detail._luma(detail.texture(noise, .8)) * 255) < detail.noise_sigma(detail._luma(noise) * 255) * 1.2
    step = np.where(xx < w // 2, .2, .8)[..., None].repeat(3, 2).astype(np.float32)
    out = detail.texture(step, 1.0)
    assert out.min() > .2 - .01 and out.max() < .8 + .01                 # keine Säume an der großen Kante


def test_print_sharpening_cores_noise_and_limits_halos():
    h, w = 120, 160
    yy, xx = np.mgrid[0:h, 0:w]
    step = np.where(xx < w // 2, .25, .75)[..., None].repeat(3, 2).astype(np.float32)
    step = detail._resize(detail._resize(step, w // 2, h // 2), w, h)    # weiche Kante wie nach dem Verkleinern
    out = detail.sharpen(step, 1.0, 1.4)
    grad = lambda x: float(np.abs(np.diff(detail._luma(x), axis=1)).max())   # noqa: E731
    assert grad(out) > grad(step) * 1.2                                  # Kante steiler
    assert out.min() > .25 - .035 and out.max() < .75 + .035            # Säume begrenzt (klassisch: ±0,15)
    noise = grain(sigma=3.0)
    assert detail.noise_sigma(detail._luma(detail.sharpen(noise, 1.0, 1.4)) * 255) < detail.noise_sigma(detail._luma(noise) * 255) * 1.25


def test_loupe_shows_print_pixels(tmp_path):
    c = TestClient(create_app(Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))), base_url="http://localhost")
    root = tmp_path / "Kalender"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    im = noisy(1.0)
    put(str(root), "Photos/03 March/night.jpg", jpeg(im))
    added = c.post(f"/api/projects/{pid}/scan", headers=H).json()["added"][0]
    base = f"/api/projects/{pid}/assets/{added['id'] if isinstance(added, dict) else added}/loupe"

    r = c.get(f"{base}?cx=.5&cy=.5&w=200&h=100&scale=1")
    assert r.status_code == 200 and Image.open(io.BytesIO(r.content)).size == (200, 100)
    x, y, bw, bh = (float(v) for v in r.headers["x-lichtjahr-box"].split(","))
    assert abs(x + bw / 2 - .5) < .01 and abs(bw - 200 / im.width) < .01
    corner = c.get(f"{base}?cx=0&cy=0&w=200&h=100&scale=1")             # am Rand eingerückt, nicht schwarz aufgefüllt
    assert corner.headers["x-lichtjahr-box"].startswith("0.00000,0.00000")
    half = c.get(f"{base}?cx=.5&cy=.5&w=100&h=50&scale=.5")              # halbe Druckauflösung: gleicher Ausschnitt
    assert Image.open(io.BytesIO(half.content)).size == (100, 50) and half.headers["x-lichtjahr-box"] == r.headers["x-lichtjahr-box"]
    clean = c.get(f"{base}?cx=.5&cy=.5&w=200&h=100&scale=1&fx=n0.6")
    assert luma(Image.open(io.BytesIO(clean.content))).std() < luma(Image.open(io.BytesIO(r.content))).std()
    tuned = c.get(f"{base}?cx=.5&cy=.5&w=200&h=100&scale=1&printer=fogra39&tune=1")
    proof = c.get(f"{base}?cx=.5&cy=.5&w=200&h=100&scale=1&printer=fogra39&tune=1&proof=1")
    assert len({r.content, tuned.content, proof.content}) == 3
