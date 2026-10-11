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
DEFAULT_LEASE = 120.0


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

    def heartbeat(self, session: str) -> LockInfo:
        info, etag = self.read()
        if info is None or info.session != session:
            raise LockLost(_t("Die Sperre gehört nicht mehr dieser Sitzung."))
        try:
            self.storage.replace(LOCK_PATH, self._payload(session, info.holder, info.created), if_match=etag)
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
