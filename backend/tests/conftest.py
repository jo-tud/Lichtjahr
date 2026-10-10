import io
import os

import pytest
from PIL import Image

from lichtjahr.project import Project
from lichtjahr.storage import LocalStorage
from lichtjahr.storage.webdav import WebDavStorage


def photo_bytes(w=600, h=400, color=(80, 140, 200), date=None, orientation=None) -> bytes:
    im = Image.new("RGB", (w, h), color)
    exif = Image.Exif()
    if date:
        exif[0x0132] = date
        exif.get_ifd(0x8769)[0x9003] = date
    if orientation:
        exif[0x0112] = orientation
    out = io.BytesIO()
    im.save(out, "JPEG", quality=90, exif=exif.tobytes())
    return out.getvalue()


def put(root, rel, data):
    p = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(data)
    return p


@pytest.fixture(scope="session")
def dav(tmp_path_factory):
    from davserver import DavServer
    server = DavServer(str(tmp_path_factory.mktemp("dav")))
    yield server
    server.stop()


def make_storage(kind, tmp_path, dav, name="Kalender"):
    """Speicher und der Ordner auf der Platte, in dem seine Dateien wirklich liegen (zum Hineinlegen in Tests)."""
    if kind == "local":
        root = tmp_path / name
        root.mkdir(exist_ok=True)
        return LocalStorage(str(root)), str(root)
    from davserver import PASSWORD, USER
    folder = f"{tmp_path.name}-{name}"
    return WebDavStorage(dav.url(folder), USER, PASSWORD), os.path.join(dav.root, folder)


@pytest.fixture(params=["local", "webdav"])
def project(request, tmp_path, dav):
    storage, fs_root = make_storage(request.param, tmp_path, dav)
    if request.param == "webdav":
        storage.check()
    p = Project.create(storage, str(tmp_path / "cache"), title="Test", calendar_year=2027, source_year=2026)
    p.fs_root = fs_root
    return p


@pytest.fixture
def session(project):
    sid = "sitzung-a"
    project.lock.acquire(sid, "Test")
    return sid
