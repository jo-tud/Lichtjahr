# Contributing to Lichtjahr

Great that you want to help! Lichtjahr is a small project with a clear goal: making the yearly family
photo calendar as pleasant as possible – from the photo folder to the PDF for the print shop.

## Reporting bugs and sharing ideas

- **Bugs:** Please open an [issue](https://github.com/jo-tud/Lichtjahr/issues/new/choose) with your browser,
  device and the steps that lead to the bug. A screenshot almost always helps.
- **Ideas:** Issues are welcome for these, too. Ideally, describe *what* you want to achieve when making
  your calendar, not just which button is missing.
- **No private photos** in issues, please. The app's sample pictures are usually enough to reproduce a problem.

Issues and pull requests are welcome in English or German.

## Setting up the project

```sh
git clone https://github.com/jo-tud/Lichtjahr.git
cd Lichtjahr
```

### User interface (`prototyp/`)

No framework, no npm, no bundler. A shell script assembles the files in `prototyp/src/` into a single
HTML file:

```sh
prototyp/build.sh       # → prototyp/dist/index.html and prototyp/dist/kalenderwerkstatt.html
```

Then open `prototyp/dist/index.html` in your browser. The built files are committed as well, so the app
runs straight from the repository without a build.

A few principles:

- All page measurements are in **millimeters**. The SVG in the editor and the PDF are both produced from
  the same description (`pageItems`). If you add something new to the page, add it to both.
- The PDF must not contain **any transparency**; semi-transparent backdrops are baked into the image.
- UI texts are short and free of jargon. Print terms (bleed, CMYK) are fine where they are really needed.
- Every feature must also work with a **finger**; the phone is a second device, not an afterthought.

### Languages and translations

The app is available in English (the default) and German.

- UI texts are written **in German in the source code** and wrapped in `_t()` (or `_tc()`); the German
  text is also the lookup key, e.g. `_t('Fotos hinzufügen')`. Placeholders go in curly braces:
  `_t('{n} Fotos eingelesen.', { n })`.
- The English translations live in dictionaries in `prototyp/src/i18n/en_*.js`. If a translation is
  missing, the German text is shown.
- After `prototyp/build.sh`, `node tools/i18n-check.cjs` opens the app in English, walks through the views
  and lists missing translations as well as visible text that still looks German.
- The printed calendar has its own language setting (month names, weekdays, holidays, photo index),
  separate from the UI language. Keep both in mind when you add text that ends up on the page.
- The local service follows the same pattern for its messages (`backend/lichtjahr/i18n.py`).
- Documentation: `README.md` and `backend/README.md` are in English, with German versions in
  `README.de.md` and `backend/README.de.md`. Please update both when features change.

### Website (`site/`)

The landing page at `https://jo-tud.github.io/Lichtjahr/` is plain HTML and CSS in `site/`: `index.html` in English,
`de/index.html` in German – please keep both in step. The Pages workflow adds the app under `/app/` and
`docs/images/` under `/images/`. The page loads nothing from third parties (Jost lies in `site/assets/`, the
body text uses the system font); please keep it that way.

### Local service (`backend/`)

```sh
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
pytest
```

- All file access goes through the storage adapter (`lichtjahr/storage/`), never directly via `open()`.
  That way WebDAV/Nextcloud can be added later without restructuring.
- Changes to the manifest go through `Project.save()`/`update()` with a revision; never around the lock.
- New features come with tests. The lock tests start several processes – please don't weaken them.
- Print PDF (`lichtjahr/printing.py`, tests in `tests/test_printing.py`): only check in ICC profiles that may
  be freely redistributed (see `lichtjahr/icc/README.md`); ECI and Adobe profiles do not belong in the repository.
- The parity test in `tests/test_adjust.py` runs the app's photo enhancement JavaScript in **Node.js** and compares
  it with numpy; without `node` on the PATH it is skipped.
- The face tests and the backlight/noise tests (`tests/test_detail.py`) need OpenCV (installed with the package). The recognition tests download the SFace model (10 MB)
  on the first run and keep it in `.pytest_cache`; offline, point `LICHTJAHR_SFACE` to the file
  `face_recognition_sface_2021dec_int8.onnx`. Without the model, or if the path is wrong, they are skipped.

## Checks before a pull request

- `pytest` in the `backend/` folder passes.
- `prototyp/build.sh` has been run and `prototyp/dist/` is committed.
- Tried out in the browser, on desktop **and** at phone size (developer tools → device view).
- New or changed UI texts have English translations (`node tools/i18n-check.cjs`).
- For changes to the export: create a PDF and look at it in at least two programs
  (e.g. a browser and a PDF viewer).
- For changes to the service or its connection (`prototyp/src/b1_service.js`): `node tools/e2e-dienst.cjs`
  starts the service with test photos and runs through the most important workflows in the browser.
- For changes to photo enhancement (`prototyp/src/b4_adjust.js` or `apply_adjust` in the service): run the parity test in
  `backend/tests/test_adjust.py` (see above) so preview and print stay identical.
- If the look has changed: `node tools/screenshots.cjs` (browser-only views) and `node tools/screenshots-dienst.cjs`
  (views that need the local service) regenerate the README images in English and German
  (these scripts need Playwright with Chromium and Python with Pillow; `i18n-check.cjs` needs Playwright).

CI on GitHub runs the tests and the build automatically for every pull request.

## Pull requests

- One topic per pull request, with a short description: what changes for the person using the app?
- Commit messages in English or German, with a concise first line in the present tense.
- Please discuss larger restructurings in an issue first.

## Releases

1. Raise the version in `backend/lichtjahr/__init__.py` (the only place; the package reads it from there) and
   add a section to `CHANGELOG.md`.
2. `tools/package.sh --check` builds the package with the app inside and the download ZIP with the start
   scripts (`start/`), installs the package in a fresh environment and starts it. CI does the same for every
   pull request.
3. After merging, start the release: either push a tag `vX.Y.Z`, or run the workflow under Actions → Release →
   “Run workflow”, which sets the tag itself. It builds again and publishes ZIP and package with the changelog
   section as release notes.

The start scripts are tested on Linux in CI; changes to `start/Lichtjahr.bat` or the macOS behavior should be
tried on the real system.

## License

By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).
The exception is the school holiday data (`prototyp/src/schoolholidays.js`), which is an extract from the
OpenHolidays API and licensed under the ODbL 1.0.
