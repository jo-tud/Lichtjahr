import pytest

from lichtjahr.storage import AlreadyExists, Conflict, LocalStorage, StorageError


def test_create_exclusive_and_replace(tmp_path):
    s = LocalStorage(str(tmp_path))
    etag = s.create_exclusive("a/b.json", b"1")
    with pytest.raises(AlreadyExists):
        s.create_exclusive("a/b.json", b"2")
    etag2 = s.replace("a/b.json", b"2", if_match=etag)
    with pytest.raises(Conflict):
        s.replace("a/b.json", b"3", if_match=etag)        # veralteter Stand
    assert s.read("a/b.json") == (b"2", etag2)


def test_move_never_overwrites_and_keeps_bytes(tmp_path):
    s = LocalStorage(str(tmp_path))
    s.write("x/eins.jpg", b"EINS")
    s.write("y/eins.jpg", b"ANDERS")
    with pytest.raises(AlreadyExists):
        s.move("x/eins.jpg", "y/eins.jpg")
    assert s.read("y/eins.jpg")[0] == b"ANDERS"
    s.move("x/eins.jpg", "z/eins.jpg")
    assert s.read("z/eins.jpg")[0] == b"EINS" and not s.exists("x/eins.jpg")


def test_paths_stay_inside_project(tmp_path):
    s = LocalStorage(str(tmp_path / "p"))
    with pytest.raises(StorageError):
        s.read("../geheim.txt")
