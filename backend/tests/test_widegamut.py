"""Fotos mit großem Farbraum (Display P3, Adobe RGB): Erkennung, Vorschau mit Profil, Druck aus dem Original."""

import io

import pikepdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageChops, ImageCms

from conftest import put
from iccgen import ADOBE_D50, rgb_profile
from lichtjahr.api import create_app
from lichtjahr.config import Settings
from lichtjahr.media import make_thumbnail, rgb_profile as detect
from lichtjahr.printing import PrinterRegistry, make_print_pdf, proof_image

P3 = rgb_profile("Display P3")
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
GREEN, ORANGE = (0, 255, 0), (255, 120, 0)          # Grün liegt in P3 weit außerhalb von sRGB


def photo(icc=P3, size=(400, 200), left=GREEN, right=ORANGE, fmt="JPEG") -> bytes:
    im = Image.new("RGB", size, left)
    im.paste(Image.new("RGB", (size[0] // 2, size[1]), right), (size[0] // 2, 0))
    buf = io.BytesIO()
    im.save(buf, fmt, quality=95, **({"icc_profile": icc} if icc else {}))
    return buf.getvalue()


def as_browser(data: bytes) -> Image.Image:
    """So landet das Foto auf der Canvas der Oberfläche: in sRGB umgerechnet (und beschnitten)."""
    im = Image.open(io.BytesIO(data))
    icc = im.info.get("icc_profile")
    if not icc:
        return im.convert("RGB")
    return ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), ImageCms.createProfile("sRGB"), outputMode="RGB")


def app_pdf(img: Image.Image, spec: str | None) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=95)
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(200, 100))
    xo = pikepdf.Stream(pdf, buf.getvalue(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=img.width,
                        Height=img.height, ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8, Filter=pikepdf.Name.DCTDecode)
    if spec:
        xo.LJSource = pikepdf.Object.parse(spec.encode())
    pdf.pages[0].Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=xo))
    pdf.pages[0].Contents = pdf.make_stream(b"q 200 0 0 100 0 0 cm /Im0 Do Q")
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


def codes_of(report):
    return {i["code"] for i in report["items"] if i["level"] == "error"}


def cmyk_at(out: bytes, xy) -> tuple:
    with pikepdf.open(io.BytesIO(out)) as pdf:
        img = pdf.pages[0].Resources.XObject.Im0
        assert "/LJSource" not in img                 # Herkunftsangabe gehört nicht ins Druck-PDF
        return ImageChops.invert(Image.open(io.BytesIO(img.read_raw_bytes()))).getpixel(xy)


@pytest.fixture
def fogra39(tmp_path):
    return PrinterRegistry(str(tmp_path)).get("fogra39")


def test_detects_wide_color_spaces():
    for data, expect in ((photo(P3), "Display P3"), (photo(rgb_profile("Adobe RGB (1998)", ADOBE_D50)), "Adobe RGB (1998)"),
                         (photo(SRGB), None), (photo(None), None), (photo(P3, fmt="PNG"), "Display P3")):
        icc, name = detect(Image.open(io.BytesIO(data)))
        assert (name if icc else None) == expect


def test_thumbnail_keeps_wide_profile_only():
    assert Image.open(io.BytesIO(make_thumbnail(io.BytesIO(photo(P3)), 120))).info.get("icc_profile") == P3
    assert not Image.open(io.BytesIO(make_thumbnail(io.BytesIO(photo(None)), 120))).info.get("icc_profile")


