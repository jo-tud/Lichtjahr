# Lichtjahr

Web-App für den jährlichen Familien-Fotokalender: Fotos den Monaten zuordnen, Seiten layouten, Kalendarium platzieren und ein CMYK-PDF für die Druckerei erzeugen.

## Stand

Im Ordner `prototyp/` liegt der erste klickbare Prototyp („Kalenderwerkstatt“). Er läuft komplett im Browser als einzelne HTML-Datei und dient zum Erproben der Bedienung. Er ist nicht die Ziel-Architektur (lokales Backend, Projektordner, Nextcloud/WebDAV, Druckereiprofile, ICC-Farbmanagement).

Was der Prototyp kann:

- Fotos importieren (Dateien, Ordner, Drag & Drop); Monat aus Ordnername, EXIF-Aufnahmedatum oder Dateiname
- 15 Seitenvorlagen, Bildabstand 0–5 mm, Einleger-Bilder, Bildausschnitt verschieben und zoomen
- Kalendarium als Leiste, Spalte oder Raster, frei verschiebbar, Feiertage nach Bundesland
- Titelblatt, Bildregister, optionale Rückseiten, Anzeige von Lochung und Aufhänger-Ausschnitt
- PDF mit Beschnitt, TrimBox, eingebetteter Schrift und CMYK-Bildern

Grenzen: CMYK-Umrechnung ohne ICC-Profil, kein PDF/X, keine Transparenzreduzierung, Bindungsmaße generisch und unverifiziert. Daten liegen nur im Browser (IndexedDB). Das PDF ist deshalb **nicht** als druckfertig geprüft.

## Prototyp bauen

```sh
cd prototyp
./build.sh            # erzeugt dist/kalenderwerkstatt.html
```

Die Datei `dist/kalenderwerkstatt.html` lässt sich direkt im Browser öffnen.

Aufbau:

| Datei | Inhalt |
|---|---|
| `src/style.css`, `src/body.html` | Oberfläche |
| `src/a1_core.js` | Formate, Farben, Feiertage, Vorlagen, Zustand, Rückgängig, Speichern |
| `src/a2_photos.js` | Import, EXIF, Monatserkennung, Beispielbilder |
| `src/a3_render.js` | Geometrie in mm, Kalendarium, Register, SVG-Darstellung, Bindung |
| `src/a4_ui.js` | Ansichten Projekt, Fotos, Gestalten, Druck |
| `src/a5_actions.js` | Aktionen und automatisches Verteilen |
| `src/a6_editor.js` | Ziehen, Zoomen, Verschieben im Editor |
| `src/a7_export.js` | PDF-Export und Start |
| `src/jpeg.js`, `src/pdf.js` | CMYK-JPEG-Encoder und minimaler PDF-Writer |
| `fonts/fonts.js` | Jost (Regular, SemiBold), auf Windows-1252 reduziert; erzeugt mit `tools/mkfont.py` |

Die Schrift Jost steht unter der SIL Open Font License (`prototyp/fonts/OFL.txt`).
