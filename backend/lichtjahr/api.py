"""HTTP-Schnittstelle für den Editor im Browser.

Schreibende Aufrufe brauchen die Kopfzeile ``X-Lichtjahr-Session`` mit der Sitzung, die die
Bearbeitungssperre hält. Das Manifest wird mit ``If-Match: <Revision>`` gespeichert; passt die Revision
nicht, antwortet der Dienst mit 409 und dem aktuellen Stand, statt Änderungen zu überschreiben.
"""

from __future__ import annotations

import getpass
import mimetypes
import os
import secrets
import threading
from typing import Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import __version__
from . import faces as facedet
from .config import Credentials, Registry, Settings
from .i18n import _t, pick, set_lang
from .lock import Locked, LockLost, new_session
from .printing import STANDARDS, PrinterRegistry, PrintError, make_print_pdf, proof_colors, proof_image
from .project import Project, ProjectError, RevisionConflict
from .schema import EXPORT_DIR, Manifest
from .storage import LocalStorage, NotFound, StorageError
from .storage.webdav import ServerLocked, WebDavStorage


LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class StorageRequest(BaseModel):
    """Lokaler Ordner (``path``) oder WebDAV-Ordner (``url`` mit Benutzername und App-Passwort)."""
    path: str | None = None
    url: str | None = None
    username: str | None = None
    password: str | None = None


class CreateProject(StorageRequest):
    title: str | None = None
    language: str | None = None                       # Ordnernamen; Standard: Sprache der Anfrage
    calendarYear: int
    sourceYear: int | None = None
    format: dict[str, Any] | None = None


class OpenProject(StorageRequest):
    pass


class LockRequest(BaseModel):
    holder: str | None = None


class MoveRequest(BaseModel):
    month: int | None


class ProofColors(BaseModel):
    colors: dict[str, list[float]]
    paper: bool = True


class FacesRequest(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=500)


class SaveRequest(BaseModel):
    editor: dict[str, Any]
    calendarYear: int | None = None
    format: dict[str, Any] | None = None
    assets: dict[str, dict[str, Any]] | None = None   # Asset-ID → caption, favorite, rating, excluded
    printerProfileId: str | None = None


