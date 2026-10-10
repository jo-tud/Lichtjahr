# Mitmachen bei Lichtjahr

Schön, dass du helfen möchtest! Lichtjahr ist ein kleines Projekt mit einem klaren Ziel: den jährlichen
Familien-Fotokalender so angenehm wie möglich machen – vom Fotoordner bis zum PDF für die Druckerei.

## Fehler melden und Ideen einbringen

- **Fehler:** Bitte ein [Issue](https://github.com/jo-tud/Lichtjahr/issues/new/choose) mit Browser,
  Gerät und den Schritten bis zum Fehler. Ein Screenshot hilft fast immer.
- **Ideen:** Gern auch als Issue. Beschreibe am besten, *was* du beim Kalendermachen erreichen willst,
  nicht nur, welcher Knopf fehlt.
- **Keine privaten Fotos** in Issues hochladen. Die Beispielbilder der App reichen meist zum Nachstellen.

## Projekt einrichten

```sh
git clone https://github.com/jo-tud/Lichtjahr.git
cd Lichtjahr
```

### Oberfläche (`prototyp/`)

Kein Framework, kein npm, kein Bundler. Die Dateien in `prototyp/src/` werden von einem Shell-Skript zu
einer einzigen HTML-Datei zusammengesetzt:

```sh
prototyp/build.sh       # → prototyp/dist/index.html und prototyp/dist/kalenderwerkstatt.html
```

Dann `prototyp/dist/index.html` im Browser öffnen. Die gebauten Dateien werden mit committet, damit die
App ohne Build direkt aus dem Repository läuft.

Einige Grundsätze:

- Alle Seitenmaße sind **Millimeter**. Aus derselben Beschreibung (`pageItems`) entstehen das SVG im
  Editor und das PDF. Wer etwas Neues auf die Seite bringt, ergänzt beides.
- Das PDF darf **keine Transparenz** enthalten; halbtransparente Flächen werden ins Bild eingerechnet.
- Die Oberfläche ist **deutsch**, kurz und ohne Fachjargon. Druckbegriffe (Beschnitt, CMYK) sind okay,
  wo sie wirklich gebraucht werden.
- Jede Funktion muss auch mit dem **Finger** gehen; das Handy ist Zweitgerät, nicht Nebensache.

### Lokaler Dienst (`backend/`)

```sh
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
pytest
```

- Alle Dateizugriffe laufen über den Speicher-Adapter (`lichtjahr/storage/`), nie direkt über `open()`.
  So kommt später WebDAV/Nextcloud ohne Umbau dazu.
- Änderungen am Manifest gehen über `Project.save()`/`update()` mit Revision; nie an der Sperre vorbei.
- Neue Funktionen bringen Tests mit. Die Sperrtests starten mehrere Prozesse – bitte nicht abschwächen.

## Prüfen vor dem Pull Request

- `pytest` im Ordner `backend/` ist grün.
- `prototyp/build.sh` gelaufen und `prototyp/dist/` mit committet.
- Im Browser ausprobiert, am Desktop **und** in Handy-Größe (Entwicklertools → Geräteansicht).
- Bei Änderungen am Export: PDF erzeugen und in mindestens zwei Programmen ansehen
  (z. B. Browser und einem PDF-Betrachter).
- Bei Änderungen an Dienst oder Anbindung (`prototyp/src/b1_service.js`): `node tools/e2e-dienst.cjs`
  startet den Dienst mit Testfotos und spielt die wichtigsten Abläufe im Browser durch.
- Wenn sich das Aussehen geändert hat: `node tools/screenshots.cjs` erzeugt die README-Bilder neu
  (beide Skripte brauchen Playwright mit Chromium und Python mit Pillow).

Die CI auf GitHub prüft Tests und Build automatisch für jeden Pull Request.

## Pull Requests

- Ein Thema pro Pull Request, mit kurzer Beschreibung: Was ändert sich für die Nutzerin oder den Nutzer?
- Commit-Nachrichten auf Deutsch oder Englisch, in der ersten Zeile knapp und im Präsens.
- Größere Umbauten bitte vorher in einem Issue ansprechen.

## Lizenz

Mit einem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE) des Projekts steht.
Ausnahme sind die Schulferien-Daten (`prototyp/src/schoolholidays.js`), die als Auszug der
OpenHolidays API unter der ODbL 1.0 stehen.