def test_print_renders_wide_photo_from_original(fogra39):
    original = photo(P3)
    # Ausschnitt: Zielbild 100 × 50 aus dem ganzen Foto (400 × 200), Zielpixel → Fotopixel: Faktor 4
    spec = "<< /Asset (a_1) /M [4 0 0 0 4 0] /Photo [400 200] /BG [255 255 255] /Panels [] >>"
    browser = as_browser(original).resize((100, 50))
    sent = app_pdf(browser, spec)
    plain, r0 = make_print_pdf(app_pdf(browser, None), fogra39)
    wide, r1 = make_print_pdf(sent, fogra39, original=lambda aid: original if aid == "a_1" else None)
    assert not codes_of(r1) & {"rgb-image", "rgb-vector"}
    assert r1["wide"] == {"Display P3": 1} and any(s["code"] == "wide" and "Display P3" in s["text"] for s in r1["summary"])
    assert "wide" not in r0
    # Links das P3-Grün: aus dem Original kräftiger (weniger Cyan-Verschmutzung durch Magenta) als die beschnittene sRGB-Fassung
    g_plain, g_wide = cmyk_at(plain, (20, 25)), cmyk_at(wide, (20, 25))
    assert g_plain != g_wide
    # rechts bleibt Orange Orange: Geometrie stimmt (kein Cyan, viel Magenta und Gelb)
    c, m, y, _ = cmyk_at(wide, (80, 25))
    assert c < 40 and m > 100 and y > 200
    # ohne Original (Datei fehlt): Fassung der Oberfläche, nur ohne Herkunftsangabe
    fallback, r2 = make_print_pdf(sent, fogra39, original=lambda aid: None)
    assert "wide" not in r2 and cmyk_at(fallback, (20, 25)) == g_plain


def test_print_wide_crop_with_offset_rotation_and_panel(fogra39):
    original = photo(P3)
    # nur die rechte (orange) Hälfte, um 180° gedreht, mit halbtransparenter weißer Fläche über der unteren Hälfte
    spec = "<< /Asset (a_1) /M [-2 0 400 0 -2 200] /Photo [400 200] /BG [255 255 255] /Panels [0 50 100 50 255 255 255 0.5] >>"
    out, rep = make_print_pdf(app_pdf(Image.new("RGB", (100, 100), (0, 0, 0)), spec), fogra39, original=lambda aid: original)
    assert rep["wide"] == {"Display P3": 1}
    top, bottom = cmyk_at(out, (50, 20)), cmyk_at(out, (50, 80))
    assert top[0] < 40 and top[2] > 200                 # Orange statt des schwarzen Platzhalters
    assert bottom[1] < top[1] - 40 and bottom[2] < top[2] - 40   # unter der Fläche heller


def test_srgb_photo_keeps_browser_rendering(fogra39):
    spec = "<< /Asset (a_1) /M [4 0 0 0 4 0] /Photo [400 200] /BG [255 255 255] /Panels [] >>"
    browser = as_browser(photo(SRGB)).resize((100, 50))
    out, rep = make_print_pdf(app_pdf(browser, spec), fogra39, original=lambda aid: photo(SRGB))
    plain, _ = make_print_pdf(app_pdf(browser, None), fogra39)
    assert "wide" not in rep and cmyk_at(out, (20, 25)) == cmyk_at(plain, (20, 25))


def test_softproof_uses_photo_profile(fogra39):
    p3 = Image.open(io.BytesIO(photo(P3)))
    untagged = Image.open(io.BytesIO(photo(None)))
    a, b = proof_image(p3, fogra39, paper=False), proof_image(untagged, fogra39, paper=False)
    assert a.getpixel((10, 10)) != b.getpixel((10, 10))
    # P3-Grün ist weit außerhalb des Druckfarbraums: Warnung an dieser Stelle
    warned = proof_image(p3, fogra39, paper=False, gamut=True)
    assert any(warned.getpixel((x, 10)) != a.getpixel((x, 10)) for x in range(0, 40))


def test_api_print_uses_original_for_wide_photo(tmp_path):
    settings = Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))
    c = TestClient(create_app(settings), base_url="http://localhost")
    root = tmp_path / "Kalender"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    put(str(root), "Photos/05 May/garden.jpg", photo(P3))
    aid = c.post(f"/api/projects/{pid}/scan", headers=H).json()["added"][0]
    aid = aid["id"] if isinstance(aid, dict) else aid
    thumb = c.get(f"/api/projects/{pid}/assets/{aid}/thumb?size=120")
    assert Image.open(io.BytesIO(thumb.content)).info.get("icc_profile") == P3
    spec = f"<< /Asset ({aid}) /M [4 0 0 0 4 0] /Photo [400 200] /BG [255 255 255] /Panels [] >>"
    pdf = app_pdf(as_browser(photo(P3)).resize((100, 50)), spec)
    r = c.post(f"/api/projects/{pid}/export/print", headers=H, data={"printer": "fogra39", "standard": "x4"},
               files={"file": ("k.pdf", pdf, "application/pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["report"]["wide"] == {"Display P3": 1}
