"""Robustheit gegen unsinnige oder bösartige Eingaben (aus der Durchsicht vor 1.4): klare 4xx statt 500,
keine Pfade außerhalb von Projekt und Zwischenspeicher, keine Änderungen von fremden Webseiten."""

import json
import os

import httpx
import pytest
from fastapi.testclient import TestClient

from conftest import photo_bytes, put
from lichtjahr.api import create_app
from lichtjahr.cli import with_default_command
from lichtjahr.config import Settings
from lichtjahr.storage import StorageError
from lichtjahr.storage.webdav import WebDavStorage


def setup(tmp_path, token=None):
    s = Settings(data_dir=str(tmp_path / "data"), cache_dir=str(tmp_path / "cache"), token=token)
    c = TestClient(create_app(s), base_url="http://localhost")
    root = tmp_path / "K"
    pid = c.post("/api/projects", json={"path": str(root), "calendarYear": 2027}, headers={"Authorization": f"Bearer {token}"} if token else {}).json()["id"]
    return c, pid, root


def locked(c, pid, **hdr):
    return {**hdr, "X-Lichtjahr-Session": c.post(f"/api/projects/{pid}/lock", json={}, headers=hdr).json()["session"]}


def test_month_is_range_checked(tmp_path):
    c, pid, root = setup(tmp_path)
    H = locked(c, pid)
    aid = c.post(f"/api/projects/{pid}/assets", headers=H, data={"month": "3"}, files={"file": ("a.jpg", photo_bytes(), "image/jpeg")}).json()["id"]
    for bad in (12, -1):
        assert c.post(f"/api/projects/{pid}/assets/{aid}/move", headers=H, json={"month": bad}).status_code == 422
    assert c.post(f"/api/projects/{pid}/assets", headers=H, data={"month": "abc"}, files={"file": ("b.jpg", photo_bytes(), "image/jpeg")}).status_code == 400
    assert not any(n.startswith("00") for n in os.listdir(root / "Photos"))


def test_manifest_fields_cannot_point_outside(tmp_path):
    """contentHash und Projekt-ID landen in Pfaden des Zwischenspeichers: nur gültige Werte werden angenommen."""
    c, pid, root = setup(tmp_path)
    H = locked(c, pid)
    c.post(f"/api/projects/{pid}/assets", headers=H, files={"file": ("a.jpg", photo_bytes(), "image/jpeg")})
    man = c.get(f"/api/projects/{pid}/manifest").json()
    man.pop("stamp", None)
    man["assets"][0]["contentHash"] = "../../../../escaped"
    r = c.put(f"/api/projects/{pid}/manifest", headers=H, json=man)
    assert r.status_code == 400
    man["assets"][0]["contentHash"] = "a" * 64
    man["assets"][0]["month"] = 15
    assert c.put(f"/api/projects/{pid}/manifest", headers=H, json=man).status_code == 400
    assert c.get(f"/api/projects/{pid}").status_code == 200                       # Projekt bleibt benutzbar
    assert c.get("/api/projects/..%5Ccredentials/draft").status_code == 404        # ID im Dateinamen der Entwürfe
    assert c.put("/api/projects/x_123/draft", json={}).status_code == 404


def test_if_match_forms_and_corrupt_photo(tmp_path):
    c, pid, root = setup(tmp_path)
    H = locked(c, pid)
    rev = c.get(f"/api/projects/{pid}/manifest").json()["revision"]
    assert c.patch(f"/api/projects/{pid}/editor", headers={**H, "If-Match": f'W/"{rev}"'}, json={"doc": {}}).status_code == 200
    assert c.patch(f"/api/projects/{pid}/editor", headers={**H, "If-Match": "abc"}, json={"doc": {}}).status_code == 400
    put(str(root), "Photos/01 January/kaputt.jpg", b"\xff\xd8\xff\xe0 kein Bild")
    c.post(f"/api/projects/{pid}/scan", headers=H)
    bad = next((a for a in c.get(f"/api/projects/{pid}/assets").json() if a["path"].endswith("kaputt.jpg")), None)
    if bad:                                                                         # je nach Abgleich gar nicht erst aufgenommen
        assert c.get(f"/api/projects/{pid}/assets/{bad['id']}/thumb?size=120").status_code in (404, 422)


