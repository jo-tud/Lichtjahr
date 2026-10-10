import io

import pikepdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageChops, ImageDraw

from lichtjahr.api import create_app
from lichtjahr.config import Settings
from lichtjahr.printing import BUNDLED_DIR, PrinterRegistry, PrintError, make_print_pdf, preflight

MM = 72 / 25.4


def page_pdf(*, rgb=True, bleed=3.0, dpi=300, content_extra=b"", trim=True, extgstate=None, font=None) -> bytes:
    """Ein Blatt wie aus der Oberfläche: 100 × 100 mm Endformat, Foto randabfallend, Text als CMYK-Vektor."""
    size = (100 + 2 * bleed) * MM
    px = round((100 + 2 * bleed) / 25.4 * dpi)
    im = Image.new("RGB", (px, px), (255, 0, 0))
    ImageDraw.Draw(im).rectangle([0, px // 2, px, px], fill=(0, 90, 255))
    if not rgb:
        im = im.convert("CMYK")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(size, size))
    page = pdf.pages[0]
    img = pikepdf.Stream(pdf, buf.getvalue(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=px, Height=px,
                         ColorSpace=pikepdf.Name.DeviceRGB if rgb else pikepdf.Name.DeviceCMYK, BitsPerComponent=8,
                         Filter=pikepdf.Name.DCTDecode)
    res = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=img))
    if extgstate:
        res.ExtGState = pikepdf.Dictionary(GS0=pikepdf.Dictionary(extgstate))
    if font:
        res.Font = pikepdf.Dictionary(F1=font)
    page.Resources = res
    page.obj.BleedBox = [0, 0, size, size]
    if trim:
        page.obj.TrimBox = [bleed * MM, bleed * MM, size - bleed * MM, size - bleed * MM]
    page.Contents = pdf.make_stream(f"q {size:.3f} 0 0 {size:.3f} 0 0 cm /Im0 Do Q q 0 0 0 1 k Q ".encode() + content_extra)
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


@pytest.fixture
def fogra39(tmp_path):
    return PrinterRegistry(str(tmp_path)).get("fogra39")


def codes(report, level="error"):
    return {i["code"] for i in report["items"] if i["level"] == level}


def test_bundled_profiles_are_available(tmp_path):
    ps = {p.id: p for p in PrinterRegistry(str(tmp_path)).all()}
    assert ps["fogra39"].available and ps["fogra39"].condition == "FOGRA39" and ps["fogra39"].tac == 300
    assert ps["fogra47"].available and ps["fogra47"].condition == "FOGRA47"