def create_app(settings: Settings | None = None, static_dir: str | None = None) -> FastAPI:
    settings = settings or Settings.default()
    registry = Registry(settings)
    credentials = Credentials(settings)
    printers = PrinterRegistry(settings.data_dir)
    app = FastAPI(title="Lichtjahr", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
    projects: dict[str, Project] = {}

    # -- Zugriffsschutz -------------------------------------------------------------------
    @app.middleware("http")
    async def require_token(request: Request, call_next):
        set_lang(pick(request.headers.get("accept-language")))
        # Ohne Schlüssel läuft der Dienst nur lokal. Fremde Hostnamen abweisen, damit keine Webseite
        # per DNS-Rebinding als „localhost“ auf die Fotos zugreifen kann.
        if not settings.token:
            host = request.headers.get("host", "").rsplit(":", 1)[0].strip("[]").lower()
            if host not in LOCAL_HOSTS:
                return JSONResponse({"detail": _t("Unbekannter Hostname. Bitte über http://localhost aufrufen.")}, status_code=403)
        if settings.token and request.url.path.startswith("/api/") and request.url.path != "/api/health":
            given = request.headers.get("authorization", "").removeprefix("Bearer ").strip() or request.query_params.get("token", "")
            if not secrets.compare_digest(given, settings.token):
                return JSONResponse({"detail": _t("Zugriffsschlüssel fehlt oder ist falsch.")}, status_code=401)
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

    @app.exception_handler(PrintError)
    async def _print(_, exc: PrintError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(ServerLocked)
    async def _locked(_, exc: ServerLocked):                 # vorübergehend: Klartext, 503 mit Retry-After
        return JSONResponse({"detail": str(exc)}, status_code=503, headers={"Retry-After": "10"})

    @app.exception_handler(StorageError)
    async def _serr(_, exc: StorageError):
        return JSONResponse({"detail": _t("Speicherfehler: {error}", error=exc)}, status_code=500)

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
            raise HTTPException(404, _t("Projekt unbekannt. Bitte über „Projekt öffnen“ hinzufügen."))
        p = Project.open(storage_of(entry["storage"]), cache_for(project_id))
        projects[project_id] = p
        return p

    def storage_of(entry: dict):
        kind = entry.get("kind")
        if kind == "local":
            return LocalStorage(entry["location"])
        if kind == "webdav":
            cred = credentials.get(entry["location"])
            return WebDavStorage(entry["location"], cred.get("username", ""), cred.get("password", ""))
        raise HTTPException(400, _t("Speicherart {kind} wird noch nicht unterstützt.", kind=kind))

    def storage_for(req: StorageRequest):
        """Speicher aus der Anfrage; bei WebDAV Verbindung prüfen und Zugangsdaten lokal ablegen."""
        if req.url:
            try:
                st = WebDavStorage(req.url, req.username or "", req.password or "")
                st.check()
            except StorageError as e:                 # falsche Adresse oder Anmeldung: Klartext statt „Speicherfehler“
                raise HTTPException(400, str(e)) from e
            if req.username:
                credentials.set(st.describe(), req.username, req.password or "")
            return st
        if not req.path:
            raise HTTPException(400, _t("Bitte einen Ordner oder eine WebDAV-Adresse angeben."))
        st = LocalStorage(req.path)
        os.makedirs(st.root, exist_ok=True)
        return st

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
    def create_project(req: CreateProject, request: Request):
        storage = storage_for(req)
        lang = req.language if req.language in ("de", "en") else pick(request.headers.get("accept-language"))
        p = Project.create(storage, "", title=req.title or (_t("Familienkalender")), calendar_year=req.calendarYear,
                           source_year=req.sourceYear or req.calendarYear - 1, format=req.format, language=lang)
        man, _ = p.load()
        p.cache_dir = cache_for(man.id)
        projects[man.id] = p
        return remember(p)

    @app.post("/api/projects/open")
    def open_project(req: OpenProject):
        p = Project.open(storage_for(req), "")
        man, _ = p.load()
        p.cache_dir = cache_for(man.id)
        projects[man.id] = p
        return remember(p)

    @app.get("/api/projects/{project_id}")
    def project_summary(project_id: str):
        return get_project(project_id).summary()

    @app.delete("/api/projects/{project_id}")
    def forget_project(project_id: str):
        """Entfernt das Projekt nur aus der Liste dieses Rechners; der Ordner bleibt unberührt.
        Zugangsdaten eines WebDAV-Ordners werden mit entfernt, wenn kein anderes Projekt sie braucht."""
        projects.pop(project_id, None)
        entry = registry.get(project_id)
        registry.forget(project_id)
        if entry and entry["storage"].get("kind") == "webdav":
            loc = entry["storage"]["location"]
            if not any(e["storage"].get("location") == loc for e in registry.all()):
                credentials.forget(loc)
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
            raise HTTPException(400, _t("Sitzung fehlt."))
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

    @app.post("/api/projects/{project_id}/save")
    def save_state(project_id: str, req: SaveRequest, session: str | None = Depends(session_header)):
        """Automatisches Speichern des Editors: Gestaltungsstand plus Bildtexte, Favoriten und
        aussortierte Fotos in einer Revision. Schutz vor zwei Schreibern bietet die Sperre."""
        saved = get_project(project_id).save_state(session, req.editor, calendar_year=req.calendarYear,
                                                   format=req.format, assets=req.assets, printer=req.printerProfileId)
        return {"revision": saved.revision, "updated": saved.updated}

    @app.post("/api/projects/{project_id}/export")
    async def save_export(project_id: str, file: UploadFile = File(...), session: str | None = Depends(session_header)):
        path = get_project(project_id).save_export(session, file.filename or "Kalender.pdf", await file.read())
        return {"path": path}

    @app.post("/api/projects/{project_id}/export/print")
    async def print_export(project_id: str, file: UploadFile = File(...), printer: str = Form(...),
                           title: str = Form(default="Kalender"), standard: str = Form(default="x1a"),
                           session: str | None = Depends(session_header)):
        """Druck-PDF: Fotos mit dem Farbprofil der Druckerei nach CMYK, PDF/X-1a oder PDF/X-4, Preflight; Ablage in Export/."""
        p = get_project(project_id)
        p.lock.check(session)
        profile = printers.get(printer)
        if standard not in STANDARDS:
            raise PrintError(_t("Unbekannter PDF/X-Standard."))
        data = await file.read()

        man, _ = p.load()

        def original(asset_id: str) -> bytes | None:          # für Fotos mit eigenem Farbraum (Display P3 …)
            a = man.asset(asset_id)
            return p.storage.read(a.path)[0] if a else None
        pdf, report = await run_in_threadpool(lambda: make_print_pdf(data, profile, title, standard=standard, original=original))
        path = p.save_export(session, file.filename or "Kalender-Druck.pdf", pdf)
        return {"path": path, "size": len(pdf), "report": report}

    @app.get("/api/projects/{project_id}/export/{name}")
    def get_export(project_id: str, name: str):
        p = get_project(project_id)
        safe = os.path.basename(name)
        local = p.storage.local_path(f"{EXPORT_DIR}/{safe}")
        if not safe.lower().endswith(".pdf") or not local or not os.path.exists(local):
            raise HTTPException(404, _t("Datei nicht gefunden."))
        return FileResponse(local, media_type="application/pdf", filename=safe)

    # -- Druckprofile ---------------------------------------------------------------------
    @app.get("/api/printers")
    def list_printers():
        return [p.public() for p in printers.all()]

    @app.post("/api/printers")
    async def add_printer(file: UploadFile = File(...), name: str | None = Form(default=None), tac: int | None = Form(default=None),
                          bleed: float | None = Form(default=None), intent: str | None = Form(default=None)):
        data = await file.read()
        if len(data) > 20_000_000:
            raise HTTPException(400, _t("Die Datei ist zu groß für ein ICC-Profil."))
        return printers.add(data, name, tac=tac, bleed=bleed, intent=intent).public()

    @app.post("/api/printers/{printer_id}/proof-colors")
    def printer_proof_colors(printer_id: str, req: ProofColors):
        """Vektorfarben (CMYK) so, wie sie gedruckt erscheinen, für die Druckansicht der Oberfläche."""
        return proof_colors(printers.get(printer_id), req.colors, req.paper)

    @app.delete("/api/printers/{printer_id}")
    def delete_printer(printer_id: str):
        printers.remove(printer_id)
        return {"ok": True}

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
            raise HTTPException(404, _t("Foto nicht gefunden."))
        return a

    @app.get("/api/projects/{project_id}/assets/{asset_id}/thumb")
    def thumb(project_id: str, asset_id: str, size: int = 360):
        p = get_project(project_id)
        a = asset_or_404(p, asset_id)
        try:
            path = p.thumbnail(a, size)
        except NotFound:
            raise HTTPException(404, _t("Die Datei fehlt im Projektordner."))
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable",
                                                                     "ETag": f'"{a.contentHash}_{size}"'})

    @app.post("/api/projects/{project_id}/faces")
    def faces(project_id: str, req: FacesRequest):
        """Gesichter (Position, nicht Person) für die angefragten Fotos. ``available`` ist falsch ohne OpenCV."""
        p = get_project(project_id)
        if not facedet.available():
            return {"available": False, "faces": {}}
        man, _ = p.load()
        out = {}
        for aid in dict.fromkeys(req.ids):
            a = man.asset(aid)
            if a and a.status != "missing":
                try:
                    out[aid] = p.faces(a)
                except Exception:                              # ein unlesbares Foto hält die anderen nicht auf
                    out[aid] = []
        return {"available": True, "faces": out}

    @app.get("/api/projects/{project_id}/assets/{asset_id}/proof")
    def proof(project_id: str, asset_id: str, printer: str, size: int = 1600, paper: bool = True, gamut: bool = False):
        """Softproof: Vorschaubild so, wie es mit dem Druckprofil gedruckt aussieht (zwischengespeichert)."""
        p = get_project(project_id)
        a = asset_or_404(p, asset_id)
        profile = printers.get(printer)
        size = max(64, min(2400, size))
        key = f"v2_{a.contentHash}_{size}_{profile.id}_{profile.intent}_{int(paper)}{int(gamut)}_{int(os.path.getmtime(profile.path))}"
        path = os.path.join(p.cache_dir, "proof", a.contentHash[:2], key + ".jpg")
        if not os.path.exists(path):
            try:
                src = p.thumbnail(a, size)
            except NotFound:
                raise HTTPException(404, _t("Die Datei fehlt im Projektordner."))
            with Image.open(src) as im:
                out = proof_image(im, profile, paper=paper, gamut=gamut)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
            out.save(tmp, "JPEG", quality=88)
            os.replace(tmp, path)
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})

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
            raise HTTPException(404, _t("Die Datei fehlt im Projektordner."))
        return Response(data, media_type=mimetypes.guess_type(a.path)[0] or "application/octet-stream")

    @app.post("/api/projects/{project_id}/assets")
    async def upload(project_id: str, file: UploadFile = File(...), month: str | None = Form(default=None),
                     session: str | None = Depends(session_header)):
        p = get_project(project_id)
        m = int(month) if month not in (None, "", "none") else None
        if m is not None and not 0 <= m <= 11:
            raise HTTPException(400, _t("Monat muss zwischen 0 (Januar) und 11 (Dezember) liegen."))
        a, duplicate = p.add_file(session, file.filename or "foto.jpg", await file.read(), m)
        return {**a.model_dump(), "duplicate": duplicate}

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

    @app.delete("/api/projects/{project_id}/draft")
    def delete_draft(project_id: str):
        path = os.path.join(settings.data_dir, "drafts", f"{project_id}.json")
        if os.path.exists(path):
            os.unlink(path)
        return {"ok": True}

    @app.get("/api/projects/{project_id}/draft")
    def get_draft(project_id: str):
        path = os.path.join(settings.data_dir, "drafts", f"{project_id}.json")
        if not os.path.exists(path):
            return Response(status_code=204)          # kein Entwurf – der Normalfall
        return FileResponse(path, media_type="application/json")

    # -- Oberfläche -----------------------------------------------------------------------
    if static_dir and os.path.isdir(static_dir):
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="app")

    return app
