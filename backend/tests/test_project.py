import os

import pytest
from PIL import Image

from conftest import photo_bytes, put
from lichtjahr.lock import LockLost
from lichtjahr.project import Project, ProjectError, RevisionConflict
from lichtjahr.schema import MONTHS, month_dir


def test_new_project_has_empty_month_folders(project):
    root = project.fs_root
    for m in range(12):
        assert os.path.isdir(os.path.join(root, *month_dir(m).split("/")))
    assert os.path.isdir(os.path.join(root, "Fotos", "Ohne Monat"))
    man, _ = project.load()
    assert man.calendarYear == 2027 and man.sourceYear == 2026 and man.assets == []
    with pytest.raises(ProjectError):
        Project.create(project.storage, "", title="x", calendar_year=2027, source_year=2026)


def test_scan_assigns_months_by_folder_and_suggests_from_exif(project, session):
    root = project.fs_root
    put(root, "Fotos/03 März/a.jpg", photo_bytes(date="2026:09:01 10:00:00"))
    put(root, "Fotos/2026-07 Urlaub/b.jpg", photo_bytes())
    put(root, "Fotos/Ohne Monat/c.jpg", photo_bytes(date="2026:11:04 10:00:00"))
    put(root, "Fotos/IMG_20260814_101500.jpg", photo_bytes())
    put(root, "Fotos/notiz.txt", b"keine Bilddatei")
    rep = project.scan(session)
    assert len(rep.added) == 4
    man, _ = project.load()
    by = {os.path.basename(a.path): a for a in man.assets}
    assert by["a.jpg"].month == 2 and by["a.jpg"].suggestedMonth == 8      # Ordner gilt, EXIF ist Vorschlag
    assert by["b.jpg"].month == 6
    assert by["c.jpg"].month is None and by["c.jpg"].suggestedMonth == 10
    assert by["IMG_20260814_101500.jpg"].month is None and by["IMG_20260814_101500.jpg"].suggestedMonth == 7


def test_rescan_detects_new_moved_changed_missing(project, session):
    root = project.fs_root
    put(root, "Fotos/01 Januar/a.jpg", photo_bytes(color=(1, 2, 3)))
    put(root, "Fotos/01 Januar/b.jpg", photo_bytes(color=(4, 5, 6)))
    put(root, "Fotos/01 Januar/c.jpg", photo_bytes(color=(7, 8, 9)))
    project.scan(session)
    ids = {os.path.basename(a.path): a.id for a in project.load()[0].assets}
    # außerhalb der App: verschieben, ändern, löschen, neu hinzufügen
    os.rename(os.path.join(root, "Fotos/01 Januar/a.jpg"), os.path.join(root, "Fotos/05 Mai/a.jpg"))
    put(root, "Fotos/01 Januar/b.jpg", photo_bytes(color=(200, 0, 0), w=700))
    os.unlink(os.path.join(root, "Fotos/01 Januar/c.jpg"))
    put(root, "Fotos/02 Februar/d.jpg", photo_bytes(color=(9, 9, 9)))
    rep = project.scan(session)
    assert rep.moved == [ids["a.jpg"]] and rep.changed == [ids["b.jpg"]] and rep.missing == [ids["c.jpg"]] and len(rep.added) == 1
    man, _ = project.load()
    a = man.asset(ids["a.jpg"])
    assert a.month == 4 and a.path == "Fotos/05 Mai/a.jpg"                  # gleiche ID, neuer Monat
    assert man.asset(ids["c.jpg"]).status == "missing"                      # Auswahl bleibt, Fehlen wird gemeldet


def test_saving_needs_lock_and_current_revision(project, session):
    man, _ = project.load()
    man.title = "Neu"
    saved = project.save(man, session=session, expected_revision=0)
    assert saved.revision == 1
    stale, _ = project.load()
    stale.revision = 0
    with pytest.raises(RevisionConflict):
        project.save(stale, session=session, expected_revision=0)
    with pytest.raises(LockLost):
        project.save(project.load()[0], session="fremd", expected_revision=1)


def test_move_to_month_keeps_bytes_and_avoids_collisions(project, session):
    root = project.fs_root
    data = photo_bytes(color=(10, 20, 30))
    put(root, "Fotos/01 Januar/foto.jpg", data)
    put(root, "Fotos/03 März/foto.jpg", photo_bytes(color=(99, 99, 99)))
    project.scan(session)
    a = next(x for x in project.load()[0].assets if x.path.startswith("Fotos/01"))
    moved = project.move_to_month(session, a.id, 2)
    assert moved.path == "Fotos/03 März/foto (2).jpg" and moved.month == 2
    with open(os.path.join(root, "Fotos", "03 März", "foto (2).jpg"), "rb") as fh:
        assert fh.read() == data                                            # bytegetreu
    assert len([x for x in project.load()[0].assets if x.month == 2]) == 2


