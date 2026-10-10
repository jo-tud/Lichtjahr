# Lichtjahr – local service

**English** · [Deutsch](README.de.md)

The service works directly in a **project folder** on your computer. It reads the photos from month
folders, creates thumbnails, saves the design state and protects the project with an editing lock. The
app in the browser talks to it through an HTTP API.

The service also serves the app itself: start `lichtjahr serve`, open the address in your browser, done.

## Installation

Requirement: Python 3.11 or newer (usually already installed on Linux).

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
```

## Usage

```sh
# Start the service – reachable from this computer only
lichtjahr serve
# → Lichtjahr 0.1.0 running: http://localhost:8470/
```

The first time you open it, the app asks for the project folder: create a new one (the month folders are
created along with it) or open an existing one. Alternatively, on the command line:

```sh
lichtjahr init ~/Pictures/Calendar-2027 --year 2027   # create a project
lichtjahr serve ~/Pictures/Calendar-2027              # start the service and open this project right away
```

After that, just put photos into the month folders – bit by bit and with other programs, too. The app
syncs automatically when it opens and whenever you return to its window ("Sync folders" also works by
hand): new files are added, moved ones are recognized, missing ones are reported.

### What happens in the app

| In the app | In the project folder |
|---|---|
| Add photos (files, folders, drag and drop) | A copy in the matching month folder; adding the same photo again does not create a second file |
| Assign a photo to another month | The file moves to that month's folder (also on "Undo") |
| Copy for an additional month | A separate file in the second month folder |
| Remove a photo | Only set aside, the file stays where it is; you can bring it back at any time |
| Design, captions, favorites | `lichtjahr.json`, saved automatically |
| Create Print PDF | `Export/Family-Calendar-2027-Print.pdf` (PDF/X-1a, with check report) |
| Create Draft PDF | `Export/Family-Calendar-2027-Draft.pdf` |

### From your phone on the home network

```sh
lichtjahr serve --host 0.0.0.0
# → Lichtjahr 0.1.0 running: http://192.168.178.20:8470/?token=…
```

As soon as the service is reachable on the network, it requires an access key. The key is generated
automatically and included in the address shown (or you set it yourself with `--token`). The app keeps it
in memory only, not in browser storage. For access on the go, a VPN such as Tailscale works well; the
service deliberately does not set up anything like that itself.

Without a key, the service only answers on `localhost` or `127.0.0.1` and rejects other host names
(protection against DNS rebinding, where a foreign website poses as "localhost").

### Several windows and devices

Only one window can edit at a time; others show "View only" and take over automatically as soon as the
project is free. Closing a window releases the lock immediately; if a device is simply left lying around,
the lock expires after 2 minutes without a sign of life. If the lock is lost while you are working (the
computer was asleep and someone else has taken over in the meantime), the app saves the latest state on
this computer and offers it the next time you open the project.

## Project folder

```text
Calendar-2027/
├── lichtjahr.json          Manifest: photos, design state, revision (schema version 1)
├── Photos/
│   ├── 01 January/         one candidate folder per month – empty folders are valid
│   ├── …
│   ├── 12 December/
│   └── No month/
├── Export/                 finished PDFs
└── .lichtjahr/
    ├── lock.json           editing lock
    └── journal.jsonl       journal for file moves
```

Thumbnails are not stored in the project folder but in the cache (`~/.cache/lichtjahr`). The list of known
projects and rescued drafts live under `~/.local/share/lichtjahr`.

## Print PDF

`POST /api/projects/{id}/export/print` accepts the PDF from the app (photos as sRGB JPEG, everything else
CMYK) and a print profile (`lichtjahr/printing.py`):

1. Photos converted to CMYK with Pillow/LittleCMS using the ICC profile, as CMYK JPEG without the Adobe convention (all PDF viewers show it the same way)
2. PDF/X-1a:2001: PDF 1.3 without object streams, OutputIntent with embedded profile, `GTS_PDFXVersion`, `Trapped`, dates (pikepdf/qpdf)
3. Preflight on the finished file: PDF/X required entries, CMYK only, total ink coverage, bleed, fonts, transparency, image resolution
4. Saved to `Export/`, response with path and check report

Print profiles: bundled under `lichtjahr/icc/` (basICColor, zlib license); your own ICC files via
`POST /api/printers` (stored in the data folder under `printers/`). The profile must be a CMYK output
profile of ICC version 2; the printing condition (e.g. FOGRA51) is detected from the description or the
measurement data.

This is checked by Lichtjahr's own preflight, not by a certified tool such as Acrobat Preflight.

## Nextcloud and other WebDAV servers

`lichtjahr/storage/webdav.py` implements the same storage interface as the local folder. The two atomic
primitives the lock and the manifest rely on are evaluated **by the server**, so they hold across computers:

| Operation | WebDAV request |
|---|---|
| create exclusively | `PUT` with `If-None-Match: *` (412 if the file exists) |
| replace if unchanged | `PUT` with `If-Match: <ETag>` (412 if it changed) |
| move / copy, never overwrite | `MOVE` / `COPY` with `Overwrite: F` |
| list | `PROPFIND`, level by level (Nextcloud doesn't allow `Depth: infinity`) |

The server must issue a new ETag for every change and evaluate conditional requests; Nextcloud and ownCloud
do. Create or open a project with `url`, `username` and `password` instead of `path`
(`POST /api/projects`, `POST /api/projects/open`). The service checks the login and stores the credentials in
`credentials.json` in its data folder (mode 0600). They never appear in `lichtjahr.json`, `projects.json` or
any API response; forgetting a project removes them again. Plain `http://` is only accepted for addresses on
your own network. Thumbnails are cached locally, so every photo is downloaded once per change.