def test_move_of_a_file_deleted_outside_the_app(tmp_path):
    c, pid, root = setup(tmp_path)
    H = locked(c, pid)
    a = c.post(f"/api/projects/{pid}/assets", headers=H, data={"month": "1"}, files={"file": ("weg.jpg", photo_bytes(), "image/jpeg")}).json()
    os.unlink(root / a["path"])
    assert c.post(f"/api/projects/{pid}/assets/{a['id']}/move", headers=H, json={"month": 2}).status_code == 404
    c.delete(f"/api/projects/{pid}/lock", headers=H)
    again = c.post(f"/api/projects/{pid}/lock", json={}).json()
    assert again["recovered"] == []                                                 # nichts Unklares im Journal


def test_writes_from_other_websites_are_refused(tmp_path):
    c, pid, _ = setup(tmp_path)
    assert c.post("/api/printers", headers={"Sec-Fetch-Site": "cross-site"}, files={"file": ("x.icc", b"x")}).status_code == 403
    assert c.post(f"/api/projects/{pid}/lock", json={}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert c.post(f"/api/projects/{pid}/lock", json={}, headers={"Origin": "http://localhost", "Sec-Fetch-Site": "same-origin"}).status_code == 200
    assert c.get("/api/projects", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 200   # Lesen liefert ohne CORS nichts aus


def test_token_mode_docs_and_odd_tokens(tmp_path):
    c, pid, _ = setup(tmp_path, token="geheim")
    assert c.get("/api/projects?token=%C3%A4%C3%B6").status_code == 401             # Umlaute: 401 statt Absturz
    assert c.get("/api/openapi.json").status_code == 200                           # Beschreibung ohne Daten, auch ohne Schlüssel
    assert c.get("/api/projects").status_code == 401


def test_export_download_works_without_local_path(tmp_path, monkeypatch):
    c, pid, root = setup(tmp_path)
    H = locked(c, pid)
    c.post(f"/api/projects/{pid}/export", headers=H, files={"file": ("K.pdf", b"%PDF-1.4 x", "application/pdf")})
    from lichtjahr.storage.local import LocalStorage
    monkeypatch.setattr(LocalStorage, "local_path", lambda self, path: None)       # wie bei WebDAV
    r = c.get(f"/api/projects/{pid}/export/K.pdf")
    assert r.status_code == 200 and r.content == b"%PDF-1.4 x"
    assert c.get(f"/api/projects/{pid}/export/gibtsnicht.pdf").status_code == 404


def test_proof_colors_reject_nan(tmp_path):
    c, _, _ = setup(tmp_path)
    pr = c.get("/api/printers").json()[0]["id"]
    assert c.post(f"/api/printers/{pr}/proof-colors", content=json.dumps({"colors": {"a": [float("nan"), 0, 0, 1]}}),
                  headers={"Content-Type": "application/json"}).status_code in (400, 422)


def test_webdav_credentials_never_stay_in_the_address():
    s = WebDavStorage("https://anna:geheim@cloud.example.org/remote.php/dav/files/anna/K")
    assert "geheim" not in s.describe() and s.describe() == "https://cloud.example.org/remote.php/dav/files/anna/K/"
    assert s.client.auth is not None


def test_webdav_unreachable_is_a_clear_error():
    def boom(request):
        raise httpx.ConnectError("Name or service not known")
    s = WebDavStorage("https://nicht-da.example.org/dav/K", "a", "b", transport=httpx.MockTransport(boom))
    with pytest.raises(StorageError, match="(?i)erreichbar|reach"):
        s.check()


def test_default_command_is_serve():
    assert with_default_command([]) == ["serve"]
    assert with_default_command(["--no-browser"]) == ["serve", "--no-browser"]
    assert with_default_command(["--data-dir", "X", "--port", "9000"]) == ["--data-dir", "X", "serve", "--port", "9000"]
    assert with_default_command(["--data-dir=X", "init", "K"]) == ["--data-dir=X", "init", "K"]
    assert with_default_command(["--version"]) == ["--version"]
