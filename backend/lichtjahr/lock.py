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

from .schema import META_DIR
from .storage import AlreadyExists, Conflict, NotFound, Storage

LOCK_PATH = f"{META_DIR}/lock.json"
DEFAULT_LEASE = 120.0


class LockError(Exception):
    pass


class Locked(LockError):
    def __init__(self, info: "LockInfo") -> None:
        super().__init__(f"Gesperrt durch {info.holder} auf {info.device}")
        self.info = info


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

    def public(self) -> dict:
        d = asdict(self)
        d.pop("session")
        d["expired"] = self.expired
        return d


def new_session() -> str:
    return secrets.token_urlsafe(18)


class ProjectLock:
    def __init__(self, storage: Storage, lease: float = DEFAULT_LEASE) -> None:
        self.storage = storage
        self.lease = lease

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
        if not info.expired:
            raise Locked(info)
        try:                                   # abgelaufene Sperre kontrolliert übernehmen
            self.storage.replace(LOCK_PATH, self._payload(session, holder), if_match=etag)
        except Conflict:
            current, _ = self.read()
            raise Locked(current or info)
        return self.read()[0]  # type: ignore[return-value]

    def heartbeat(self, session: str) -> LockInfo:
        info, etag = self.read()
        if info is None or info.session != session:
            raise LockLost("Die Sperre gehört nicht mehr dieser Sitzung.")
        try:
            self.storage.replace(LOCK_PATH, self._payload(session, info.holder, info.created), if_match=etag)
        except Conflict as e:
            raise LockLost("Die Sperre wurde zwischenzeitlich verändert.") from e
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
            raise LockLost("Zum Ändern zuerst die Bearbeitungssperre erwerben.")
        if info.expired:
            raise LockLost("Die Sperre ist abgelaufen. Bitte erneut erwerben.")
        return info
