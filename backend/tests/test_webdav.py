import json
import os
import stat
import threading
import time

import pytest
from fastapi.testclient import TestClient

from conftest import photo_bytes, put
from davserver import PASSWORD, USER
from lichtjahr.api import create_app
from lichtjahr.config import Settings
from lichtjahr.lock import Locked, LockLost, ProjectLock
from lichtjahr.storage import AlreadyExists, Conflict, NotFound, StorageError
from lichtjahr.storage.webdav import WebDavStorage


@pytest.fixture
def store(dav, tmp_path):
    s = WebDavStorage(dav.url(f"{tmp_path.name}-store"), USER, PASSWORD)
    s.check()
    return s


def test_atomic_primitives(store):
    etag = store.create_exclusive("a/b.json", b"1")                 # legt Ordner a/ selbst an
    with pytest.raises(AlreadyExists):
        store.create_exclusive("a/b.json", b"2")
    etag2 = store.replace("a/b.json", b"2", if_match=etag)
    with pytest.raises(Conflict):
        store.replace("a/b.json", b"3", if_match=etag)             # veralteter Stand
    assert store.read("a/b.json") == (b"2", etag2)
    with pytest.raises(Conflict):
        store.delete("a/b.json", if_match=etag)
    store.delete("a/b.json", if_match=etag2)
    with pytest.raises(NotFound):
        store.read("a/b.json")


def test_move_copy_walk_and_umlauts(store):
    store.write("Fotos/03 März/Schnee am Berg.jpg", b"EINS")
    store.write("Fotos/04 April/Schnee am Berg.jpg", b"ANDERS")
    with pytest.raises(AlreadyExists):
        store.move("Fotos/03 März/Schnee am Berg.jpg", "Fotos/04 April/Schnee am Berg.jpg")   # nie überschreiben
    store.copy("Fotos/03 März/Schnee am Berg.jpg", "Fotos/05 Mai/Kopie.jpg")
    store.move("Fotos/03 März/Schnee am Berg.jpg", "Fotos/Ohne Monat/x.jpg")
    assert not store.exists("Fotos/03 März/Schnee am Berg.jpg")
    assert store.read("Fotos/Ohne Monat/x.jpg")[0] == b"EINS" and store.read("Fotos/05 Mai/Kopie.jpg")[0] == b"EINS"
    files = sorted(e.path for e in store.walk("Fotos") if not e.is_dir)
    assert files == ["Fotos/04 April/Schnee am Berg.jpg", "Fotos/05 Mai/Kopie.jpg", "Fotos/Ohne Monat/x.jpg"]
    st = store.stat("Fotos/05 Mai/Kopie.jpg")
    assert st.size == 4 and st.mtime_ns > 0
    with store.open_read("Fotos/04 April/Schnee am Berg.jpg") as fh:
        assert fh.read() == b"ANDERS"
    with pytest.raises(StorageError):
        store.read("../anderer-ordner/geheim.txt")


def test_login_https_and_display(dav, tmp_path):
    with pytest.raises(StorageError, match="(?i)app"):
        WebDavStorage(dav.url("x"), USER, "falsch").check()
    with pytest.raises(StorageError):
        WebDavStorage("http://cloud.example.org/remote.php/dav/files/anna/K")          # Passwort im Klartext übers Netz
    WebDavStorage("http://192.168.1.5/remote.php/dav/files/anna/K")                    # im eigenen Netz in Ordnung
    s = WebDavStorage("https://cloud.example.org/remote.php/dav/files/anna/Kalender%202027/")
    assert s.display() == "cloud.example.org · Kalender 2027"


def test_lock_between_two_devices(dav, tmp_path):
    url = dav.url(f"{tmp_path.name}-lock")
    a, b = WebDavStorage(url, USER, PASSWORD), WebDavStorage(url, USER, PASSWORD)
    a.check()
    la, lb = ProjectLock(a, lease=1.0), ProjectLock(b, lease=1.0)   # WebDAV kennt Änderungszeiten nur auf die Sekunde
    la.acquire("laptop", "Anna")
    with pytest.raises(Locked) as e:
        lb.acquire("handy", "Bernd")
    assert e.value.info.holder == "Anna"
    la.heartbeat("laptop")
    time.sleep(2.5)
    lb.acquire("handy", "Bernd")                                      # abgelaufen: kontrollierte Übernahme
    with pytest.raises(LockLost):
        la.heartbeat("laptop")


