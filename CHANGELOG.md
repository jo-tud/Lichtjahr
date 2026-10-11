# Changelog

All notable changes to Lichtjahr. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.1] – 2026-10-11

Working on one calendar together.

### Fixes
- Joining a shared calendar: the project picker always offers *Open existing*. Before, someone without any
  project could only create one, and choosing the shared folder ended in "this folder already contains a project".
  Choosing *New* on a folder that already holds a calendar now simply opens it; nothing is overwritten.
- The hint under *Open existing* explains which WebDAV address to use for a shared Nextcloud folder.

### Documentation
- How to update, and how to work on one calendar together (also in the README.txt of the download).

## [1.2.0] – 2026-10-11

A deeper black for black backgrounds, a photo index with pictures behind the text, a calendar grid with two weeks
side by side, and fixes for the print preview and the editing lock.

### Design
- New calendar grid shape *Double grid*: two weeks side by side (14 columns, usually three rows), wide and flat,
  with the month name centered above. *Find a spot automatically* considers it too.
- The photo index can have photos behind its text: any page layout as background, photos per index page, a light
  or dark veil with adjustable strength (the text turns dark or light to match). *Fill empty frames* may use
  photos from the calendar for a look back at the year.

### Print
- Rich black from the print profile: a black background uses the darkest neutral black the print shop's profile
  allows within its ink limit (for ISO Coated v2: C65 M55 Y40 K100 instead of the fixed C50 M40 Y40 K100), also in
  the print preview. Text stays plain black.
- Photos shown in full or rotated are clipped to their own area in the PDF, so the background around them is the
  same vector color as the rest of the page instead of a slightly different box.

### Fixes
- With only one tab open, the app sometimes claimed another window was editing the project: when a tab came back
  to the foreground, two lock heartbeats could collide, and after sleep or a frozen background tab an expired lock
  of the same tab counted as lost. Both now keep the lock; only a real takeover by someone else ends editing.
- Print preview (also on the wall): the normal preview stays visible until the service has computed the print
  version of a photo. Before, a photo with detail edits vanished for a few seconds, and a black background made
  the page look empty.

## [1.1.0] – 2026-10-11

Photo quality: corrections that work locally, like in a raw developer, the same for every skin tone, and a print
loupe that shows a spot as it will be printed. Most of it needs the local service.

### Photos
- New automatic mode (auto-3), in linear light: exposure in stops with a soft shoulder and a range in which
  well-exposed photos stay untouched; white balance from a majority of four estimators, as strong as they agree;
  faces only as limits, never as a target, the same for every skin tone (tested). Earlier automatic settings keep
  their stored values.
- Highlights and shadows work locally with the service (edge-aware, by lighting), and there is a new Clarity
  slider (local Laplacian filter, no halos). Dark skin, hair and clothing keep their brightness, white stays white;
  a face is never lifted more than its surroundings. A test checks light and dark skin in the same scene.
- Backlight: with the local service, exposure fusion lifts a dark subject in front of a bright sky, while the sky
  stays white. Preview, soft proof, Draft PDF and Print PDF show the same result.
- Noise reduction for dark phone photos: color noise firmly, luminance noise gently. It measures noise per
  brightness level and works harder where the photo is brightened afterwards (backlight, shadows), so lifted
  shadows don't turn grainy.
- New *Texture* slider: fine detail brought out or smoothed at full resolution, without amplifying noise and
  without halos; faces get only half when strengthening.
- The service measures noise and backlight; the check list names photos that need it, with a one-click fix, and
  *Auto* includes the suggestion (and no longer darkens backlit photos). Two sliders under *Enhance photo* fine-tune it.
- Clicking *Auto* or a look no longer makes the slider bar taller, so the picture keeps its size and the
  difference is easy to see.

### Print
- Print loupe: hover over (or tap) a photo to see that spot as it will be printed, rendered by the service from
  the full-size original at Print PDF resolution, at paper size or 100 %.
- Print sharpening is noise-aware and limits overshoot, so edges get crisper without fringes.

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
