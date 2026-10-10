"""Kleiner WebDAV-Server für die Tests (WsgiDAV), mit zwei Anpassungen, die Nextcloud ebenso bietet:

* ETags ändern sich mit jedem neuen Inhalt (WsgiDAV leitet sie sonst aus Größe und Sekunde ab), und
* Anfragen werden nacheinander bearbeitet, sodass bedingte Anfragen atomar sind.
"""

from __future__ import annotations

import hashlib
import socket
import threading

from cheroot import wsgi
from wsgidav.fs_dav_provider import FileResource, FilesystemProvider
from wsgidav.wsgidav_app import WsgiDAVApp

USER, PASSWORD = "anna", "app-passwort"


class _HashFile(FileResource):
    def get_etag(self):
        with open(self._file_path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()[:24]


class _Provider(FilesystemProvider):
    def get_resource_inst(self, path, environ):
        res = super().get_resource_inst(path, environ)
        if type(res) is FileResource:
            res.__class__ = _HashFile
        return res


class DavServer:
    def __init__(self, root: str) -> None:
        self.root = root
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        app = WsgiDAVApp({
            "host": "127.0.0.1", "port": self.port, "provider_mapping": {"/remote.php/dav/files/anna": _Provider(root)},
            "http_authenticator": {"domain_controller": None, "accept_basic": True, "accept_digest": False, "default_to_digest": False},
            "simple_dc": {"user_mapping": {"*": {USER: {"password": PASSWORD}}}},
            "verbose": 0, "logging": {"enable": False}, "lock_storage": True,
        })
        gate = threading.Lock()

        def serial(environ, start_response):
            with gate:
                return list(app(environ, start_response))

        self.server = wsgi.Server(("127.0.0.1", self.port), serial, numthreads=8)
        self.server.prepare()
        threading.Thread(target=self.server.serve, daemon=True).start()

    def url(self, folder: str = "") -> str:
        return f"http://127.0.0.1:{self.port}/remote.php/dav/files/anna/{folder}"

    def stop(self) -> None:
        self.server.stop()
