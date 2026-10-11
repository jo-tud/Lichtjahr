"""Lokaler Projektordner.

Atomarität:
* Exklusives Anlegen über ``O_CREAT | O_EXCL``.
* Ersetzen über temporäre Datei + ``os.replace``; der ETag-Vergleich davor ist durch eine
  ``flock``-Sperre auf ``.lichtjahr/.cas`` gegen andere Prozesse auf demselben Rechner geschützt.
* Verschieben ohne Überschreiben über ``os.link`` + ``os.unlink`` (schlägt fehl, wenn das Ziel existiert).
"""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import os
import time
import shutil
import tempfile
from typing import Iterator

from .base import AlreadyExists, Conflict, Entry, NotFound, StorageError
from ..i18n import _t


def etag_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:32]


class LocalStorage:
    kind = "local"

    def __init__(self, root: str) -> None:
        self.root = os.path.abspath(os.path.expanduser(root))

    # -- Hilfen -----------------------------------------------------------------------------
    def describe(self) -> str:
        return self.root

    def _abs(self, path: str) -> str:
        p = os.path.normpath(os.path.join(self.root, *path.split("/")))
        if p != self.root and not p.startswith(self.root + os.sep):
            raise StorageError(_t("Pfad außerhalb des Projektordners: {path}", path=path))
        return p

    @contextlib.contextmanager
    def _cas_lock(self):
        lock_dir = os.path.join(self.root, ".lichtjahr")
        os.makedirs(lock_dir, exist_ok=True)
        with open(os.path.join(lock_dir, ".cas"), "a+") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)

    def _atomic_write(self, abs_path: str, data: bytes) -> None:
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(abs_path))
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, abs_path)
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(tmp)
            raise

    # -- Lesen ------------------------------------------------------------------------------
    def exists(self, path: str) -> bool:
        return os.path.exists(self._abs(path))

    def stat(self, path: str) -> Entry:
        try:
            st = os.stat(self._abs(path))
        except FileNotFoundError as e:
            raise NotFound(path) from e
        return Entry(path=path, size=st.st_size, mtime_ns=st.st_mtime_ns, is_dir=os.path.isdir(self._abs(path)))

    def age(self, path: str) -> float:
        """Sekunden seit dem letzten Schreiben (Uhr dieses Rechners bzw. des Dateiservers)."""
        try:
            return max(0.0, time.time() - os.stat(self._abs(path)).st_mtime)
        except FileNotFoundError as e:
            raise NotFound(path) from e

    def version(self, path: str) -> str:
        """Stand der Datei aus Änderungszeit (Nanosekunden) und Größe, ohne sie zu lesen."""
        try:
            st = os.stat(self._abs(path))
        except FileNotFoundError as e:
            raise NotFound(path) from e
        return f"{st.st_mtime_ns}-{st.st_size}"

    def walk(self, prefix: str) -> Iterator[Entry]:
        base = self._abs(prefix)
        if not os.path.isdir(base):
            return
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            rel_dir = os.path.relpath(dirpath, self.root).replace(os.sep, "/")
            yield Entry(path=rel_dir, size=0, mtime_ns=0, is_dir=True)
            for name in sorted(filenames):
                if name.startswith("."):
                    continue
                st = os.stat(os.path.join(dirpath, name))
                yield Entry(path=f"{rel_dir}/{name}", size=st.st_size, mtime_ns=st.st_mtime_ns)

    def read(self, path: str) -> tuple[bytes, str]:
        try:
            with open(self._abs(path), "rb") as fh:
                data = fh.read()
        except FileNotFoundError as e:
            raise NotFound(path) from e
        return data, etag_of(data)

    def open_read(self, path: str):
        try:
            return open(self._abs(path), "rb")
        except FileNotFoundError as e:
            raise NotFound(path) from e

    def local_path(self, path: str) -> str | None:
        return self._abs(path)

    # -- Schreiben --------------------------------------------------------------------------
    def write(self, path: str, data: bytes) -> str:
        self._atomic_write(self._abs(path), data)
        return etag_of(data)

    def create_exclusive(self, path: str, data: bytes) -> str:
        """Legt die Datei nur an, wenn es sie noch nicht gibt – und zwar gleich mit vollständigem Inhalt.
        Erst in eine temporäre Datei schreiben, dann per ``os.link`` an den Zielnamen hängen; ``link``
        schlägt fehl, wenn das Ziel existiert. So sieht kein anderer Prozess je eine halb geschriebene Datei."""
        p = self._abs(path)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(p))
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            try:
                os.link(tmp, p)
            except FileExistsError as e:
                raise AlreadyExists(path) from e
            except OSError:
                # Dateisysteme ohne harte Links: exklusiv anlegen, Inhalt unter der CAS-Sperre schreiben
                with self._cas_lock():
                    try:
                        fd2 = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
                    except FileExistsError as e:
                        raise AlreadyExists(path) from e
                    with os.fdopen(fd2, "wb") as fh:
                        fh.write(data)
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(tmp)
        return etag_of(data)

    def replace(self, path: str, data: bytes, if_match: str | None) -> str:
        p = self._abs(path)
        with self._cas_lock():
            if if_match is not None:
                try:
                    current = etag_of(open(p, "rb").read())
                except FileNotFoundError as e:
                    raise Conflict(f"{path} existiert nicht mehr") from e
                if current != if_match:
                    raise Conflict(f"{path} wurde zwischenzeitlich geändert")
            self._atomic_write(p, data)
        return etag_of(data)

    def delete(self, path: str, if_match: str | None = None) -> None:
        p = self._abs(path)
        with self._cas_lock():
            if if_match is not None:
                try:
                    if etag_of(open(p, "rb").read()) != if_match:
                        raise Conflict(f"{path} wurde zwischenzeitlich geändert")
                except FileNotFoundError as e:
                    raise NotFound(path) from e
            try:
                os.unlink(p)
            except FileNotFoundError as e:
                raise NotFound(path) from e

    def move(self, src: str, dst: str) -> None:
        """Verschiebt bytegetreu und überschreibt niemals ein vorhandenes Ziel."""
        s, d = self._abs(src), self._abs(dst)
        if not os.path.exists(s):
            raise NotFound(src)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        try:
            os.link(s, d)               # schlägt fehl, wenn das Ziel existiert
        except FileExistsError as e:
            raise AlreadyExists(dst) from e
        except OSError:
            # Dateisysteme ohne harte Links: nur verschieben, wenn das Ziel frei ist
            if os.path.exists(d):
                raise AlreadyExists(dst)
            shutil.move(s, d)
            return
        os.unlink(s)

    def copy(self, src: str, dst: str) -> None:
        s, d = self._abs(src), self._abs(dst)
        if os.path.exists(d):
            raise AlreadyExists(dst)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)

    def makedirs(self, path: str) -> None:
        os.makedirs(self._abs(path), exist_ok=True)