def test_print_pdf_is_pdfx1a_with_icc_converted_images(fogra39):
    out, report = make_print_pdf(page_pdf(), fogra39, "Familienkalender 2027")
    assert report["ok"], report["items"]
    assert all(s["level"] == "ok" for s in report["summary"])
    pdf = pikepdf.open(io.BytesIO(out))
    assert pdf.pdf_version == "1.3" and "/ID" in pdf.trailer
    info = pdf.docinfo
    assert str(info.GTS_PDFXVersion) == "PDF/X-1:2001" and str(info.GTS_PDFXConformance) == "PDF/X-1a:2001"
    assert info.Trapped == pikepdf.Name("/False") and str(info.Title) == "Familienkalender 2027"
    oi = pdf.Root.OutputIntents[0]
    assert oi.S == pikepdf.Name.GTS_PDFX and str(oi.OutputConditionIdentifier) == "FOGRA39"
    with open(fogra39.path, "rb") as fh:
        assert oi.DestOutputProfile.read_bytes() == fh.read() and int(oi.DestOutputProfile.N) == 4
    img = pdf.pages[0].Resources.XObject.Im0
    assert img.ColorSpace == pikepdf.Name.DeviceCMYK and img.Filter == pikepdf.Name.DCTDecode
    raw = img.read_raw_bytes()
    assert b"Adobe" not in raw[:2000]                  # CMYK-JPEG ohne Adobe-Konvention: alle Leser zeigen es gleich
    # Pillow liest solche JPEGs invertiert ein; zurückdrehen und Farben prüfen
    cmyk = ImageChops.invert(Image.open(io.BytesIO(raw)))
    w, h = cmyk.size
    red, blue = cmyk.getpixel((w // 2, h // 4)), cmyk.getpixel((w // 2, 3 * h // 4))
    assert red[0] < 30 and red[1] > 200 and red[2] > 200        # Rot: viel Magenta und Gelb, kaum Cyan
    assert blue[0] > 200 and blue[2] < 30                        # Blau: viel Cyan, kein Gelb
    assert report["maxTac"] <= 300.5 and report["minDpi"] == 300


def test_preflight_finds_the_problems(fogra39):
    bad_font = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.TrueType, BaseFont=pikepdf.Name("/Arial"))
    data = page_pdf(rgb=True, bleed=1, dpi=90, content_extra=b"q 1 1 1 1 k 0 0 10 10 re f Q q 1 0 0 rg Q",
                    extgstate={"/Type": pikepdf.Name.ExtGState, "/ca": 0.5}, font=bad_font)
    report = preflight(data, fogra39)
    assert not report["ok"]
    errors = codes(report)
    for code in ("pdfx-id", "outputintent", "rgb-image", "rgb-vector", "transparency", "font", "bleed", "tac"):
        assert code in errors, code
    assert "dpi" in codes(report, "warn")                         # unscharf, aber kein Fehler
    assert report["maxTac"] == 400
    no_trim = preflight(page_pdf(trim=False), fogra39)
    assert "trimbox" in codes(no_trim)


def test_cmyk_input_is_kept_and_rgb_vector_is_reported(fogra39):
    out, report = make_print_pdf(page_pdf(rgb=False), fogra39)
    assert report["ok"]
    _, report = make_print_pdf(page_pdf(content_extra=b"q 0 0 1 RG Q"), fogra39)
    assert "rgb-vector" in codes(report)


def test_custom_profile_from_icc_file(tmp_path):
    reg = PrinterRegistry(str(tmp_path))
    with open(f"{BUNDLED_DIR}/ISOcoated_v2_300_bas.icc", "rb") as fh:
        p = reg.add(fh.read(), "Meine Druckerei", tac=280, bleed=2, intent="relative")
    assert p.id.startswith("eigen-") and p.condition == "FOGRA39" and p.conditionText and p.tac == 280 and p.bleed == 2
    assert reg.get(p.id).name == "Meine Druckerei"
    with pytest.raises(PrintError):
        reg.add(b"kein Profil")
    with pytest.raises(PrintError):
        reg.remove("fogra39")
    reg.remove(p.id)
    with pytest.raises(PrintError):
        reg.get(p.id)


def test_print_export_api(tmp_path):
    c = TestClient(create_app(Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))), base_url="http://localhost")
    root = tmp_path / "K"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    assert any(p["id"] == "fogra39" and p["available"] for p in c.get("/api/printers").json())
    files = {"file": ("Familienkalender-2027-Druck.pdf", page_pdf(), "application/pdf")}
    assert c.post(f"/api/projects/{pid}/export/print", data={"printer": "fogra39"}, files=files).status_code == 423   # ohne Sperre
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    r = c.post(f"/api/projects/{pid}/export/print", headers=H, data={"printer": "fogra39", "title": "Familienkalender 2027"},
               files={"file": ("Familienkalender-2027-Druck.pdf", page_pdf(), "application/pdf")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["path"] == "Export/Familienkalender-2027-Druck.pdf" and body["report"]["ok"]
    assert (root / "Export" / "Familienkalender-2027-Druck.pdf").read_bytes()[:8] == b"%PDF-1.3"
    d = c.get(f"/api/projects/{pid}/export/Familienkalender-2027-Druck.pdf")
    assert d.status_code == 200 and d.content[:8] == b"%PDF-1.3"
    assert c.get(f"/api/projects/{pid}/export/..%2Flichtjahr.json").status_code == 404
    bad = c.post(f"/api/projects/{pid}/export/print", headers=H, data={"printer": "gibtsnicht"}, files={"file": ("x.pdf", page_pdf(), "application/pdf")})
    assert bad.status_code == 400
    with open(f"{BUNDLED_DIR}/PSO_Uncoated_ISO12647_bas.icc", "rb") as fh:
        added = c.post("/api/printers", data={"name": "Naturpapier", "tac": "260"}, files={"file": ("p.icc", fh.read(), "application/vnd.iccprofile")})
    assert added.status_code == 200 and added.json()["condition"] == "FOGRA47" and added.json()["tac"] == 260
    assert c.delete(f"/api/printers/{added.json()['id']}").status_code == 200
    # Druckprofil wird mit dem Gestaltungsstand im Manifest vermerkt
    c.post(f"/api/projects/{pid}/save", headers=H, json={"editor": {}, "printerProfileId": "fogra39"})
    assert c.get(f"/api/projects/{pid}/manifest").json()["printerProfileId"] == "fogra39"
