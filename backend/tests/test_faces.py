"""Gesichter finden: Detektor auf freien NASA-Porträts, Zwischenspeicher und Schnittstelle."""

import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from conftest import put
from lichtjahr import faces
from lichtjahr.api import create_app
from lichtjahr.config import Settings

DATA = os.path.join(os.path.dirname(__file__), "data")
pytestmark = pytest.mark.skipif(not faces.available(), reason="OpenCV fehlt")


def read(name):
    with open(os.path.join(DATA, name), "rb") as fh:
        return fh.read()


def test_finds_all_faces_in_group_and_portrait():
    crew = faces.detect(read("crew.jpg"))
    assert len(crew) == 4
    assert all(0 <= f["x"] and f["x"] + f["w"] <= 1 and 0 <= f["y"] and f["y"] + f["h"] <= 1 and f["score"] >= faces.SCORE for f in crew)
    assert all(f["y"] < .6 for f in crew)                               # Köpfe in der oberen Bildhälfte
    one = faces.detect(read("portrait.jpg"))
    assert len(one) == 1 and one[0]["w"] > .2                          # großes Gesicht im Porträt


def test_no_faces_in_landscape_and_exif_rotation_is_respected():
    buf = io.BytesIO()
    Image.new("RGB", (800, 500), (90, 140, 220)).save(buf, "JPEG")
    assert faces.detect(buf.getvalue()) == []
    # Porträt um 90° gedreht gespeichert, EXIF dreht zurück: Gesicht liegt im angezeigten Bild oben
    im = Image.open(io.BytesIO(read("portrait.jpg"))).transpose(Image.Transpose.ROTATE_90)
    ex = Image.Exif(); ex[0x0112] = 6
    buf = io.BytesIO(); im.save(buf, "JPEG", exif=ex.tobytes())
    f = faces.detect(buf.getvalue())
    assert len(f) == 1 and f[0]["y"] < .5 and abs(f[0]["x"] + f[0]["w"] / 2 - .5) < .2


def test_api_faces_cached_per_photo(tmp_path):
    settings = Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))
    c = TestClient(create_app(settings), base_url="http://localhost")
    root = tmp_path / "Kalender"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    put(str(root), "Photos/07 July/crew.jpg", read("crew.jpg"))
    put(str(root), "Photos/07 July/sky.jpg", _sky())
    c.post(f"/api/projects/{pid}/scan", headers=H)
    added = {os.path.basename(a["path"]): a["id"] for a in c.get(f"/api/projects/{pid}/manifest").json()["assets"]}
    r = c.post(f"/api/projects/{pid}/faces", json={"ids": [added["crew.jpg"], added["sky.jpg"], "a_unbekannt"]}).json()
    assert r["available"] and len(r["faces"][added["crew.jpg"]]) == 4 and r["faces"][added["sky.jpg"]] == []
    assert "a_unbekannt" not in r["faces"]
    cache = list((tmp_path / "c").rglob(f"*_{faces.VERSION}.json"))
    assert len(cache) == 2
    assert c.post(f"/api/projects/{pid}/faces", json={"ids": [added["crew.jpg"]]}).json() == {"available": True, "faces": {added["crew.jpg"]: r["faces"][added["crew.jpg"]]}}


def _sky():
    buf = io.BytesIO()
    Image.new("RGB", (900, 600), (120, 170, 230)).save(buf, "JPEG")
    return buf.getvalue()
