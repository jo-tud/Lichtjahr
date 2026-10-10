"""HEIC/HEIF vom iPhone: einlesen, Vorschau, Original für den Browser als JPEG, Druck aus dem Original."""

import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from conftest import put
from iccgen import rgb_profile
from lichtjahr import media
from lichtjahr.api import create_app
from lichtjahr.config import Settings

pytestmark = pytest.mark.skipif(not media.HEIF, reason="pillow-heif fehlt")


def heic(color=(200, 80, 40), size=(640, 480), rotate=False, icc=None) -> bytes:
    im = Image.new("RGB", size, color)
    im.paste((20, 20, 20), (0, 0, size[0] // 4, size[1] // 4))           # dunkle Ecke oben links: zeigt die Drehung
    buf = io.BytesIO()
    kw = {"icc_profile": icc} if icc else {}
    if rotate:
        im = im.transpose(Image.Transpose.ROTATE_90)
        ex = Image.Exif(); ex[0x0112] = 6; kw["exif"] = ex.tobytes()
    im.save(buf, "HEIF", quality=90, **kw)
    return buf.getvalue()


def test_heic_in_project(tmp_path):
    c = TestClient(create_app(Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))), base_url="http://localhost")
    root = tmp_path / "K"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    put(str(root), "Photos/04 April/IMG_0001.HEIC", heic(rotate=True, icc=rgb_profile("Display P3")))
    c.post(f"/api/projects/{pid}/scan", headers=H)
    a = c.get(f"/api/projects/{pid}/manifest").json()["assets"][0]
    assert a["path"].endswith(".HEIC") and (a["widthPx"], a["heightPx"]) == (640, 480)
    thumb = Image.open(io.BytesIO(c.get(f"/api/projects/{pid}/assets/{a['id']}/thumb?size=120").content))
    assert thumb.format == "JPEG" and thumb.size[0] > thumb.size[1]
    orig = c.get(f"/api/projects/{pid}/assets/{a['id']}/original")
    assert orig.headers["content-type"] == "image/jpeg"
    im = Image.open(io.BytesIO(orig.content))
    assert im.size == (640, 480) and im.getpixel((10, 10))[0] < 60 and im.info.get("icc_profile")   # richtig gedreht, mit Profil
    up = c.post(f"/api/projects/{pid}/assets", headers=H, data={"month": "5"}, files={"file": ("IMG_0002.heic", heic((40, 120, 200)), "image/heic")})
    assert up.status_code == 200 and up.json()["path"].endswith("IMG_0002.heic")
