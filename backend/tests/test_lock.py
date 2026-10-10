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
