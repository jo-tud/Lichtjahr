"""Projektweite Bearbeitungssperre mit begrenzter Laufzeit (Lease).

Die Sperrdatei ``.lichtjahr/lock.json`` enthält eine zufällige Sitzungs-ID, Bearbeiter, Gerät,
Erstellzeit, letzten Herzschlag und Ablaufzeit. Erwerb, Erneuern und Freigeben laufen ausschließlich
über die atomaren Grundoperationen des Speichers (exklusives Anlegen, Ersetzen mit ETag-Prüfung):

* Ist die Datei frei, gewinnt genau ein Client das exklusive Anlegen.
* Ist eine Sperre abgelaufen, wird sie per bedingtem Ersetzen übernommen; von zwei gleichzeitigen
  Übernahmen gewinnt genau eine.
* Erneuern und Freigeben gelingen nur mit passender Sitzung und unverändertem Stand.
"""

from __future__ import annotations

import json
import secrets
import socket
import time
from dataclasses import asdict, dataclass

from .i18n import _t
from .schema import META_DIR
from .storage import AlreadyExists, Conflict, NotFound, Storage

LOCK_PATH = f"{META_DIR}/lock.json"
HANDOVER_PATH = f"{META_DIR}/handover.json"   # Anfrage, die Bearbeitung zu übernehmen, und die Antwort darauf
DEFAULT_LEASE = 120.0
FORCE_AFTER = 45.0                            # so lange ohne Antwort, bevor man (nach Warnung) übernehmen darf


class LockError(Exception):
    pass


class Locked(LockError):
    def __init__(self, info: "LockInfo", age: float | None = None) -> None:
        super().__init__(_t("Gesperrt durch {holder} auf {device}", holder=info.holder, device=info.device))
        self.info = info
        self.age = age


class LockLost(LockError):
    """Die eigene Sperre gehört nicht mehr dieser Sitzung (abgelaufen und übernommen oder entfernt)."""


@dataclass
class LockInfo:
    session: str
    holder: str
    device: str
    created: float
    heartbeat: float
    expires: float

    @property
    def expired(self) -> bool:
        return time.time() > self.expires

    def public(self, age: float | None = None) -> dict:
        d = asdict(self)
        d.pop("session")
        d["expired"] = self.expired
        if age is not None:                    # Sekunden seit dem letzten Lebenszeichen, mit der Uhr des Speichers
            d["age"] = round(age, 1)
        return d


def new_session() -> str:
    return secrets.token_urlsafe(18)


class ProjectLock:
    def __init__(self, storage: Storage, lease: float = DEFAULT_LEASE) -> None:
        self.storage = storage
        self.lease = lease

    def age(self) -> float | None:
        """Sekunden seit dem letzten Schreiben der Sperrdatei, mit der Uhr des Speichers; None, wenn unbekannt."""
        try:
            return self.storage.age(LOCK_PATH)
        except Exception:                      # z. B. ein Server ohne Last-Modified: dann zählen die Zeitstempel
            return None

    def stale(self, info: LockInfo, age: float | None) -> bool:
        """Ist eine fremde Sperre verwaist? Entschieden mit der Uhr des Speichers (seit wann schreibt niemand
        mehr Lebenszeichen) gegen die Laufzeit, die der Besitzer eingetragen hat (Ablauf minus Lebenszeichen,
        beides von seiner Uhr, also als Dauer verlässlich) – nicht mit der Ablaufzeit nach fremder Uhr: Geht
        ein Rechner ein paar Minuten vor, würde er sonst laufend fremde Sperren übernehmen."""
        if age is None:
            return info.expired
        lease = info.expires - info.heartbeat
        return age > (lease if 0 < lease < 86400 else self.lease)

    def read(self) -> tuple[LockInfo | None, str | None]:
        try:
            data, etag = self.storage.read(LOCK_PATH)
        except NotFound:
            return None, None
        try:
            return LockInfo(**json.loads(data)), etag
        except (ValueError, TypeError):
            # unlesbare Sperrdatei gilt als abgelaufen, damit sie kontrolliert übernommen werden kann
            return LockInfo("", "?", "?", 0, 0, 0), etag

    def _payload(self, session: str, holder: str, created: float | None = None) -> bytes:
        now = time.time()
        info = LockInfo(session, holder, socket.gethostname(), created or now, now, now + self.lease)
        return json.dumps(asdict(info), indent=2).encode()

    def acquire(self, session: str, holder: str) -> LockInfo:
        try:
            self.storage.create_exclusive(LOCK_PATH, self._payload(session, holder))
            return self.read()[0]  # type: ignore[return-value]
        except AlreadyExists:
            pass
        info, etag = self.read()
        if info is None:                       # zwischenzeitlich freigegeben: noch einmal versuchen
            return self.acquire(session, holder)
        if info.session == session:
            return self.heartbeat(session)
        age = self.age()
        if not self.stale(info, age):
            raise Locked(info, age)
        try:                                   # abgelaufene Sperre kontrolliert übernehmen
            self.storage.replace(LOCK_PATH, self._payload(session, holder), if_match=etag)
        except Conflict:
            current, _ = self.read()
            raise Locked(current or info, self.age())
        return self.read()[0]  # type: ignore[return-value]

    def heartbeat(self, session: str, holder: str | None = None) -> LockInfo:
        info, etag = self.read()
        if info is None or info.session != session:
            raise LockLost(_t("Die Sperre gehört nicht mehr dieser Sitzung."))
        try:
            self.storage.replace(LOCK_PATH, self._payload(session, holder or info.holder, info.created), if_match=etag)
        except Conflict as e:
            # Gleichzeitig hat jemand die Datei geschrieben. War es dieselbe Sitzung (zwei Lebenszeichen auf einmal,
            # etwa wenn ein Tab wieder sichtbar wird), ist die Sperre frisch und gehört weiter uns – kein Verlust.
            current, _ = self.read()
            if current is not None and current.session == session and not current.expired:
                return current
            raise LockLost(_t("Die Sperre wurde zwischenzeitlich verändert.")) from e
        return self.read()[0]  # type: ignore[return-value]

    def release(self, session: str) -> None:
        info, etag = self.read()
        if info is None or info.session != session:
            return
        try:
            self.storage.delete(LOCK_PATH, if_match=etag)
        except (Conflict, NotFound):
            pass

    def check(self, session: str | None) -> LockInfo:
        """Für Schreibzugriffe: Sperre muss dieser Sitzung gehören und gültig sein."""
        info, _ = self.read()
        if not session or info is None or info.session != session:
            raise LockLost(_t("Zum Ändern zuerst die Bearbeitungssperre erwerben."))
        if info.expired:
            # Abgelaufen, aber niemand hat übernommen (Ruhezustand, eingefrorener Tab): erneuern statt verlieren
            return self.heartbeat(session)
        return info


