# Lichtjahr – local service

**English** · [Deutsch](README.de.md)

The service works directly in a **project folder** on your computer. It reads the photos from month
folders, creates thumbnails, saves the design state and protects the project with an editing lock. The
app in the browser talks to it through an HTTP API.

The service also serves the app itself: start `lichtjahr serve` and the app opens in your browser.

## Installation

Without a terminal: download the ZIP from the [latest release](https://github.com/jo-tud/Lichtjahr/releases/latest)
and double-click the start script (see the [main README](../README.md#quick-start)). The scripts use
[uv](https://docs.astral.sh/uv/), which also provides Python, and run the packaged service including the app
and HEIC support.

For development, with Python 3.11 or newer (usually already installed on Linux):

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
pip install -e ".[heic]"     # optional: HEIC/HEIF photos from the iPhone (pillow-heif, brings libheif under LGPL)
```

## Usage

```sh
# Start the service – reachable from this computer only
lichtjahr serve
# → Lichtjahr 1.2.1 running: http://localhost:8470/   (opens the browser; --no-browser to skip)
```

Starting it a second time only opens the browser again, with the access key and the named project if
there is one; if an older version is still running, it asks you to quit that one first. If port 8470 is taken
by another program, the service picks the next free port and says so. The running service notes its address
in `running.json` in the data folder (readable only by you, removed on exit).

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
| Create Print PDF | `Export/Family-Calendar-2027-Print.pdf` (PDF/X-1a or PDF/X-4, with check report) |
| Create Draft PDF | `Export/Family-Calendar-2027-Draft.pdf` |

### From your phone on the home network

```sh
lichtjahr serve --host 0.0.0.0
# → Lichtjahr 1.2.1 running: http://192.168.178.20:8470/?token=…
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

Thumbnails are not stored in the project folder but in a cache; the list of known projects, rescued drafts and
the face recognition model live in a data folder on this computer (`--data-dir` and `--cache-dir` change them):

| System  | Data                                   | Cache                              |
|---------|----------------------------------------|------------------------------------|
| Linux   | `~/.local/share/lichtjahr`             | `~/.cache/lichtjahr`               |
| macOS   | `~/Library/Application Support/Lichtjahr` | `~/Library/Caches/Lichtjahr`    |
| Windows | `%LOCALAPPDATA%\Lichtjahr`             | `%LOCALAPPDATA%\Lichtjahr\Cache`   |

If `~/.local/share/lichtjahr` already exists (earlier versions used it everywhere), it keeps being used.

## Print PDF

`POST /api/projects/{id}/export/print` accepts the PDF from the app (photos as sRGB JPEG, everything else
CMYK) and a print profile (`lichtjahr/printing.py`):

1. Photos converted to CMYK with Pillow/LittleCMS using the ICC profile, as CMYK JPEG without the Adobe convention (all PDF viewers show it the same way)
2. Form field `standard`: `x1a` (default) for PDF/X-1a:2001 – PDF 1.3 without object streams, OutputIntent with embedded profile, `GTS_PDFXVersion`, `Trapped`, dates (pikepdf/qpdf) – or `x4` for PDF/X-4: PDF 1.6 with the same entries plus XMP metadata (`pdfxid:GTS_PDFXVersion`, document and instance ID, version, rendition class)
3. Preflight on the finished file: PDF/X required entries (for X-4 including XMP), PDF and ICC version, CMYK only, total ink coverage, bleed, fonts, transparency, image resolution
4. Saved to `Export/`, response with path and check report

**Photo recipes and print adaptation:** The app compiles each photo's adjustments into a 3×3 color matrix and a tone curve; the preview applies them as an SVG filter, the app applies them to the pixels it sends, and the service (numpy) applies the same numbers to photos rendered from the original and in the soft proof. With the form field `tune=true`, the print adaptation curve is folded in and the service sharpens on luminance (`UnsharpMask`, strength from the profile).

**Backlight and noise** (`lichtjahr/detail.py`, needs OpenCV): both act locally, so they run in the service, before the recipe. Backlight: five synthetic exposures (−1 to +3 stops) of the photo are blended by exposure fusion (Mertens, with the pyramid stopping at about 32 pixels so the effect stays local), always on a 1600-pixel version; the result is a brightness map that is transferred edge-aware (guided filter) to any size, so preview and print match. It mostly brightens: darkening is limited and near-white areas are left alone, so a bright sky does not turn gray. Noise: strength from the measured noise (Immerkær, also per brightness level), color noise reduced firmly at half size, luminance gently (non-local means). Where the brightness map lifts the photo afterwards, noise becomes visible by the same factor; the strength therefore varies per pixel (two non-local-means results of different strength, blended by the wanted strength), so lifted shadows get cleaned harder while the rest keeps its detail. **Texture** (`t`, −1 … +1): fine detail (what a guided filter with radius ≈ 1/600 of the long edge and small ε removes) is scaled at full resolution; soft coring at 3× the measured noise (scaled by the local lift) keeps noise from being amplified, strong edges stay in the base layer so there are no halos, faces get half when strengthening. **Print sharpening** (`detail.sharpen`, used for the Print PDF with *Adapt photos to paper and print* and the loupe): unsharp mask on luminance only, soft coring at 3× the measured noise, overshoot limited to the 3×3 neighbourhood range plus 15 %. **Local highlights, shadows, clarity:** with the service the app sends these as part of `fx` (`h`, `s`, `c`, −1 … +1) instead of folding them into the tone curve. Highlights and shadows act on an edge-aware base layer (guided filter on luminance in stops), i.e. by lighting, so surfaces such as dark skin keep their brightness; near-white stays white. Clarity uses the fast local Laplacian filter (Paris et al. 2011, Aubry et al. 2014) on the mid bands only (about 1/200 to 1/20 of the long edge), so fine texture and noise stay and large edges get no halos. Everything local, fusion included, ends up in one brightness map on 1600 px that is transferred to the target size; lifted values get a soft shoulder instead of clipping. Face guard: a face is never lifted more than the median lift of what is lifted around it (hair, neck, clothing), and backlight is detected from pixels outside the faces plus each face's lighting ratio (brightest 5 % over median in linear light, independent of skin tone). The setting travels as `fx=f0.40n0.30h-0.20s0.35c0.25t0.30` on thumbnails, soft proof and the original, and as `/FX` in the `/LJSource` entry of the Print PDF. `POST /quality` measures noise and backlight per photo and suggests a strength; it is cached per checksum.

**Wide color:** For each photo the app writes a `/LJSource` entry into the image dictionary (asset ID, matrix from
target pixel to photo pixel, background and semi-transparent panels). If the original carries an RGB profile other than
sRGB (Display P3, Adobe RGB …), the service renders the crop from the original with Pillow, blends the panels in the
photo's own color space and converts from that profile straight to CMYK; the report names how many photos that were.
Otherwise the app's sRGB rendering is used. The entry is removed from the print PDF either way. Thumbnails keep the
photo's profile, so browsers show the colors correctly and the soft proof starts from the real color space.

Print profiles: bundled under `lichtjahr/icc/` (basICColor, zlib license); your own ICC files via
`POST /api/printers` (stored in the data folder under `printers/`). The profile must be a CMYK output
profile; ICC version 4 profiles only work with PDF/X-4. The printing condition (e.g. FOGRA51) is detected from the description or the
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
They don't run against a real Nextcloud automatically; in practical use it works.

**Nextcloud's own file locks (HTTP 423):** While another operation writes a file (the Nextcloud sync client, a
parallel request) or after an interrupted upload, Nextcloud briefly locks it and answers 423. The service
then retries a few times over about five seconds. If the lock persists, the app shows a plain message
(HTTP 503 with `Retry-After`) instead of a storage error; Nextcloud releases such locks by itself.

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
| GET | `/api/projects/{id}/assets/{aid}/thumb?size=360&fx=` | Thumbnail; with `fx` (e.g. `f0.6n0.3`) with backlight fusion and noise reduction (cached) |
| GET | `/api/projects/{id}/assets/{aid}/original?fx=` | Original file; with `fx` as a full-size JPEG with backlight fusion and noise reduction |
| GET | `/api/projects/{id}/assets/{aid}/loupe?cx=&cy=&w=&h=&scale=&pw=&fx=&adj=&printer=&tune=&proof=&paper=` | Print loupe: `w` × `h` print pixels around (`cx`, `cy`) (fractions of the photo), `scale` print pixels per photo pixel (`pw`: photo width as the app knows it); rendered like the Print PDF from the full-size original with `fx`, recipe, print adaptation and sharpening, with `proof` as soft proof. The header `X-Lichtjahr-Box` gives the shown area (moved inwards at the edges); the last two full-size versions stay in memory |
| POST | `/api/projects/{id}/quality` | Noise and backlight of the given photos (`{ids: [...]}`) with a suggested strength (`fusion`, `denoise`, 0 = not needed), cached per checksum; `available: false` without OpenCV |
| POST | `/api/projects/{id}/assets/{aid}/move` / `copy` | Change month / copy explicitly |
| POST | `/api/projects/{id}/export/print` | Print PDF (`standard=x1a` or `x4`) with color profile and check report |
| GET | `/api/projects/{id}/assets/{aid}/proof?printer=&size=1600&paper=1&gamut=0&tune=1&adj=` | Soft proof: the photo as printed with the profile (cached JPEG, optionally paper white and gamut hatching); `adj` is the photo's compiled recipe (`m0,…,m8;l0,…,l64`), `tune` adds the print adaptation, `fx` the backlight/noise setting |
| GET | `/api/printers/{id}/tune` | Print adaptation for the profile: tone curve (65 points), strength, sharpening; derived from the profile's black point |
| POST | `/api/printers/{id}/proof-colors` | Soft proof for the app's CMYK colors (`{colors: {id: [c,m,y,k]}, paper}`), returns screen hex values and the paper color |
| GET | `/api/projects/{id}/export/{name}` | Download a PDF from `Export/` |
| GET / POST / DELETE | `/api/printers` | List print profiles (each with `richBlack`: the darkest neutral CMYK black within the ink limit, its L* and that of plain K) / add your own ICC profile / remove one |
| GET / POST | `/api/people/model` | Status of the recognition model / download it once (SFace, 10 MB, SHA-256 checked) into the data folder |
| POST | `/api/projects/{id}/people` | Faces with 128 features each for the given photos; cached locally only, never written to the project folder; the app groups them into people |
| POST | `/api/projects/{id}/faces` | Faces in the given photos (`{ids: [...]}`): boxes as fractions of the photo, cached per checksum; `available: false` without OpenCV |
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
- Print PDF: color conversion, PDF/X-1a and PDF/X-4 properties, ICC version 4 only with X-4, preflight findings, custom print profiles
- soft proof of photos and colors, gamut warning
- backlight fusion (subject brighter, sky not gray, preview matches print), noise reduction, analysis suggests only where needed, `fx` on thumbnail, proof, original and Print PDF
- wide color: detection, thumbnails with profile, print and soft proof from the original color space (rotated and zoomed crops, panels)

## Outlook

- Merge real exposure brackets (several shots with different exposure) into one photo.

HEIC and TIFF: with the `heic` extra the service reads iPhone photos directly (thumbnails, faces, print from the original including Display P3). Browsers can't decode HEIC or TIFF, so `/original` serves such files as a full-size JPEG with the photo's color profile (cached).
