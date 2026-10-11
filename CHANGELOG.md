# Changelog

All notable changes to Lichtjahr. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Photos
- Highlights and shadows work locally with the service (edge-aware, by lighting), and there is a new Clarity
  slider (local Laplacian filter, no halos). Dark skin, hair and clothing keep their brightness, white stays white;
  a face is never lifted more than its surroundings. A test checks light and dark skin in the same scene.
- Backlight: with the local service, exposure fusion lifts a dark subject in front of a bright sky, while the sky
  stays white. Preview, soft proof, Draft PDF and Print PDF show the same result.
- Noise reduction for dark phone photos: color noise firmly, luminance noise gently.
- The service measures noise and backlight; the check list names photos that need it, with a one-click fix, and
  *Auto* includes the suggestion (and no longer darkens backlit photos). Two sliders under *Enhance photo* fine-tune it.

## [1.0.0] – 2026-10-10

The first release: everything needed for the yearly family photo calendar, from the photo folder to the Print PDF.

### Start without a terminal
- Download `Lichtjahr-1.0.0.zip`, unpack it and double-click the start script (macOS, Windows, Linux).
  The first start sets up uv, Python and all packages in your user folder; nothing is installed system-wide.
- The service opens the browser by itself. Starting it twice just opens the browser again; if the port is
  taken by another program, Lichtjahr picks the next free one.
- Data and thumbnails live in the usual place for each system (Application Support on macOS, `%LOCALAPPDATA%`
  on Windows, XDG on Linux); an existing data folder from earlier versions keeps being used.
- One command for those who prefer a terminal: `uvx --from <wheel URL> lichtjahr` (see README).

### Design
- Automatic design: photos into frames, a calm spot for the calendar grid and a fitting text color.
- Layout templates, freely placed frames, crops that keep faces in the picture.
- Calendar grid with design rules (even cells, minimum sizes, always fits) and four designs.
- Birthdays, school holidays (OpenHolidays API, ODbL), calendar weeks.
- Photo index, cover, flipping through the finished calendar on a wall.

### Photos
- Photos stay in month folders of a project folder, also in Nextcloud/WebDAV; lock with lease and journal.
- Optimize photos for print: automatic mode, looks, manual sliders, matching all months, print adaptation.
- Burst series: the best photo is suggested.
- Who appears how often in the photos: local face recognition, names only in the project.
- HEIC from the iPhone (included in the start scripts).

### Print
- Draft PDF in the browser; Print PDF from the service with ICC color management (LittleCMS),
  PDF/X-1a or PDF/X-4 and its own preflight report.
- Soft proof with paper white and gamut warning; wide color (Display P3, Adobe RGB) printed from the original.

### Languages
- English and German, for the app and separately for the printed calendar.