@pytest.mark.parametrize("round_", range(5))
def test_concurrent_acquire_over_webdav_has_one_winner(dav, tmp_path, round_):
    url = dav.url(f"{tmp_path.name}-race")
    WebDavStorage(url, USER, PASSWORD).check()
    winners, start = [], time.time() + 0.2

    def attempt(sid):
        lock = ProjectLock(WebDavStorage(url, USER, PASSWORD))
        while time.time() < start:
            pass
        try:
            lock.acquire(sid, sid)
            winners.append(sid)
        except Locked:
            pass

    threads = [threading.Thread(target=attempt, args=(f"s{i}",)) for i in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    assert len(winners) == 1


def test_api_webdav_project_keeps_password_out_of_project(dav, tmp_path):
    settings = Settings(data_dir=str(tmp_path / "d"), cache_dir=str(tmp_path / "c"))
    c = TestClient(create_app(settings), base_url="http://localhost")
    url = dav.url(f"{tmp_path.name}-api")
    bad = c.post("/api/projects", json={"url": url, "username": USER, "password": "falsch", "calendarYear": 2027})
    assert bad.status_code == 400 and "app" in bad.json()["detail"].lower()
    r = c.post("/api/projects", json={"url": url, "username": USER, "password": PASSWORD, "calendarYear": 2027})
    assert r.status_code == 200, r.text
    s = r.json()
    pid = s["id"]
    assert s["storage"]["kind"] == "webdav" and s["storage"]["folders"]["photos"] == "Photos"
    folder = os.path.join(dav.root, f"{tmp_path.name}-api")
    assert os.path.isdir(os.path.join(folder, "Photos", "03 March"))
    # Passwort steht nur in credentials.json (0600), nicht in Projektliste, Manifest oder Antworten
    cred = os.path.join(settings.data_dir, "credentials.json")
    assert stat.S_IMODE(os.stat(cred).st_mode) == 0o600 and PASSWORD in open(cred).read()
    assert PASSWORD not in open(os.path.join(settings.data_dir, "projects.json")).read()
    assert PASSWORD not in open(os.path.join(folder, "lichtjahr.json")).read()
    assert PASSWORD not in c.get("/api/projects").text + c.get(f"/api/projects/{pid}").text
    # Neustart des Dienstes: Projekt öffnet sich mit den gespeicherten Zugangsdaten
    c2 = TestClient(create_app(settings), base_url="http://localhost")
    H = {"X-Lichtjahr-Session": c2.post(f"/api/projects/{pid}/lock", json={}).json()["session"]}
    put(folder, "Photos/02 February/snow.jpg", photo_bytes())
    assert len(c2.post(f"/api/projects/{pid}/scan", headers=H).json()["added"]) == 1
    up = c2.post(f"/api/projects/{pid}/assets", headers=H, data={"month": "6"}, files={"file": ("lake.jpg", photo_bytes(color=(0, 90, 200)), "image/jpeg")})
    assert up.json()["path"] == "Photos/07 July/lake.jpg" and os.path.exists(os.path.join(folder, "Photos", "07 July", "lake.jpg"))
    aid = up.json()["id"]
    assert c2.get(f"/api/projects/{pid}/assets/{aid}/thumb?size=120").headers["content-type"] == "image/jpeg"
    assert c2.get(f"/api/projects/{pid}/assets/{aid}/original").content[:2] == b"\xff\xd8"
    e = c2.post(f"/api/projects/{pid}/export", headers=H, files={"file": ("Kalender.pdf", b"%PDF-1.6", "application/pdf")})
    assert e.json()["path"] == "Export/Kalender.pdf" and open(os.path.join(folder, "Export", "Kalender.pdf"), "rb").read() == b"%PDF-1.6"
    c2.delete(f"/api/projects/{pid}/lock", headers=H)
    # Vergessen entfernt auch die Zugangsdaten
    c2.delete(f"/api/projects/{pid}")
    assert url.rstrip("/") + "/" not in json.load(open(cred))


def test_server_lock_423_is_retried_then_explained(monkeypatch):
    import httpx
    from lichtjahr.storage.webdav import ServerLocked
    calls = []

    def handler(request):
        calls.append(request.method)
        if len(calls) <= 2:                                         # Nextcloud hält die Datei kurz gesperrt
            return httpx.Response(423)
        return httpx.Response(201, headers={"ETag": '"e1"'})
    s = WebDavStorage("https://cloud.example.org/remote.php/dav/files/anna/K", USER, PASSWORD, transport=httpx.MockTransport(handler))
    monkeypatch.setattr(WebDavStorage, "RETRY_LOCKED", (0, 0, 0))
    assert s.create_exclusive(".lichtjahr/lock.json", b"{}") == '"e1"' and calls == ["PUT"] * 3
    stuck = WebDavStorage("https://cloud.example.org/remote.php/dav/files/anna/K", USER, PASSWORD,
                          transport=httpx.MockTransport(lambda r: httpx.Response(423)))
    with pytest.raises(ServerLocked, match="423"):
        stuck.replace(".lichtjahr/lock.json", b"{}", if_match='"e0"')


def test_lock_age_comes_from_the_server_clock(store):
    """Über WebDAV misst die Sperre das Alter mit der Uhr des Servers (Last-Modified gegen Date)."""
    import json as _json
    store.makedirs(".lichtjahr")
    t = time.time() - 900                    # Zeitstempel einer Uhr, die 15 Minuten nachgeht
    store.write(".lichtjahr/lock.json", _json.dumps({"session": "a", "holder": "Anna", "device": "pc", "created": t,
                                                     "heartbeat": t, "expires": t + 120}).encode())
    assert store.age(".lichtjahr/lock.json") < 5
    with pytest.raises(Locked):
        ProjectLock(store).acquire("b", "Bernd")
    with pytest.raises(NotFound):
        store.age(".lichtjahr/gibtsnicht.json")
