import json

import pytest
from fastapi.testclient import TestClient

from conftest import photo_bytes, put
from lichtjahr.api import create_app
from lichtjahr.config import Settings


def client(tmp_path, token=None):
    s = Settings(data_dir=str(tmp_path / "data"), cache_dir=str(tmp_path / "cache"), token=token)
    return TestClient(create_app(s), base_url="http://localhost")


def test_full_flow(tmp_path):
    c = client(tmp_path)
    root = tmp_path / "Kalender 2027"
    r = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027, "title": "Unser Jahr", "language": "de"})
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


def test_foreign_host_is_rejected_without_token(tmp_path):
    c = client(tmp_path)
    assert c.get("/api/projects").status_code == 200
    assert c.get("/api/projects", headers={"Host": "127.0.0.1:8470"}).status_code == 200
    assert c.get("/api/projects", headers={"Host": "[::1]:8470"}).status_code == 200
    assert c.get("/api/projects", headers={"Host": "boese.example:8470"}).status_code == 403
    t = client(tmp_path / "netz", token="geheim")                 # mit Schlüssel: jeder Hostname, aber nur mit Schlüssel
    assert t.get("/api/projects", headers={"Host": "192.168.1.20:8470", "Authorization": "Bearer geheim"}).status_code == 200


def test_save_export_upload_duplicate_and_draft(tmp_path):
    c = client(tmp_path)
    root = tmp_path / "K"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    f = {"file": ("see.jpg", photo_bytes(), "image/jpeg")}
    a = c.post(f"/api/projects/{pid}/assets", headers=H, data={"month": "6"}, files=f).json()
    again = c.post(f"/api/projects/{pid}/assets", headers=H, data={"month": "1"}, files={"file": ("see.jpg", photo_bytes(), "image/jpeg")}).json()
    assert a["duplicate"] is False and again["duplicate"] is True and again["id"] == a["id"]

    r = c.post(f"/api/projects/{pid}/save", headers=H, json={"editor": {"v": 1, "doc": {"year": 2027}}, "calendarYear": 2027,
                                                               "assets": {a["id"]: {"caption": "Am See", "excluded": True}}})
    assert r.status_code == 200, r.text
    man = c.get(f"/api/projects/{pid}/manifest").json()
    assert man["editor"]["v"] == 1 and man["assets"][0]["caption"] == "Am See" and man["assets"][0]["excluded"] is True
    assert c.post(f"/api/projects/{pid}/save", json={"editor": {}}).status_code == 423          # ohne Sperre

    e = c.post(f"/api/projects/{pid}/export", headers=H, files={"file": ("Kalender-2027.pdf", b"%PDF-1.6", "application/pdf")})
    assert e.json()["path"] == "Export/Kalender-2027.pdf" and (root / "Export" / "Kalender-2027.pdf").read_bytes() == b"%PDF-1.6"

    assert c.get(f"/api/projects/{pid}/draft").status_code == 204
    c.put(f"/api/projects/{pid}/draft", json={"savedAt": "2027-01-01T10:00:00Z", "editor": {}})
    assert c.get(f"/api/projects/{pid}/draft").json()["savedAt"].startswith("2027")
    c.delete(f"/api/projects/{pid}/draft")
    assert c.get(f"/api/projects/{pid}/draft").status_code == 204


def test_serve_with_path_registers_project(tmp_path, monkeypatch, capsys):
    import uvicorn

    from lichtjahr import cli

    root = tmp_path / "Kalender"
    base = ["--data-dir", str(tmp_path / "d"), "--cache-dir", str(tmp_path / "c")]
    with pytest.raises(SystemExit):
        cli.main([*base, "init", str(root), "--year", "2027"])
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: None)
    with pytest.raises(SystemExit) as ex:
        cli.main([*base, "serve", str(root)])
    assert ex.value.code == 0
    ids = [e["id"] for e in json.loads((tmp_path / "d" / "projects.json").read_text())]
    assert len(ids) == 1 and f"?projekt={ids[0]}" in capsys.readouterr().out
    with pytest.raises(SystemExit) as ex:
        cli.main([*base, "serve", str(tmp_path / "leer")])
    assert ex.value.code == 1


def test_languages_messages_and_folder_names(tmp_path):
    c = client(tmp_path)
    en = c.post("/api/projects", json={"path": str(tmp_path / "Calendar"), "calendarYear": 2027})
    assert en.status_code == 200 and en.json()["title"] == "Family calendar" and en.json()["language"] == "en"
    assert (tmp_path / "Calendar" / "Photos" / "03 March").is_dir() and (tmp_path / "Calendar" / "Photos" / "No month").is_dir()
    assert en.json()["storage"]["folders"]["months"][11] == "12 December"
    de = c.post("/api/projects", json={"path": str(tmp_path / "Kalender")}, headers={"Accept-Language": "de-DE,de;q=0.9"})
    assert de.status_code == 422                                       # Kalenderjahr fehlt
    de = c.post("/api/projects", json={"path": str(tmp_path / "Kalender"), "calendarYear": 2027}, headers={"Accept-Language": "de-DE,de;q=0.9"})
    assert de.json()["title"] == "Familienkalender" and (tmp_path / "Kalender" / "Fotos" / "03 März").is_dir()
    pid = en.json()["id"]
    H = {"X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    put(str(tmp_path / "Calendar"), "Photos/02 February/snow.jpg", photo_bytes())
    assert len(c.post(f"/api/projects/{pid}/scan", headers=H).json()["added"]) == 1
    a = c.get(f"/api/projects/{pid}/assets").json()[0]
    assert a["month"] == 1
    moved = c.post(f"/api/projects/{pid}/assets/{a['id']}/move", headers=H, json={"month": None}).json()
    assert moved["path"] == "Photos/No month/snow.jpg"
    msg = lambda lang: c.get("/api/projects/gibtsnicht", headers={"Accept-Language": lang}).json()["detail"]
    assert msg("en-US") == "Unknown project. Please add it via “Open project”."
    assert msg("de") == "Projekt unbekannt. Bitte über „Projekt öffnen“ hinzufügen."
    assert c.post(f"/api/projects/{pid}/scan").json()["detail"] == "Acquire the editing lock before making changes."