# -- Übergabe ------------------------------------------------------------------------------------
# Wer nur ansehen kann, fragt an; wer bearbeitet, übergibt, bittet um ein paar Minuten oder lehnt ab. Bleibt eine
# Anfrage unbeantwortet (niemand am anderen Rechner, Fenster eingeschlafen), darf die Anfragende nach einer Weile
# und einer Warnung übernehmen. Die Anfrage liegt neben der Sperre im Projekt, damit es über zwei Rechner geht;
# Wartezeiten misst die Uhr des Speichers.
class Handover:
    def __init__(self, lock: ProjectLock) -> None:
        self.lock = lock
        self.storage = lock.storage

    def read(self) -> tuple[dict | None, float | None]:
        try:
            data, _ = self.storage.read(HANDOVER_PATH)
            req = json.loads(data)
        except (NotFound, ValueError):
            return None, None
        try:
            age = self.storage.age(HANDOVER_PATH)
        except Exception:
            age = None
        return (req if isinstance(req, dict) and req.get("session") else None), age

    def public(self, session: str | None) -> dict | None:
        req, age = self.read()
        if not req:
            return None
        out = {"name": req.get("name", ""), "status": req.get("status", "open"), "minutes": req.get("minutes"),
               "mine": bool(session) and req["session"] == session, "age": None if age is None else round(age, 1)}
        out["forceIn"] = None if age is None else max(0.0, round(self._wait(req) - age, 1))
        return out

    @staticmethod
    def _wait(req: dict) -> float:
        """Sekunden ohne Antwort, nach denen übernommen werden darf; bei „gleich“ zählt die erbetene Zeit dazu."""
        if req.get("status") == "later":
            return float(req.get("minutes") or 5) * 60 + FORCE_AFTER
        return FORCE_AFTER

    def _write(self, req: dict) -> None:
        self.storage.write(HANDOVER_PATH, json.dumps(req, indent=2).encode())

    def clear(self, session: str | None = None) -> None:
        req, _ = self.read()
        if req and (session is None or req.get("session") == session):
            try:
                self.storage.delete(HANDOVER_PATH)
            except (NotFound, Conflict):
                pass

    def ask(self, session: str, name: str) -> None:
        self._write({"id": new_session(), "session": session, "name": name[:80], "status": "open", "asked": time.time()})

    def answer(self, holder_session: str, status: str, minutes: int | None = None) -> None:
        info, _ = self.lock.read()
        if not holder_session or info is None or info.session != holder_session:
            raise LockLost(_t("Die Sperre gehört nicht mehr dieser Sitzung."))
        req, _ = self.read()
        if not req:
            return
        req.update(status=status, minutes=minutes if status == "later" else None)
        self._write(req)

    def give(self, holder_session: str) -> LockInfo:
        """Bearbeitung an die Anfragende übergeben: die Sperre gehört sofort ihrer Sitzung."""
        info, etag = self.lock.read()
        if not holder_session or info is None or info.session != holder_session:
            raise LockLost(_t("Die Sperre gehört nicht mehr dieser Sitzung."))
        req, _ = self.read()
        if not req:
            raise LockError(_t("Es liegt keine Anfrage vor."))
        try:
            self.storage.replace(LOCK_PATH, self.lock._payload(req["session"], req.get("name") or "?"), if_match=etag)
        except Conflict as e:
            raise LockLost(_t("Die Sperre wurde zwischenzeitlich verändert.")) from e
        req.update(status="granted")
        self._write(req)
        return self.lock.read()[0]  # type: ignore[return-value]

    def force(self, session: str, name: str) -> LockInfo:
        """Übernehmen ohne Zustimmung – nur nach einer eigenen, lange genug unbeantworteten Anfrage."""
        req, age = self.read()
        if not req or req.get("session") != session or req.get("status") not in ("open", "later"):
            raise LockError(_t("Zuerst die Bearbeitung anfragen."))
        if age is None:                         # Speicher ohne Änderungszeit: dann eben mit der eigenen Uhr
            age = time.time() - float(req.get("asked") or time.time())
        if age < self._wait(req):
            raise LockError(_t("Bitte noch etwas auf eine Antwort warten."))
        info, etag = self.lock.read()
        payload = self.lock._payload(session, name or req.get("name") or "?")
        try:
            if info is None:
                self.storage.create_exclusive(LOCK_PATH, payload)
            else:
                self.storage.replace(LOCK_PATH, payload, if_match=etag)
        except (Conflict, AlreadyExists) as e:
            raise LockError(_t("Die Sperre wurde zwischenzeitlich verändert.")) from e
        req.update(status="forced")
        self._write(req)
        return self.lock.read()[0]  # type: ignore[return-value]
