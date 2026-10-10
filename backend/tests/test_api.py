from fastapi.testclient import TestClient

from conftest import photo_bytes, put
from lichtjahr.api import create_app
from lichtjahr.config import Settings


def client(tmp_path, token=None):
    s = Settings(data_dir=str(tmp_path / "data"), cache_dir=str(tmp_path / "cache"), token=token)
    return TestClient(create_app(s))


def test_full_flow(tmp_path):
    c = client(tmp_path)
    root = tmp_path / "Kalender 2027"
    r = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027, "title": "Unser Jahr"})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    assert c.get("/api/projects").json()[0]["id"] == pid

    # ohne Sperre darf nichts geändert werden
    assert c.post(f"/api/projects/{pid}/scan").status_code == 423
    lock = c.post(f"/api/projects/{pid}/lock", json={"holder": "Anna"}).json()
    sid = lock["session"]
    H = {"X-Lichtjahr-Session": sid}

    # zweiter Client sieht, wer bearbeitet
    other = c.post(f"/api/projects/{pid}/lock", json={"holder": "Bernd"}, headers={"X-Lichtjahr-Session": "zweiter"})
    assert other.status_code == 423 and other.json()["lock"]["holder"] == "Anna"

    put(str(root), "Fotos/02 Februar/schnee.jpg", photo_bytes())
    rep = c.post(f"/api/projects/{pid}/scan", headers=H).json()
    assert len(rep["added"]) == 1
    up = c.post(f"/api/projects/{pid}/assets", headers=H, data={"month": "6"},
                files={"file": ("see.jpg", photo_bytes(color=(0, 90, 200)), "image/jpeg")})
    assert up.status_code == 200 and up.json()["path"] == "Fotos/07 Juli/see.jpg"
    assets = c.get(f"/api/projects/{pid}/assets").json()
    assert len(assets) == 2
    t = c.get(f"/api/projects/{pid}/assets/{assets[0]['id']}/thumb?size=120")
    assert t.status_code == 200 and t.headers["content-type"] == "image/jpeg"
    mv = c.post(f"/api/projects/{pid}/assets/{assets[0]['id']}/move", headers=H, json={"month": 0})
    assert mv.json()["path"].startswith("Fotos/01 Januar/")

    # Gestaltungsstand speichern; veralteter Stand wird abgewiesen statt überschrieben
    rev = c.get(f"/api/projects/{pid}/manifest").json()["revision"]
    ok = c.patch(f"/api/projects/{pid}/editor", headers={**H, "If-Match": str(rev)}, json={"doc": {"gap": 3}})
    assert ok.status_code == 200 and ok.json()["revision"] == rev + 1
    stale = c.patch(f"/api/projects/{pid}/editor", headers={**H, "If-Match": str(rev)}, json={"doc": {"gap": 5}})
    assert stale.status_code == 409 and stale.json()["revision"] == rev + 1
    assert c.get(f"/api/projects/{pid}/manifest").json()["editor"] == {"doc": {"gap": 3}}

    assert c.delete(f"/api/projects/{pid}/lock", headers=H).status_code == 200
    assert c.get(f"/api/projects/{pid}/lock").json()["lock"] is None


def test_open_existing_folder_and_token(tmp_path):
    c = client(tmp_path)
    root = tmp_path / "Projekt"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2028}).json()["id"]
    c2 = client(tmp_path / "anderer-rechner", token="geheim")
    assert c2.post("/api/projects/open", json={"path": str(root)}).status_code == 401
    r = c2.post("/api/projects/open", json={"path": str(root)}, headers={"Authorization": "Bearer geheim"})
    assert r.status_code == 200 and r.json()["id"] == pid and r.json()["sourceYear"] == 2027
    assert c2.get("/api/health").status_code == 200
