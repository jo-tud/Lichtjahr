"""Wer ist wie oft auf den Fotos: Merkmale je Gesicht, gleiche Person ähnlich, verschiedene unähnlich."""

import io
import os
import shutil

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageEnhance

from conftest import put
from lichtjahr import faces
from lichtjahr.api import create_app
from lichtjahr.config import Settings

DATA = os.path.join(os.path.dirname(__file__), "data")
pytestmark = pytest.mark.skipif(not faces.available(), reason="OpenCV fehlt")


@pytest.fixture(scope="session")
def model_dir(request):
    """Modell aus LICHTJAHR_SFACE (Pfad) oder einmal laden und im pytest-Cache behalten; ohne Modell wird übersprungen."""
    d = str(request.config.cache.mkdir("sface"))
    given = os.environ.get("LICHTJAHR_SFACE")
    if given:
        if not os.path.isfile(given) or os.path.getsize(given) != faces.REC_SIZE:
            pytest.skip(f"LICHTJAHR_SFACE zeigt nicht auf das Modell {faces.REC_FILE}: {given}")
        os.makedirs(os.path.dirname(faces.recognizer_path(d)), exist_ok=True)
        shutil.copy(given, faces.recognizer_path(d))
    elif not faces.recognizer_ready(d):
        try:
            faces.download_recognizer(d)
        except Exception as e:                       # kein Netz in dieser Umgebung
            pytest.skip(f"Erkennungsmodell nicht verfügbar: {e}")
    return d


def jpg(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=90)
    return buf.getvalue()


def cos(a, b):
    return sum(x * y for x, y in zip(a, b))


def test_same_person_similar_others_not(model_dir):
    portrait = Image.open(os.path.join(DATA, "portrait.jpg"))
    variant = ImageEnhance.Brightness(portrait.rotate(7, expand=True).resize((500, 640))).enhance(.8)
    a, b = faces.embed(jpg(portrait), model_dir), faces.embed(jpg(variant), model_dir)
    crew = faces.embed(open(os.path.join(DATA, "crew.jpg"), "rb").read(), model_dir)
    assert len(a) == 1 and len(a[0]["emb"]) == 128 and abs(cos(a[0]["emb"], a[0]["emb"]) - 1) < 1e-3
    assert cos(a[0]["emb"], b[0]["emb"]) > .6
    assert len(crew) == 4 and all(f["emb"] for f in crew)
    assert max(cos(a[0]["emb"], f["emb"]) for f in crew) < .35
    assert max(cos(crew[i]["emb"], crew[j]["emb"]) for i in range(4) for j in range(i + 1, 4)) < .35


def test_api_people(tmp_path, model_dir):
    settings = Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))
    c = TestClient(create_app(settings), base_url="http://localhost")
    root = tmp_path / "K"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    put(str(root), "Photos/07 July/crew.jpg", open(os.path.join(DATA, "crew.jpg"), "rb").read())
    c.post(f"/api/projects/{pid}/scan", headers=H)
    aid = c.get(f"/api/projects/{pid}/manifest").json()["assets"][0]["id"]
    assert c.get("/api/people/model").json()["ready"] is False
    assert c.post(f"/api/projects/{pid}/people", json={"ids": [aid]}).json() == {"ready": False, "faces": {}}
    os.makedirs(os.path.dirname(faces.recognizer_path(settings.data_dir)), exist_ok=True)
    shutil.copy(faces.recognizer_path(model_dir), faces.recognizer_path(settings.data_dir))
    assert c.post("/api/people/model").json()["ready"] is True              # schon da: nichts zu laden
    r = c.post(f"/api/projects/{pid}/people", json={"ids": [aid]}).json()
    assert r["ready"] and len(r["faces"][aid]) == 4 and len(r["faces"][aid][0]["emb"]) == 128
    # Merkmale nur im Zwischenspeicher, nie im Projektordner
    assert list((tmp_path / "c").rglob(f"*_{faces.REC_VERSION}.json"))
    assert not any(faces.REC_VERSION in p.name for p in root.rglob("*"))
