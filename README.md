# Lichtjahr

Web-App für den jährlichen Familien-Fotokalender: Fotos den Monaten zuordnen, Seiten layouten, Kalendarium platzieren und ein CMYK-PDF für die Druckerei erzeugen.

## Stand

Im Ordner `prototyp/` liegt der erste klickbare Prototyp („Kalenderwerkstatt“). Er läuft komplett im Browser als einzelne HTML-Datei und dient zum Erproben der Bedienung. Er ist nicht die Ziel-Architektur (lokales Backend, Projektordner, Nextcloud/WebDAV, Druckereiprofile, ICC-Farbmanagement).

Was der Prototyp kann:

- Fotos importieren (Dateien, Ordner, Drag & Drop); Monat aus Ordnername, EXIF-Aufnahmedatum oder Dateiname
- „Kalender automatisch gestalten“: Layout je Monat nach Fotozahl und Format, Rahmen mit scharfen Fotos des Monats füllen, Kalendarien an ruhige Stellen setzen; danach alles frei änderbar
- Formate 29,7 × 29,7 cm, DIN A3 quer und weitere; Formatwechsel auch später, die Seiten passen sich an
- 15 Seitenvorlagen als Ausgangspunkt, Bildabstand 0–5 mm global oder pro Seite
- Rahmen frei verschieben, an den Ecken skalieren (mit Einrasten an Rändern, Mitte und Nachbarrahmen), überlagern, nach vorn/hinten, duplizieren, löschen, zusätzliche Rahmen, Rand pro Rahmen; Pfeiltasten verschieben in 0,5-/5-mm-Schritten
- Doppelklick oder zweites Antippen öffnet den Ausschnitt-Modus: Foto unter dem Rahmen verschieben, zoomen, drehen, „Füllen“ oder „Ganz zeigen“ (Mausrad und zwei Finger nur dort). Eigener Ansichtszoom
- Fotos tauschen: mit der Maus ein Foto auf einen anderen Rahmen ziehen; beim Ziehen aus der Fotoleiste zeigt der Rahmen vorher, was er ersetzt
- Jedes Foto gehört zu genau einem Monat: Einsetzen auf einer anderen Monatsseite ordnet es um; steht es dort schon, fragt die App nach (verschieben oder Kopie)
- Kalendarium als Leiste, Spalte oder Raster, frei verschiebbar, Fläche dahinter mit einstellbarer Deckkraft, Feiertage nach Bundesland
- „Platz automatisch finden“: Das Kalendarium sucht im Foto eine ruhige Fläche (wenig Detail, gleichmäßige Helligkeit), meidet Bindung und Rand, wählt Form und Schriftfarbe und bei Bedarf eine Fläche dahinter; für eine Seite oder alle Monate, danach frei korrigierbar
- Schulferien als feiner Strich (Daten der OpenHolidays API, eingebettet für 2025–2028), Kalenderwochen, Geburtstage als dezenter Punkt oder mit Namen und im Register mit Alter
- Ein- oder beidseitiger Druck. Rückseiten aufgeklappt (oben Rückseite des vorigen Blatts, unten der Monat, ein gemeinsames Kalendarium), als zweites Motiv je Monat oder als freie Fotoseiten. Zusätzliche Blätter für weitere Motive oder freie Seiten. Leuchttisch mit Monatsansichten und Druckbogen
- Titelblatt
- Bildregister in drei Arten: Bilder je Seite (Bildtexte, Nummern und Miniaturen wählbar), Text je Seite oder freier Text mit Zwischenüberschriften; fließt über beliebig viele Seiten
- Lochung und Aufhänger-Ausschnitt als Richtwerte oder mit eigenen Maßen aus dem Datenblatt
- „An der Wand“: der fertige Kalender hängt an einer Wand und lässt sich mit Wischen, Klick oder Pfeiltasten durchblättern; das Blatt schlägt über die Ringbindung um, in der aufgeklappten Ansicht wird seine Rückseite zum oberen Teil des nächsten Monats
- PDF-Entwurf mit Beschnitt, TrimBox, eingebetteter Schrift, CMYK-Bildern und ohne Transparenz (Flächen werden eingerechnet)

Eine UX-Prüfung durch zwei unabhängige Agenten ist in `docs/UX-PRUEFUNG.md` beschrieben; der Prüfauftrag liegt als Skill in `.claude/skills/ux-pruefung/`.

Grenzen: CMYK-Umrechnung ohne ICC-Profil, kein PDF/X, kein Druckerei-Profil. Daten liegen nur im Browser (IndexedDB). Das PDF ist deshalb **nicht** als druckfertig geprüft.

## Lokaler Dienst

Im Ordner `backend/` liegt der lokale Dienst (Python, FastAPI): Projektordner mit Monatsordnern, Vorschaubilder,
Bearbeitungssperre, Journal für Dateiverschiebungen. Start mit `lichtjahr serve`, Details in `backend/README.md`.

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
