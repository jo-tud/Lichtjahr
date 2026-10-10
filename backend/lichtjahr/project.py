"""Ein Kalenderprojekt in einem Speicherort (lokaler Ordner, später WebDAV).

Aufbau des Projektordners::

    lichtjahr.json            Manifest (Schema-Version, Fotos, Gestaltungsstand, Revision)
    Fotos/01 Januar/ …        ein Kandidatenordner je Monat, auch leer gültig
    Fotos/Ohne Monat/         Fotos ohne Zuordnung
    Export/                   fertige PDFs
    .lichtjahr/lock.json      Bearbeitungssperre
    .lichtjahr/journal.jsonl  Journal für Dateiverschiebungen

Die Originalfotos bleiben bytegetreu erhalten. Verschieben ändert nur den Pfad, Kopien entstehen nur
ausdrücklich. Vorschaubilder liegen im lokalen Cache, nicht im Projektordner.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import posixpath
import threading
from dataclasses import dataclass, field

from pydantic import ValidationError

from .lock import ProjectLock
from .media import date_from_name, inspect, is_photo, make_thumbnail, month_from_folder, sha256_stream
from .i18n import _t
from .schema import (EXPORT_DIR, MANIFEST, META_DIR, MONTH_NAMES, NO_MONTH_DIRS, PHOTO_DIRS, SCHEMA_VERSION,
                     Asset, Format, Manifest, folders, lang_of, month_dir, now_iso)
from .storage import AlreadyExists, Conflict, NotFound, Storage

JOURNAL = f"{META_DIR}/journal.jsonl"
THUMB_SIZES = (360, 1600)          # Vorschau in der Fotoübersicht und im Editor


class ProjectError(Exception):
    pass


class RevisionConflict(ProjectError):
    def __init__(self, current: int) -> None:
        super().__init__(_t("Das Projekt wurde inzwischen geändert (Revision {revision}).", revision=current))
        self.current = current


@dataclass
class ScanReport:
    added: list[str] = field(default_factory=list)
    moved: list[str] = field(default_factory=list)
    changed: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    reassigned: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


def folder_month(path: str) -> int | None:
    """Monat eines Fotos aus dem ersten Unterordner unter ``Fotos/`` bzw. ``Photos/``."""
    parts = path.split("/")
    if len(parts) < 3 or parts[0] not in PHOTO_DIRS.values():
        return None
    if parts[1] in NO_MONTH_DIRS.values():
        return None
    return month_from_folder(parts[1])


def unique_name(storage: Storage, folder: str, name: str) -> str:
    """``foto.jpg`` → ``foto (2).jpg``, falls der Name im Ordner schon vergeben ist. Nie überschreiben."""
    base, ext = os.path.splitext(name)
    candidate, n = f"{folder}/{name}", 2
    while storage.exists(candidate):
        candidate, n = f"{folder}/{base} ({n}){ext}", n + 1
    return candidate


def _display(location: str) -> str:
    """Pfad zum Anzeigen: Benutzerordner als ``~`` (kürzer und ohne Benutzernamen)."""
    home = os.path.expanduser("~")
    if home not in ("", "/") and (location == home or location.startswith(home + os.sep)):
        return "~" + location[len(home):]
    return location


class Project:
    def __init__(self, storage: Storage, cache_dir: str) -> None:
        self.storage = storage
        self.lock = ProjectLock(storage)
        self.cache_dir = cache_dir

    # -- Anlegen und Öffnen ------------------------------------------------------------------
    @classmethod
    def create(cls, storage: Storage, cache_dir: str, *, title: str, calendar_year: int, source_year: int,
               format: dict | None = None, language: str = "de") -> "Project":
        if storage.exists(MANIFEST):
            raise ProjectError(_t("In diesem Ordner gibt es schon ein Lichtjahr-Projekt."))
        language = lang_of(language)
        for m in [*range(12), None]:
            storage.makedirs(month_dir(m, language))
        storage.makedirs(EXPORT_DIR)
        storage.makedirs(META_DIR)
        man = Manifest(title=title, language=language, calendarYear=calendar_year, sourceYear=source_year, **({"format": format} if format else {}))
        storage.create_exclusive(MANIFEST, man.model_dump_json(indent=2).encode())
        return cls(storage, cache_dir)

    @classmethod
    def open(cls, storage: Storage, cache_dir: str) -> "Project":
        if not storage.exists(MANIFEST):
            raise ProjectError(_t("Hier liegt kein Lichtjahr-Projekt (lichtjahr.json fehlt)."))
        p = cls(storage, cache_dir)
        p.load()
        return p

    def load(self) -> tuple[Manifest, str]:
        data, etag = self.storage.read(MANIFEST)
        try:
            raw = json.loads(data)
        except ValueError as e:
            raise ProjectError(_t("lichtjahr.json ist beschädigt: {error}", error=e)) from e
        if raw.get("schemaVersion", 0) > SCHEMA_VERSION:
            raise ProjectError(_t("Das Projekt stammt aus einer neueren Lichtjahr-Version."))
        try:
            return Manifest.model_validate(raw), etag
        except ValidationError as e:
            raise ProjectError(_t("lichtjahr.json ist ungültig: {error}", error=e)) from e

    # -- Speichern (nur unter Sperre, mit Revisionsprüfung) ----------------------------------
    def save(self, man: Manifest, *, session: str | None, expected_revision: int | None, etag: str | None = None) -> Manifest:
        """Schreibt das Manifest atomar. Schutz gegen veraltete Schreiber auf zwei Ebenen:
        Revision (aus Sicht des Editors) und ETag (Datei unverändert seit dem Lesen)."""
        self.lock.check(session)
        current, current_etag = self.load()
        if expected_revision is not None and current.revision != expected_revision:
            raise RevisionConflict(current.revision)
        man.revision = current.revision + 1
        man.updated = now_iso()
        try:
            self.storage.replace(MANIFEST, man.model_dump_json(indent=2).encode(), if_match=etag or current_etag)
        except Conflict as e:
            raise RevisionConflict(self.load()[0].revision) from e
        return man

    def update(self, session: str | None, fn) -> Manifest:
        """Liest, ändert mit ``fn(manifest)`` und speichert – für Änderungen des Dienstes selbst."""
        man, etag = self.load()
        fn(man)
        return self.save(man, session=session, expected_revision=man.revision, etag=etag)

    # -- Fotos einlesen ---------------------------------------------------------------------
    def scan(self, session: str | None) -> ScanReport:
        """Gleicht das Manifest mit den Dateien ab. Neue Dateien werden aufgenommen, verschobene über die
        Prüfsumme wiedererkannt, fehlende und veränderte gemeldet – keine Auswahl geht verloren."""
        report = ScanReport()

        def apply(man: Manifest) -> None:
            by_path = {a.path: a for a in man.assets}
            seen: set[str] = set()
            fresh: list[tuple[str, int, int]] = []
            for e in self.storage.walk(PHOTO_DIRS[lang_of(man.language)]):
                if e.is_dir or not is_photo(e.path):
                    continue
                seen.add(e.path)
                a = by_path.get(e.path)
                if a and a.size == e.size and a.mtimeNs == e.mtime_ns:
                    if a.status != "ok":
                        a.status = "ok"
                    self._sync_month(a, report)
                    continue
                fresh.append((e.path, e.size, e.mtime_ns))
            vanished = [a for a in man.assets if a.path not in seen]
            for path, size, mtime in fresh:
                digest = self._hash(path)
                a = by_path.get(path)
                if a:                                            # gleicher Pfad, anderer Inhalt
                    if a.contentHash != digest:
                        a.contentHash = digest
                        a.status = "changed"
                        report.changed.append(a.id)
                        for k, v in self._meta(path).items():
                            setattr(a, k, v)
                    a.size, a.mtimeNs = size, mtime
                    self._sync_month(a, report)
                    continue
                twin = next((v for v in vanished if v.contentHash == digest), None)
                if twin:                                         # außerhalb der App verschoben
                    vanished.remove(twin)
                    twin.path, twin.size, twin.mtimeNs, twin.status = path, size, mtime, "ok"
                    report.moved.append(twin.id)
                    self._sync_month(twin, report)
                    continue
                meta = self._meta(path)
                asset = Asset(path=path, contentHash=digest, size=size, mtimeNs=mtime, month=folder_month(path), **meta)
                man.assets.append(asset)
                report.added.append(asset.id)
            for v in vanished:
                if v.status != "missing":
                    v.status = "missing"
                    report.missing.append(v.id)

        self.update(session, apply)
        return report

    def _sync_month(self, a: Asset, report: ScanReport) -> None:
        m = folder_month(a.path)
        if m != a.month:
            a.month = m
            report.reassigned.append(a.id)

    def _hash(self, path: str) -> str:
        with self.storage.open_read(path) as fh:
            return sha256_stream(fh)

    def _meta(self, path: str) -> dict:
        with self.storage.open_read(path) as fh:
            info = inspect(fh)
        d = info.get("captureDate")
        guess = int(d[5:7]) - 1 if d else None
        if guess is None:
            nd = date_from_name(posixpath.basename(path))
            guess = nd.month - 1 if nd else None
        info["suggestedMonth"] = guess
        return info

    # -- Hochladen, Verschieben, Kopieren ---------------------------------------------------
    def add_file(self, session: str | None, name: str, data: bytes, month: int | None) -> tuple[Asset, bool]:
        """Speichert ein hochgeladenes Foto im Ordner des Monats, ohne etwas zu überschreiben.
        Liegt dasselbe Foto (gleiche Prüfsumme) schon im Projekt, entsteht keine zweite Datei; ein
        aussortiertes wird wieder aufgenommen. Rückgabe: (Asset, war schon vorhanden)."""
        self.lock.check(session)
        if not is_photo(name):
            raise ProjectError(_t("{name}: kein unterstütztes Bildformat (JPEG, PNG, WebP, TIFF, GIF).", name=name))
        digest = hashlib.sha256(data).hexdigest()
        man, _ = self.load()
        twin = next((a for a in man.assets if a.contentHash == digest and a.status != "missing"), None)
        if twin:
            if twin.excluded:
                def include(m: Manifest) -> None:
                    a = m.asset(twin.id)
                    if a:
                        a.excluded = False
                man = self.update(session, include)
            return man.asset(twin.id) or twin, True  # type: ignore[return-value]
        safe = posixpath.basename(name.replace("\\", "/")).strip() or "foto.jpg"
        folder = month_dir(month, man.language)
        while True:
            target = unique_name(self.storage, folder, safe)
            try:
                self.storage.create_exclusive(target, data)
                break
            except AlreadyExists:                               # gleichzeitig angelegt: nächster Name
                continue
        st = self.storage.stat(target)
        holder: dict = {}

        def apply(man: Manifest) -> None:
            a = Asset(path=target, contentHash=self._hash(target), size=st.size, mtimeNs=st.mtime_ns, month=month, **self._meta(target))
            man.assets.append(a)
            holder["a"] = a

        self.update(session, apply)
        return holder["a"], False

    def _journal(self, entry: dict) -> None:
        line = json.dumps({**entry, "time": now_iso()}, ensure_ascii=False) + "\n"
        try:
            data, etag = self.storage.read(JOURNAL)
        except NotFound:
            data, etag = b"", None
        if etag is None:
            try:
                self.storage.create_exclusive(JOURNAL, line.encode())
                return
            except AlreadyExists:
                data, etag = self.storage.read(JOURNAL)
        self.storage.replace(JOURNAL, data + line.encode(), if_match=etag)

    def move_to_month(self, session: str | None, asset_id: str, month: int | None) -> Asset:
        """Ordnet ein Foto einem anderen Monat zu, indem die Datei in dessen Ordner wandert.
        Ablauf mit Journal: geplant → verschoben → Manifest aktualisiert → erledigt.
        Bricht etwas dazwischen ab, stellt ``recover`` den Stand beim nächsten Öffnen wieder her."""
        self.lock.check(session)
        man, _ = self.load()
        a = man.asset(asset_id)
        if not a:
            raise ProjectError(_t("Foto nicht gefunden."))
        if a.month == month and posixpath.dirname(a.path) == month_dir(month, man.language):
            return a
        src = a.path
        dst = unique_name(self.storage, month_dir(month, man.language), posixpath.basename(src))
        op = {"op": "move", "id": asset_id, "src": src, "dst": dst, "month": month}
        self._journal({**op, "state": "planned"})
        self.storage.move(src, dst)
        self._journal({**op, "state": "moved"})
        self._apply_move(session, asset_id, dst, month)
        self._journal({**op, "state": "done"})
        return self.load()[0].asset(asset_id)  # type: ignore[return-value]

    def _apply_move(self, session: str | None, asset_id: str, dst: str, month: int | None) -> None:
        def apply(man: Manifest) -> None:
            a = man.asset(asset_id)
            if a:
                st = self.storage.stat(dst)
                a.path, a.month, a.size, a.mtimeNs, a.status = dst, month, st.size, st.mtime_ns, "ok"
        self.update(session, apply)

    def copy_to_month(self, session: str | None, asset_id: str, month: int | None) -> Asset:
        """Ausdrückliche Kopie für einen weiteren Monat: eigene Datei, eigene Asset-ID."""
        self.lock.check(session)
        man, _ = self.load()
        a = man.asset(asset_id)
        if not a:
            raise ProjectError(_t("Foto nicht gefunden."))
        dst = unique_name(self.storage, month_dir(month, man.language), posixpath.basename(a.path))
        self.storage.copy(a.path, dst)
        st = self.storage.stat(dst)
        holder: dict = {}

        def apply(m: Manifest) -> None:
            c = Asset(**{**a.model_dump(), "id": Asset.model_fields["id"].default_factory(), "path": dst, "month": month,
                         "size": st.size, "mtimeNs": st.mtime_ns, "copyOf": a.id, "added": now_iso()})
            m.assets.append(c)
            holder["c"] = c

        self.update(session, apply)
        return holder["c"]

    def recover(self, session: str | None) -> list[str]:
        """Unterbrochene Verschiebungen abschließen oder als abgebrochen vermerken."""
        try:
            data, _ = self.storage.read(JOURNAL)
        except NotFound:
            return []
        ops: dict[tuple, dict] = {}
        for line in data.decode().splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            ops[(e.get("id"), e.get("src"), e.get("dst"))] = e
        notes = []
        for e in ops.values():
            if e.get("state") == "done" or e.get("op") != "move":
                continue
            src_ok, dst_ok = self.storage.exists(e["src"]), self.storage.exists(e["dst"])
            if dst_ok and not src_ok:
                self._apply_move(session, e["id"], e["dst"], e["month"])
                self._journal({**{k: e[k] for k in ("op", "id", "src", "dst", "month")}, "state": "done", "recovered": True})
                notes.append(_t("Verschiebung abgeschlossen: {src} → {dst}", src=e["src"], dst=e["dst"]))
            elif src_ok and not dst_ok:
                self._journal({**{k: e[k] for k in ("op", "id", "src", "dst", "month")}, "state": "done", "aborted": True})
                notes.append(_t("Verschiebung nicht ausgeführt, Datei liegt weiter in {src}", src=e["src"]))
            else:
                notes.append(_t("Unklarer Stand, bitte prüfen: {src} / {dst}", src=e["src"], dst=e["dst"]))
        return notes

    # -- Gestaltungsstand und Export --------------------------------------------------------
    def save_state(self, session: str | None, editor: dict, *, calendar_year: int | None = None,
                   format: dict | None = None, assets: dict[str, dict] | None = None, printer: str | None = None) -> Manifest:
        """Speichert den Gestaltungsstand des Editors zusammen mit Bildtexten, Favoriten und dem
        Aussortieren von Fotos in einem Schritt (eine Revision)."""
        allowed = {"caption": str, "favorite": bool, "rating": int, "excluded": bool}

        def apply(man: Manifest) -> None:
            man.editor = editor
            if printer is not None:
                man.printerProfileId = printer or None
            if calendar_year:
                man.calendarYear = calendar_year
            if format:
                try:
                    man.format = Format.model_validate({**man.format.model_dump(), **{k: v for k, v in format.items() if k in Format.model_fields}})
                except ValidationError as e:
                    raise ProjectError(_t("Ungültiges Format: {error}", error=e)) from e
            for aid, meta in (assets or {}).items():
                a = man.asset(aid)
                if not a:
                    continue
                for k, v in meta.items():
                    if k in allowed and isinstance(v, allowed[k]):
                        setattr(a, k, v)

        return self.update(session, apply)

    def save_export(self, session: str | None, name: str, data: bytes) -> str:
        """Legt ein PDF in ``Export/`` ab. Ein gleichnamiger Entwurf wird ersetzt (atomar)."""
        self.lock.check(session)
        safe = posixpath.basename(name.replace("\\", "/")).strip()
        if not safe.lower().endswith(".pdf") or safe.startswith("."):
            raise ProjectError(_t("Export: nur PDF-Dateien."))
        path = f"{EXPORT_DIR}/{safe}"
        self.storage.makedirs(EXPORT_DIR)
        self.storage.replace(path, data, if_match=None)
        return path

    # -- Vorschaubilder ---------------------------------------------------------------------
    def thumbnail(self, asset: Asset, size: int) -> str:
        """Pfad zur Vorschau im lokalen Cache; wird bei Bedarf erzeugt. Schlüssel ist die Prüfsumme."""
        size = max(64, min(2400, size))
        cached = lambda s: os.path.join(self.cache_dir, "thumbs", asset.contentHash[:2], f"{asset.contentHash}_{s}.v2.jpg")  # noqa: E731 (v2: mit Farbprofil)
        path = cached(size)
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            # Original nur einmal lesen und gleich auch die üblichen Größen der App erzeugen
            # (wichtig bei WebDAV, wo jedes Lesen ein Download ist)
            with self.storage.open_read(asset.path) as fh:
                original = fh.read()
            for s in sorted({size, *THUMB_SIZES}):
                target = cached(s)
                if s != size and os.path.exists(target):
                    continue
                data = make_thumbnail(io.BytesIO(original), s)
                tmp = f"{target}.{os.getpid()}.{threading.get_ident()}.tmp"   # gleichzeitige Anfragen für dieselbe Vorschau
                with open(tmp, "wb") as out:
                    out.write(data)
                os.replace(tmp, target)
        return path

    # -- Übersicht --------------------------------------------------------------------------
    def summary(self) -> dict:
        man, _ = self.load()
        per_month = [0] * 12
        for a in man.assets:
            if a.month is not None and a.status != "missing" and not a.excluded:
                per_month[a.month] += 1
        lock, _ = self.lock.read()
        return {
            "id": man.id, "title": man.title, "calendarYear": man.calendarYear, "sourceYear": man.sourceYear,
            "format": man.format.model_dump(), "revision": man.revision, "storage": {"kind": self.storage.kind, "location": self.storage.describe(),
                        "display": self.storage.display() if hasattr(self.storage, "display") else _display(self.storage.describe()),
                        "folders": folders(man.language)},
            "photos": sum(not a.excluded for a in man.assets), "perMonth": dict(zip(MONTH_NAMES[lang_of(man.language)], per_month)),
            "language": lang_of(man.language),
            "missing": sum(a.status == "missing" and not a.excluded for a in man.assets),
            "lock": lock.public() if lock else None,
        }
