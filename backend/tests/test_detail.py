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
    assert detail.parse_fx("f0.6n0.4") == {"fusion": .6, "denoise": .4}
    assert detail.parse_fx("n2") == {"fusion": 0.0, "denoise": 1.0}             # begrenzt
    assert detail.parse_fx("") is None and detail.parse_fx("f0n0") is None and detail.parse_fx("x") is None
    assert detail.fx_key(detail.parse_fx("n.5f.25")) == "f0.25n0.50"


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
