"""HTTP-Schnittstelle für den Editor im Browser.

Schreibende Aufrufe brauchen die Kopfzeile ``X-Lichtjahr-Session`` mit der Sitzung, die die
Bearbeitungssperre hält. Das Manifest wird mit ``If-Match: <Revision>`` gespeichert; passt die Revision
nicht, antwortet der Dienst mit 409 und dem aktuellen Stand, statt Änderungen zu überschreiben.
"""

from __future__ import annotations

import getpass
import os
import secrets
from typing import Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .config import Registry, Settings
from .lock import Locked, LockLost, new_session
from .project import Project, ProjectError, RevisionConflict
from .schema import Manifest
from .storage import LocalStorage, NotFound, StorageError


class CreateProject(BaseModel):
    path: str
    title: str = "Familienkalender"
    calendarYear: int
    sourceYear: int | None = None
    format: dict[str, Any] | None = None


class OpenProject(BaseModel):
    path: str


class LockRequest(BaseModel):
    holder: str | None = None


class MoveRequest(BaseModel):
    month: int | None


def create_app(settings: Settings | None = None, static_dir: str | None = None) -> FastAPI:
    settings = settings or Settings.default()
    registry = Registry(settings)
    app = FastAPI(title="Lichtjahr", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
    projects: dict[str, Project] = {}

    # -- Zugriffsschutz -------------------------------------------------------------------
    @app.middleware("http")
    async def require_token(request: Request, call_next):
        if settings.token and request.url.path.startswith("/api/") and request.url.path != "/api/health":
            given = request.headers.get("authorization", "").removeprefix("Bearer ").strip() or request.query_params.get("token", "")
            if not secrets.compare_digest(given, settings.token):
                return JSONResponse({"detail": "Zugriffsschlüssel fehlt oder ist falsch."}, status_code=401)
        return await call_next(request)

    @app.exception_handler(Locked)
    async def _locked(_, exc: Locked):
        return JSONResponse({"detail": str(exc), "lock": exc.info.public()}, status_code=423)

    @app.exception_handler(LockLost)
    async def _lost(_, exc: LockLost):
        return JSONResponse({"detail": str(exc)}, status_code=423)

    @app.exception_handler(RevisionConflict)
    async def _conflict(_, exc: RevisionConflict):
        return JSONResponse({"detail": str(exc), "revision": exc.current}, status_code=409)

    @app.exception_handler(ProjectError)
    async def _perr(_, exc: ProjectError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(StorageError)
    async def _serr(_, exc: StorageError):
        return JSONResponse({"detail": f"Speicherfehler: {exc}"}, status_code=500)

    # -- Hilfen ---------------------------------------------------------------------------
    def cache_for(project_id: str) -> str:
        return os.path.join(settings.cache_dir, project_id)

    def remember(p: Project) -> dict:
        s = p.summary()
        registry.remember({"id": s["id"], "title": s["title"], "calendarYear": s["calendarYear"], "storage": s["storage"]})
        return s

    def get_project(project_id: str) -> Project:
        if project_id in projects:
            return projects[project_id]
        entry = registry.get(project_id)
        if not entry:
            raise HTTPException(404, "Projekt unbekannt. Bitte über „Projekt öffnen“ hinzufügen.")
        storage = entry["storage"]
        if storage.get("kind") != "local":
            raise HTTPException(400, f"Speicherart {storage.get('kind')} wird noch nicht unterstützt.")
        p = Project.open(LocalStorage(storage["location"]), cache_for(project_id))
        projects[project_id] = p
        return p

    def session_header(x_lichtjahr_session: str | None = Header(default=None)) -> str | None:
        return x_lichtjahr_session

    # -- Allgemein ------------------------------------------------------------------------
    @app.get("/api/health")
    def health():
        return {"ok": True, "version": __version__}

    @app.get("/api/projects")
    def list_projects():
        return registry.all()

    @app.post("/api/projects")
    def create_project(req: CreateProject):
        storage = LocalStorage(req.path)
        os.makedirs(storage.root, exist_ok=True)
        p = Project.create(storage, "", title=req.title, calendar_year=req.calendarYear,
                           source_year=req.sourceYear or req.calendarYear - 1, format=req.format)
        man, _ = p.load()
        p.cache_dir = cache_for(man.id)
        projects[man.id] = p
        return remember(p)

    @app.post("/api/projects/open")
    def open_project(req: OpenProject):
        storage = LocalStorage(req.path)
        p = Project.open(storage, "")
        man, _ = p.load()
        p.cache_dir = cache_for(man.id)
        projects[man.id] = p
        return remember(p)

    @app.get("/api/projects/{project_id}")
    def project_summary(project_id: str):
        return get_project(project_id).summary()

    @app.delete("/api/projects/{project_id}")
    def forget_project(project_id: str):
        """Entfernt das Projekt nur aus der Liste dieses Rechners; der Ordner bleibt unberührt."""
        projects.pop(project_id, None)
        registry.forget(project_id)
        return {"ok": True}

    # -- Sperre ---------------------------------------------------------------------------
    @app.get("/api/projects/{project_id}/lock")
    def lock_status(project_id: str):
        info, _ = get_project(project_id).lock.read()
        return {"lock": info.public() if info else None}

    @app.post("/api/projects/{project_id}/lock")
    def acquire_lock(project_id: str, req: LockRequest, session: str | None = Depends(session_header)):
        p = get_project(project_id)
        sid = session or new_session()
        info = p.lock.acquire(sid, req.holder or getpass.getuser())
        notes = p.recover(sid)              # unterbrochene Verschiebungen jetzt, unter Sperre, aufräumen
        return {"session": sid, "lock": info.public(), "recovered": notes}

    @app.post("/api/projects/{project_id}/lock/heartbeat")
    def heartbeat(project_id: str, session: str | None = Depends(session_header)):
        if not session:
            raise HTTPException(400, "Sitzung fehlt.")
        return {"lock": get_project(project_id).lock.heartbeat(session).public()}

    @app.delete("/api/projects/{project_id}/lock")
    def release_lock(project_id: str, session: str | None = Depends(session_header)):
        if session:
            get_project(project_id).lock.release(session)
        return {"ok": True}

    # -- Manifest -------------------------------------------------------------------------
    @app.get("/api/projects/{project_id}/manifest")
    def get_manifest(project_id: str):
        man, _ = get_project(project_id).load()
        return man.model_dump()

    @app.put("/api/projects/{project_id}/manifest")
    def put_manifest(project_id: str, body: dict[str, Any], session: str | None = Depends(session_header),
                     if_match: str | None = Header(default=None)):
        p = get_project(project_id)
        expected = int(if_match.strip('"')) if if_match else None
        current, _ = p.load()
        man = Manifest.model_validate({**body, "id": current.id, "assets": body.get("assets", [a.model_dump() for a in current.assets])})
        saved = p.save(man, session=session, expected_revision=expected)
        return {"revision": saved.revision, "updated": saved.updated}

    @app.patch("/api/projects/{project_id}/editor")
    def put_editor(project_id: str, body: dict[str, Any], session: str | None = Depends(session_header),
                   if_match: str | None = Header(default=None)):
        """Nur den Gestaltungsstand speichern (häufigster Fall beim automatischen Speichern)."""
        p = get_project(project_id)
        man, etag = p.load()
        if if_match and int(if_match.strip('"')) != man.revision:
            raise RevisionConflict(man.revision)
        man.editor = body
        saved = p.save(man, session=session, expected_revision=man.revision, etag=etag)
        return {"revision": saved.revision, "updated": saved.updated}

    # -- Fotos ----------------------------------------------------------------------------
    @app.post("/api/projects/{project_id}/scan")
    def scan(project_id: str, session: str | None = Depends(session_header)):
        return get_project(project_id).scan(session).as_dict()

    @app.get("/api/projects/{project_id}/assets")
    def assets(project_id: str):
        man, _ = get_project(project_id).load()
        return [a.model_dump() for a in man.assets]

    def asset_or_404(p: Project, asset_id: str):
        man, _ = p.load()
        a = man.asset(asset_id)
        if not a:
            raise HTTPException(404, "Foto nicht gefunden.")
        return a

    @app.get("/api/projects/{project_id}/assets/{asset_id}/thumb")
    def thumb(project_id: str, asset_id: str, size: int = 360):
        p = get_project(project_id)
        a = asset_or_404(p, asset_id)
        try:
            path = p.thumbnail(a, size)
        except NotFound:
            raise HTTPException(404, "Die Datei fehlt im Projektordner.")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable",
                                                                     "ETag": f'"{a.contentHash}_{size}"'})

    @app.get("/api/projects/{project_id}/assets/{asset_id}/original")
    def original(project_id: str, asset_id: str):
        p = get_project(project_id)
        a = asset_or_404(p, asset_id)
        local = p.storage.local_path(a.path)
        if local and os.path.exists(local):
            return FileResponse(local)
        try:
            data, _ = p.storage.read(a.path)
        except NotFound:
            raise HTTPException(404, "Die Datei fehlt im Projektordner.")
        return Response(data)

    @app.post("/api/projects/{project_id}/assets")
    async def upload(project_id: str, file: UploadFile = File(...), month: str | None = Form(default=None),
                     session: str | None = Depends(session_header)):
        p = get_project(project_id)
        m = int(month) if month not in (None, "", "none") else None
        if m is not None and not 0 <= m <= 11:
            raise HTTPException(400, "Monat muss zwischen 0 (Januar) und 11 (Dezember) liegen.")
        a = p.add_file(session, file.filename or "foto.jpg", await file.read(), m)
        return a.model_dump()

    @app.post("/api/projects/{project_id}/assets/{asset_id}/move")
    def move(project_id: str, asset_id: str, req: MoveRequest, session: str | None = Depends(session_header)):
        return get_project(project_id).move_to_month(session, asset_id, req.month).model_dump()

    @app.post("/api/projects/{project_id}/assets/{asset_id}/copy")
    def copy(project_id: str, asset_id: str, req: MoveRequest, session: str | None = Depends(session_header)):
        return get_project(project_id).copy_to_month(session, asset_id, req.month).model_dump()

    # -- Entwurfsrettung ------------------------------------------------------------------
    @app.put("/api/projects/{project_id}/draft")
    def save_draft(project_id: str, body: dict[str, Any]):
        """Rettet den Stand des Editors lokal, wenn das Speichern im Projekt gerade nicht möglich ist
        (Sperre verloren, Verbindung weg). Liegt nur auf diesem Rechner."""
        path = os.path.join(settings.data_dir, "drafts", f"{project_id}.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        import json as _json
        with open(path + ".tmp", "w", encoding="utf-8") as fh:
            _json.dump(body, fh, ensure_ascii=False)
        os.replace(path + ".tmp", path)
        return {"ok": True}

    @app.get("/api/projects/{project_id}/draft")
    def get_draft(project_id: str):
        path = os.path.join(settings.data_dir, "drafts", f"{project_id}.json")
        if not os.path.exists(path):
            raise HTTPException(404, "Kein Entwurf vorhanden.")
        return FileResponse(path, media_type="application/json")

    # -- Oberfläche -----------------------------------------------------------------------
    if static_dir and os.path.isdir(static_dir):
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="app")

    return app
