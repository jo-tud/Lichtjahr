import multiprocessing as mp
import time

import pytest

from lichtjahr.lock import Locked, LockLost, ProjectLock
from lichtjahr.storage import LocalStorage


def test_second_client_sees_lock_and_owner(tmp_path):
    lock = ProjectLock(LocalStorage(str(tmp_path)))
    lock.acquire("a", "Anna")
    with pytest.raises(Locked) as e:
        lock.acquire("b", "Bernd")
    assert e.value.info.holder == "Anna"
    lock.release("a")
    assert lock.acquire("b", "Bernd").holder == "Bernd"


def test_heartbeat_and_release_need_matching_session(tmp_path):
    lock = ProjectLock(LocalStorage(str(tmp_path)))
    lock.acquire("a", "Anna")
    with pytest.raises(LockLost):
        lock.heartbeat("b")
    lock.release("b")                        # fremde Sitzung gibt nichts frei
    assert lock.read()[0].session == "a"


def test_expired_lock_taken_over_and_stale_writer_stopped(tmp_path):
    lock = ProjectLock(LocalStorage(str(tmp_path)), lease=0.2)
    lock.acquire("a", "Anna")
    time.sleep(0.3)
    lock.acquire("b", "Bernd")               # kontrollierte Übernahme der abgelaufenen Sperre
    with pytest.raises(LockLost):
        lock.heartbeat("a")                  # alter Besitzer bemerkt den Verlust
    with pytest.raises(LockLost):
        lock.check("a")


def _try(root, sid, start, results):
    while time.time() < start:
        pass
    try:
        ProjectLock(LocalStorage(root)).acquire(sid, sid)
        results.put(sid)
    except Locked:
        results.put(None)


@pytest.mark.parametrize("round_", range(5))
def test_concurrent_acquire_has_exactly_one_winner(tmp_path, round_):
    ctx = mp.get_context("forkserver")      # nicht „fork“: der Testprozess hat Threads (OpenCV, Testclient)
    results, start = ctx.Queue(), time.time() + 2
    procs = [ctx.Process(target=_try, args=(str(tmp_path), f"s{i}", start, results)) for i in range(6)]
    for p in procs:
        p.start()
    for p in procs:
        p.join(10)
    winners = [w for w in (results.get() for _ in procs) if w]
    assert len(winners) == 1


def _takeover(root, sid, start, results):
    while time.time() < start:
        pass
    try:
        ProjectLock(LocalStorage(root), lease=60).acquire(sid, sid)
        results.put(sid)
    except Locked:
        results.put(None)


def test_concurrent_takeover_of_expired_lock_has_one_winner(tmp_path):
    ProjectLock(LocalStorage(str(tmp_path)), lease=0.01).acquire("alt", "alt")
    time.sleep(0.05)
    ctx = mp.get_context("forkserver")      # nicht „fork“: der Testprozess hat Threads (OpenCV, Testclient)
    results, start = ctx.Queue(), time.time() + 2
    procs = [ctx.Process(target=_takeover, args=(str(tmp_path), f"s{i}", start, results)) for i in range(6)]
    for p in procs:
        p.start()
    for p in procs:
        p.join(10)
    assert len([w for w in (results.get() for _ in procs) if w]) == 1


def _beat(root, sid, start, results):
    while time.time() < start:
        pass
    try:
        ProjectLock(LocalStorage(root)).heartbeat(sid)
        results.put("ok")
    except LockLost as e:
        results.put(str(e))


@pytest.mark.parametrize("round_", range(3))
def test_concurrent_heartbeats_of_one_session_never_lose_the_lock(tmp_path, round_):
    """Ein Tab kommt zurück: Sichtbarkeit und Taktgeber schicken gleichzeitig ein Lebenszeichen. Das darf nicht
    als „anderes Fenster“ gelten – die Sperre gehört weiter derselben Sitzung."""
    root = str(tmp_path)
    ProjectLock(LocalStorage(root)).acquire("a", "Anna")
    results, start = mp.Queue(), time.time() + 0.5
    procs = [mp.Process(target=_beat, args=(root, "a", start, results)) for _ in range(6)]
    for p in procs:
        p.start()
    for p in procs:
        p.join(10)
    got = [results.get(timeout=5) for _ in procs]
    assert got == ["ok"] * len(procs), got
    assert ProjectLock(LocalStorage(root)).read()[0].session == "a"


def test_own_expired_lock_is_renewed_not_lost(tmp_path):
    """Nach Ruhezustand oder eingefrorenem Tab ist die eigene Sperre abgelaufen, aber niemand hat sie übernommen:
    Speichern erneuert sie, statt die Bearbeitung zu beenden."""
    lock = ProjectLock(LocalStorage(str(tmp_path)), lease=0.2)
    lock.acquire("a", "Anna")
    time.sleep(0.3)
    info = lock.check("a")
    assert info.session == "a" and not info.expired
    time.sleep(0.3)
    lock.acquire("b", "Bernd")               # hat ein anderer übernommen, gilt die Sperre weiter als verloren
    with pytest.raises(LockLost):
        lock.check("a")


def _skewed(lock, session, offset):
    """Sperre so schreiben, als ginge die Uhr des Besitzers um ``offset`` Sekunden falsch."""
    import json as _json
    now = time.time() + offset
    lock.storage.write(".lichtjahr/lock.json", _json.dumps(
        {"session": session, "holder": "Anna", "device": "anna-pc", "created": now, "heartbeat": now, "expires": now + lock.lease}).encode())


def test_wrong_clocks_do_not_steal_or_keep_locks(tmp_path):
    """Ob eine fremde Sperre verwaist ist, entscheidet die Uhr des Speichers, nicht die Rechneruhren."""
    import os
    store = LocalStorage(str(tmp_path))
    store.makedirs(".lichtjahr")
    lock = ProjectLock(store, lease=60)
    _skewed(lock, "a", -600)                 # Annas Uhr geht 10 Minuten nach: Zeitstempel wirken abgelaufen …
    with pytest.raises(Locked) as e:         # … aber sie hat gerade geschrieben: keine Übernahme
        lock.acquire("b", "Bernd")
    assert e.value.age is not None and e.value.age < 5
    _skewed(lock, "a", +3600)                # Uhr geht eine Stunde vor: Zeitstempel wirken frisch …
    old = time.time() - 120
    os.utime(tmp_path / ".lichtjahr" / "lock.json", (old, old))   # … aber seit 2 Minuten kein Lebenszeichen
    assert lock.acquire("b", "Bernd").session == "b"
