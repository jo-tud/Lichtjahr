"""Projektordner auf einem WebDAV-Server, z. B. Nextcloud.

Dieselben atomaren Grundoperationen wie der lokale Ordner, aber auf dem Server ausgewertet, damit die
Bearbeitungssperre auch zwischen verschiedenen Rechnern hält:

* ``create_exclusive``: ``PUT`` mit ``If-None-Match: *`` (412, wenn es die Datei schon gibt)
* ``replace``: ``PUT`` mit ``If-Match: <ETag>`` (412, wenn sie sich inzwischen geändert hat)
* ``delete`` mit ``If-Match``, ``move``/``copy`` mit ``Overwrite: F`` (nie überschreiben)

Voraussetzung ist ein Server, der bei jeder Änderung ein neues ETag vergibt und bedingte Anfragen
auswertet. Nextcloud und ownCloud tun das; Nextcloud schreibt hochgeladene Dateien zudem erst als
Teildatei und benennt sie danach um, sodass niemand halbe Dateien liest.

Zugangsdaten bekommt der Adapter von außen (siehe ``config.Credentials``); sie landen nie im Manifest.
"""

from __future__ import annotations

import email.utils
import ipaddress
import posixpath
import re
import tempfile
import xml.etree.ElementTree as ET
from typing import Iterator
from urllib.parse import quote, unquote, urlsplit

import httpx

from ..i18n import _t
from .base import AlreadyExists, Conflict, Entry, NotFound, StorageError

DAV = "{DAV:}"


def _is_private(host: str) -> bool:
    if host in ("localhost",) or host.endswith((".local", ".lan", ".home.arpa")):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False
PROPFIND_BODY = (b'<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop>'
                 b"<d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>")


