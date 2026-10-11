"""Übergabe der Bearbeitung: anfragen, beantworten, übergeben, notfalls übernehmen."""

import os
import time

from fastapi.testclient import TestClient

from lichtjahr.api import create_app
from lichtjahr.config import Settings


def two_people(tmp_path):
    root = tmp_path / "Kalender"
    anna = TestClient(create_app(Settings(data_dir=str(tmp_path / "a"), cache_dir=str(tmp_path / "ac"))), base_url="http://localhost")
    pid = anna.post("/api/projects", json={"path": str(root), "calendarYear": 2027}).json()["id"]
    bernd = TestClient(create_app(Settings(data_dir=str(tmp_path / "b"), cache_dir=str(tmp_path / "bc"))), base_url="http://localhost")
    assert bernd.post("/api/projects/open", json={"path": str(root)}).status_code == 200
    a = {"X-Lichtjahr-Session": anna.post(f"/api/projects/{pid}/lock", json={"holder": "Anna"}).json()["session"]}
    assert bernd.post(f"/api/projects/{pid}/lock", json={"holder": "Bernd"}).status_code == 423
    return anna, bernd, pid, a, root


def test_request_answer_and_hand_over(tmp_path):
    anna, bernd, pid, a, _ = two_people(tmp_path)
    r = bernd.post(f"/api/projects/{pid}/lock/request", json={"holder": "Bernd"}).json()
    b = {"X-Lichtjahr-Session": r["session"]}
    assert r["request"]["mine"] and r["request"]["status"] == "open"
    seen = anna.post(f"/api/projects/{pid}/lock/heartbeat", headers=a, json={}).json()["request"]
    assert seen["name"] == "Bernd" and not seen["mine"]               # Anna sieht die Anfrage beim Lebenszeichen
    anna.post(f"/api/projects/{pid}/lock/answer", headers=a, json={"status": "later", "minutes": 5})
    st = bernd.get(f"/api/projects/{pid}/lock", headers=b).json()["request"]
    assert st["status"] == "later" and st["minutes"] == 5 and st["forceIn"] > 300
    assert bernd.post(f"/api/projects/{pid}/lock/answer", headers=b, json={"status": "declined"}).status_code == 423   # nur wer bearbeitet
    got = anna.post(f"/api/projects/{pid}/lock/handover", headers=a).json()["lock"]
    assert got["holder"] == "Bernd"
    assert bernd.post(f"/api/projects/{pid}/lock", headers=b, json={"holder": "Bernd"}).status_code == 200
    assert anna.post(f"/api/projects/{pid}/lock/heartbeat", headers=a, json={}).status_code == 423
    assert bernd.get(f"/api/projects/{pid}/lock", headers=b).json()["request"] is None   # Anfrage erledigt


def test_force_only_after_waiting_and_not_after_decline(tmp_path):
    anna, bernd, pid, a, root = two_people(tmp_path)
    assert bernd.post(f"/api/projects/{pid}/lock/force", json={"holder": "Bernd"}).status_code == 409   # ohne Anfrage
    b = {"X-Lichtjahr-Session": bernd.post(f"/api/projects/{pid}/lock/request", json={"holder": "Bernd"}).json()["session"]}
    assert bernd.post(f"/api/projects/{pid}/lock/force", headers=b, json={"holder": "Bernd"}).status_code == 409   # zu früh
    old = time.time() - 60
    os.utime(root / ".lichtjahr" / "handover.json", (old, old))       # eine Minute ohne Antwort
    r = bernd.post(f"/api/projects/{pid}/lock/force", headers=b, json={"holder": "Bernd"})
    assert r.status_code == 200 and r.json()["lock"]["holder"] == "Bernd"
    assert anna.post(f"/api/projects/{pid}/lock/heartbeat", headers=a, json={}).status_code == 423
    # Ablehnen: dann gibt es kein Übernehmen, nur eine neue Anfrage
    a2 = {"X-Lichtjahr-Session": anna.post(f"/api/projects/{pid}/lock/request", json={"holder": "Anna"}).json()["session"]}
    bernd.post(f"/api/projects/{pid}/lock/answer", headers=b, json={"status": "declined"})
    os.utime(root / ".lichtjahr" / "handover.json", (old, old))
    assert anna.post(f"/api/projects/{pid}/lock/force", headers=a2, json={"holder": "Anna"}).status_code == 409


def test_heartbeat_updates_name(tmp_path):
    anna, bernd, pid, a, _ = two_people(tmp_path)
    anna.post(f"/api/projects/{pid}/lock/heartbeat", headers=a, json={"holder": "Anna K."})
    assert bernd.get(f"/api/projects/{pid}/lock").json()["lock"]["holder"] == "Anna K."