The tests run the complete project test suite against a WsgiDAV server as well (`tests/davserver.py`, with
content-based ETags and serialized requests, like Nextcloud), including a race of six clients for the lock.
They have not been run against a real Nextcloud instance yet.

## Principles

- **Originals stay untouched.** Photos are never modified or overwritten. Moving only changes the path; if
  the name is taken, you get `photo (2).jpg`.
- **Every photo belongs to exactly one month**, namely its folder. Changing the month moves the file; a copy
  for an additional month is only made explicitly and gets its own ID.
- **Stable IDs.** Photos keep their ID even when they are moved outside the app (recognized by their
  SHA-256 checksum).
- **No silent losses.** Missing or changed files are reported, and their use in the design is kept.
- **Journal.** Moving a file and updating the manifest are two steps. If something breaks in between, the
  service completes the operation the next time the lock is acquired, or marks it as aborted.
- **One person edits, others watch.** The lock has a limited lifetime (lease) and is renewed regularly. An
  expired lock can be taken over in a controlled way; the previous owner notices this on the next write and
  can no longer overwrite anything.
- **Stale writers are rejected.** Saving only works with a matching revision (`If-Match`); otherwise the
  service responds with 409 and the current state.

## API

The running service shows the complete description at `http://localhost:8470/api/docs`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Sign of life |
| GET / POST | `/api/projects` | Known projects / create a new project |
| POST | `/api/projects/open` | Open an existing project folder |
| GET | `/api/projects/{id}` | Overview (photos per month, lock, storage location) |
| GET / POST / DELETE | `/api/projects/{id}/lock` | View / acquire / release the lock |
| POST | `/api/projects/{id}/lock/heartbeat` | Extend the lock |
| GET / PUT | `/api/projects/{id}/manifest` | Read / save the manifest (`If-Match: <revision>`) |
| PATCH | `/api/projects/{id}/editor` | Save only the design state (`If-Match`) |
| POST | `/api/projects/{id}/save` | The app's autosave: design plus captions, favorites and set-aside photos in one revision |
| POST | `/api/projects/{id}/export` | Store a PDF in `Export/` |
| POST | `/api/projects/{id}/scan` | Sync the photo folders |
| GET / POST | `/api/projects/{id}/assets` | List / upload photos (`month` 0–11; response includes `duplicate`) |
| GET | `/api/projects/{id}/assets/{aid}/thumb?size=360` | Thumbnail |
| GET | `/api/projects/{id}/assets/{aid}/original` | Original file |
| POST | `/api/projects/{id}/assets/{aid}/move` / `copy` | Change month / copy explicitly |
| POST | `/api/projects/{id}/export/print` | Print PDF (PDF/X-1a) with color profile and check report |
| GET | `/api/projects/{id}/export/{name}` | Download a PDF from `Export/` |
| GET / POST / DELETE | `/api/printers` | List print profiles / add your own ICC profile / remove one |
| GET / PUT / DELETE | `/api/projects/{id}/draft` | Rescue a draft on this computer (204 if there is none) |

Writing calls need the `X-Lichtjahr-Session` header with the session from acquiring the lock.

## Tests

```sh
pip install -e ".[dev]"
pytest
```

Among other things, the tests cover:
- simultaneous lock acquisition and simultaneous takeover of an expired lock by several processes (exactly one wins)
- stale writers
- photos moved, changed and deleted outside the app
- a simulated crash in the middle of a move
- byte-exact moving without overwriting
- the EXIF orientation of thumbnails
- duplicates on upload, setting photos aside, saving only permitted fields, export, host name check
- Print PDF: color conversion, PDF/X-1a properties, preflight findings, custom print profiles

## Outlook

- PDF/X-4 and soft proofing.