class WebDavStorage:
    kind = "webdav"

    def __init__(self, url: str, username: str = "", password: str = "", *, timeout: float = 60.0,
                 transport: httpx.BaseTransport | None = None) -> None:
        url = url.strip()
        if not url.lower().startswith(("https://", "http://")):
            raise StorageError(_t("Die WebDAV-Adresse muss mit https:// beginnen."))
        if url.lower().startswith("http://") and not _is_private(urlsplit(url).hostname or ""):
            # Ohne Verschlüsselung gingen Benutzername und Passwort lesbar durchs Internet
            raise StorageError(_t("Bitte eine https://-Adresse verwenden; http:// geht nur im eigenen Netz."))
        self.url = url.rstrip("/") + "/"
        self._base_path = urlsplit(self.url).path
        self.client = httpx.Client(auth=(username, password) if username else None, timeout=timeout,
                                   follow_redirects=False, transport=transport,
                                   headers={"User-Agent": "Lichtjahr", "OCS-APIRequest": "true"})

    # -- Hilfen -----------------------------------------------------------------------------
    def describe(self) -> str:
        return self.url

    def display(self) -> str:
        """Kurz für die Anzeige, z. B. „cloud.example.org · Kalender-2027“ (Nextcloud-Pfad ohne Technik)."""
        parts = urlsplit(self.url)
        path = unquote(parts.path).strip("/")
        m = re.search(r"remote\.php/(?:dav/files/[^/]+|webdav)/?(.*)$", path)
        return f"{parts.hostname} · {(m.group(1) if m else path) or '/'}"

    def local_path(self, path: str) -> str | None:
        return None

    def _href(self, path: str) -> str:
        parts = [p for p in path.split("/") if p]
        if any(p in (".", "..") for p in parts):
            raise StorageError(_t("Pfad außerhalb des Projektordners: {path}", path=path))
        return self.url + "/".join(quote(p) for p in parts)

    def _rel(self, href: str) -> str:
        """Server-Antwort (absoluter Pfad oder URL) → Pfad relativ zum Projektordner."""
        p = unquote(urlsplit(href).path)
        base = unquote(self._base_path)
        if not p.startswith(base):
            return ""
        return p[len(base):].strip("/")

    def _request(self, method: str, path: str, **kw) -> httpx.Response:
        try:
            r = self.client.request(method, self._href(path), **kw)
        except httpx.HTTPError as e:
            raise StorageError(_t("Der WebDAV-Server ist nicht erreichbar: {error}", error=e)) from e
        if r.status_code in (401, 403):
            raise StorageError(_t("Anmeldung am WebDAV-Server abgelehnt. Benutzername und App-Passwort prüfen."))
        return r

    @staticmethod
    def _etag(r: httpx.Response) -> str | None:
        return r.headers.get("oc-etag") or r.headers.get("etag")

    def _propfind(self, path: str, depth: str) -> list[tuple[str, Entry, str | None]]:
        r = self._request("PROPFIND", path, headers={"Depth": depth, "Content-Type": "application/xml"}, content=PROPFIND_BODY)
        if r.status_code == 404:
            raise NotFound(path)
        if r.status_code != 207:
            raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=path))
        out = []
        for resp in ET.fromstring(r.content).iter(f"{DAV}response"):
            href = resp.findtext(f"{DAV}href") or ""
            props = {}
            for ps in resp.iter(f"{DAV}propstat"):
                prop = ps.find(f"{DAV}prop")
                if prop is not None and "200" in (ps.findtext(f"{DAV}status") or ""):
                    props.update({el.tag: el for el in prop})
            is_dir = props.get(f"{DAV}resourcetype") is not None and props[f"{DAV}resourcetype"].find(f"{DAV}collection") is not None
            size = int((props.get(f"{DAV}getcontentlength").text or 0) if f"{DAV}getcontentlength" in props else 0)
            mtime = 0
            lm = props.get(f"{DAV}getlastmodified")
            if lm is not None and lm.text:
                try:
                    mtime = int(email.utils.parsedate_to_datetime(lm.text).timestamp() * 1e9)
                except (TypeError, ValueError):
                    mtime = 0
            etag_el = props.get(f"{DAV}getetag")
            rel = self._rel(href)
            out.append((rel, Entry(path=rel, size=size, mtime_ns=mtime, is_dir=is_dir), etag_el.text if etag_el is not None else None))
        return out

    # -- Lesen ------------------------------------------------------------------------------
    def exists(self, path: str) -> bool:
        try:
            self._propfind(path, "0")
            return True
        except NotFound:
            return False

    def stat(self, path: str) -> Entry:
        items = self._propfind(path, "0")
        if not items:
            raise NotFound(path)
        e = items[0][1]
        return Entry(path=path, size=e.size, mtime_ns=e.mtime_ns, is_dir=e.is_dir)

    def walk(self, prefix: str) -> Iterator[Entry]:
        """Alle Einträge unterhalb von ``prefix``; Ebene für Ebene (Nextcloud erlaubt kein ``Depth: infinity``)."""
        todo = [prefix.strip("/")]
        while todo:
            folder = todo.pop()
            try:
                items = self._propfind(folder, "1")
            except NotFound:
                continue
            for rel, entry, _ in items:
                if rel == folder or not rel:
                    continue
                yield entry
                if entry.is_dir:
                    todo.append(rel)

    def read(self, path: str) -> tuple[bytes, str]:
        r = self._request("GET", path)
        if r.status_code == 404:
            raise NotFound(path)
        if r.status_code != 200:
            raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=path))
        etag = self._etag(r)
        if not etag:                      # manche Server liefern das ETag nur per PROPFIND
            etag = self._propfind(path, "0")[0][2] or ""
        return r.content, etag

    def open_read(self, path: str):
        """Datei als lesbares Objekt; große Fotos landen in einer temporären Datei statt im Speicher."""
        tmp = tempfile.SpooledTemporaryFile(max_size=8 << 20)
        try:
            with self.client.stream("GET", self._href(path)) as r:
                if r.status_code == 404:
                    raise NotFound(path)
                if r.status_code in (401, 403):
                    raise StorageError(_t("Anmeldung am WebDAV-Server abgelehnt. Benutzername und App-Passwort prüfen."))
                if r.status_code != 200:
                    raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=path))
                for chunk in r.iter_bytes(1 << 20):
                    tmp.write(chunk)
        except httpx.HTTPError as e:
            tmp.close()
            raise StorageError(_t("Der WebDAV-Server ist nicht erreichbar: {error}", error=e)) from e
        tmp.seek(0)
        return tmp

    # -- Schreiben --------------------------------------------------------------------------
    def _put(self, path: str, data: bytes, headers: dict) -> httpx.Response:
        h = {"Content-Type": "application/octet-stream", **headers}
        r = self._request("PUT", path, content=data, headers=h)
        if r.status_code == 409:                      # Elternordner fehlt: anlegen und noch einmal
            self.makedirs(posixpath.dirname(path))
            r = self._request("PUT", path, content=data, headers=h)
        return r

    def _etag_after(self, r: httpx.Response, path: str) -> str:
        return self._etag(r) or self._propfind(path, "0")[0][2] or ""

    def write(self, path: str, data: bytes) -> str:
        r = self._put(path, data, {})
        if r.status_code not in (200, 201, 204):
            raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=path))
        return self._etag_after(r, path)

    def create_exclusive(self, path: str, data: bytes) -> str:
        r = self._put(path, data, {"If-None-Match": "*"})
        if r.status_code == 412:
            raise AlreadyExists(path)
        if r.status_code not in (200, 201, 204):
            raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=path))
        return self._etag_after(r, path)

    def replace(self, path: str, data: bytes, if_match: str | None) -> str:
        r = self._put(path, data, {"If-Match": if_match} if if_match is not None else {})
        if r.status_code == 412:
            raise Conflict(path)
        if r.status_code == 404 and if_match is not None:
            raise Conflict(path)
        if r.status_code not in (200, 201, 204):
            raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=path))
        return self._etag_after(r, path)

    def delete(self, path: str, if_match: str | None = None) -> None:
        r = self._request("DELETE", path, headers={"If-Match": if_match} if if_match else {})
        if r.status_code == 404:
            raise NotFound(path)
        if r.status_code == 412:
            raise Conflict(path)
        if r.status_code not in (200, 204):
            raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=path))

    def _transfer(self, method: str, src: str, dst: str) -> None:
        headers = {"Destination": self._href(dst), "Overwrite": "F"}
        r = self._request(method, src, headers=headers)
        if r.status_code == 409:                      # Zielordner fehlt
            self.makedirs(posixpath.dirname(dst))
            r = self._request(method, src, headers=headers)
        if r.status_code == 404:
            raise NotFound(src)
        if r.status_code == 412:
            raise AlreadyExists(dst)
        if r.status_code not in (201, 204):
            raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=src))

    def move(self, src: str, dst: str) -> None:
        self._transfer("MOVE", src, dst)

    def copy(self, src: str, dst: str) -> None:
        self._transfer("COPY", src, dst)

    def makedirs(self, path: str) -> None:
        parts = [p for p in path.split("/") if p]
        for i in range(1, len(parts) + 1):
            sub = "/".join(parts[:i])
            r = self._request("MKCOL", sub)
            if r.status_code in (201, 405):           # 405: gibt es schon
                continue
            if r.status_code == 409:                  # Elternordner fehlt (sollte durch die Schleife nicht vorkommen)
                raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=sub))
            if r.status_code not in (200, 204):
                raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=r.status_code, path=sub))

    def check(self) -> None:
        """Verbindung und Anmeldung prüfen; legt den Projektordner an, falls er fehlt."""
        r = self.client.request("PROPFIND", self.url, headers={"Depth": "0", "Content-Type": "application/xml"}, content=PROPFIND_BODY)
        if r.status_code in (401, 403):
            raise StorageError(_t("Anmeldung am WebDAV-Server abgelehnt. Benutzername und App-Passwort prüfen."))
        if r.status_code == 404:
            parent = self.url.rstrip("/").rsplit("/", 1)[0] + "/"
            rp = self.client.request("PROPFIND", parent, headers={"Depth": "0"}, content=PROPFIND_BODY)
            if rp.status_code != 207:
                raise StorageError(_t("Unter dieser Adresse gibt es keinen WebDAV-Ordner ({status}).", status=rp.status_code))
            mk = self.client.request("MKCOL", self.url)
            if mk.status_code not in (201, 405):
                raise StorageError(_t("WebDAV-Fehler {status} bei {path}", status=mk.status_code, path=self.url))
        elif r.status_code != 207:
            raise StorageError(_t("Unter dieser Adresse gibt es keinen WebDAV-Ordner ({status}).", status=r.status_code))