def test_interrupted_move_is_completed_on_recovery(project, session, monkeypatch):
    root = project.fs_root
    put(root, "Fotos/01 Januar/x.jpg", photo_bytes())
    project.scan(session)
    a = project.load()[0].assets[0]

    def crash(*args, **kwargs):
        raise RuntimeError("Stromausfall")
    monkeypatch.setattr(project, "_apply_move", crash)
    with pytest.raises(RuntimeError):
        project.move_to_month(session, a.id, 6)
    assert project.load()[0].asset(a.id).path == "Fotos/01 Januar/x.jpg"    # Manifest noch alt, Datei schon neu
    monkeypatch.undo()
    notes = project.recover(session)
    assert notes and project.load()[0].asset(a.id).path == "Fotos/07 Juli/x.jpg"
    assert project.recover(session) == []                                   # nur einmal


def test_explicit_copy_gets_own_id(project, session):
    put(project.fs_root, "Fotos/01 Januar/x.jpg", photo_bytes())
    project.scan(session)
    a = project.load()[0].assets[0]
    c = project.copy_to_month(session, a.id, 11)
    assert c.id != a.id and c.copyOf == a.id and c.month == 11 and c.contentHash == a.contentHash


def test_upload_never_overwrites_and_rejects_unknown_types(project, session):
    a1, _ = project.add_file(session, "urlaub.jpg", photo_bytes(), 6)
    a2, _ = project.add_file(session, "urlaub.jpg", photo_bytes(color=(1, 1, 1)), 6)
    assert a1.path == "Fotos/07 Juli/urlaub.jpg" and a2.path == "Fotos/07 Juli/urlaub (2).jpg"
    with pytest.raises(ProjectError):
        project.add_file(session, "liste.pdf", b"%PDF", 1)


def test_upload_of_same_photo_creates_no_second_file(project, session):
    a1, dup1 = project.add_file(session, "see.jpg", photo_bytes(), 6)
    project.save_state(session, {}, assets={a1.id: {"excluded": True}})
    a2, dup2 = project.add_file(session, "see-kopie.jpg", photo_bytes(), 2)     # gleiche Bytes
    assert not dup1 and dup2 and a2.id == a1.id and not a2.excluded            # wieder aufgenommen
    assert len(project.load()[0].assets) == 1
    assert not os.path.exists(os.path.join(project.fs_root, "Fotos", "03 März", "see-kopie.jpg"))


def test_save_state_applies_editor_and_photo_metadata_in_one_revision(project, session):
    a, _ = project.add_file(session, "see.jpg", photo_bytes(), 6)
    rev = project.load()[0].revision
    project.save_state(session, {"doc": {"year": 2028}}, calendar_year=2028, format={"id": "a3l", "widthMm": 420, "heightMm": 297, "evil": 1},
                       assets={a.id: {"caption": "Am See", "favorite": True, "path": "/etc/passwd", "excluded": "ja"}, "gibtsnicht": {"caption": "x"}})
    man = project.load()[0]
    b = man.asset(a.id)
    assert man.revision == rev + 1 and man.editor == {"doc": {"year": 2028}} and man.calendarYear == 2028
    assert man.format.id == "a3l" and man.format.widthMm == 420
    assert b.caption == "Am See" and b.favorite and b.path == a.path and b.excluded is False   # nur erlaubte Felder und Typen
    assert project.summary()["photos"] == 1
    project.save_state(session, man.editor, assets={a.id: {"excluded": True}})
    assert project.summary()["photos"] == 0 and project.summary()["perMonth"]["Juli"] == 0


def test_export_lands_in_export_folder_and_replaces_the_draft(project, session):
    assert project.save_export(session, "../../Kalender.pdf", b"%PDF-1") == "Export/Kalender.pdf"
    project.save_export(session, "Kalender.pdf", b"%PDF-2")
    with open(os.path.join(project.fs_root, "Export", "Kalender.pdf"), "rb") as fh:
        assert fh.read() == b"%PDF-2"
    with pytest.raises(ProjectError):
        project.save_export(session, "skript.sh", b"#!")
    with pytest.raises(LockLost):
        project.save_export("fremd", "Kalender.pdf", b"%PDF")


def test_thumbnail_respects_exif_orientation_and_is_cached(project, session):
    put(project.fs_root, "Fotos/01 Januar/hoch.jpg", photo_bytes(w=600, h=400, orientation=6))
    project.scan(session)
    a = project.load()[0].assets[0]
    assert (a.widthPx, a.heightPx) == (400, 600)                            # wie angezeigt
    path = project.thumbnail(a, 200)
    with Image.open(path) as im:
        assert im.size[1] > im.size[0]
    mtime = os.path.getmtime(path)
    assert project.thumbnail(a, 200) == path and os.path.getmtime(path) == mtime


def test_month_names_match_folders():
    assert month_dir(2) == "Fotos/03 März" and len(MONTHS) == 12


def test_summary_shows_home_as_tilde(project, monkeypatch, tmp_path):
    if project.storage.kind != "local":
        pytest.skip("nur für lokale Ordner")
    monkeypatch.setenv("HOME", str(tmp_path))
    s = project.summary()["storage"]
    assert s["location"] == project.storage.root and s["display"] == "~/Kalender"
