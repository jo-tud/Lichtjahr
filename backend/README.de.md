# Lichtjahr – lokaler Dienst

[English](README.md) · **Deutsch**

Der Dienst arbeitet direkt in einem **Projektordner** auf deinem Rechner. Er liest die Fotos aus
Monatsordnern, erzeugt Vorschaubilder, speichert den Gestaltungsstand und schützt das Projekt mit einer
Bearbeitungssperre. Die Oberfläche im Browser spricht über eine HTTP-Schnittstelle mit ihm.

Der Dienst liefert die Oberfläche gleich mit aus: `lichtjahr serve` starten, und die App öffnet sich im Browser.

## Installation

Ohne Terminal: das ZIP aus dem [aktuellen Release](https://github.com/jo-tud/Lichtjahr/releases/latest)
herunterladen und das Startskript doppelklicken (siehe [Haupt-README](../README.de.md#schnellstart)). Die Skripte
nutzen [uv](https://docs.astral.sh/uv/), das auch Python mitbringt, und starten den fertig gepackten Dienst
samt Oberfläche und HEIC-Unterstützung.

Zum Entwickeln, mit Python 3.11 oder neuer (unter Linux meist vorhanden):

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
pip install -e ".[heic]"     # optional: HEIC/HEIF-Fotos vom iPhone (pillow-heif, bringt libheif unter LGPL mit)
```

## Benutzung

```sh
# Dienst starten – nur auf diesem Rechner erreichbar
lichtjahr serve
# → Lichtjahr 1.0.0 läuft: http://localhost:8470/   (öffnet den Browser; --no-browser verhindert das)
```

Ein zweiter Start öffnet nur den Browser erneut. Ist Port 8470 von einem anderen Programm belegt, nimmt der
Dienst den nächsten freien und sagt das.

Beim ersten Öffnen fragt die App nach dem Projektordner: neu anlegen (die Monatsordner entstehen dabei)
oder einen vorhandenen öffnen. Alternativ auf der Befehlszeile:

```sh
lichtjahr init ~/Bilder/Kalender-2027 --year 2027   # Projekt anlegen
lichtjahr serve ~/Bilder/Kalender-2027              # Dienst starten und dieses Projekt gleich öffnen
```

Danach Fotos einfach in die Monatsordner legen, auch nach und nach und mit anderen Programmen. Die App
gleicht beim Öffnen und beim Zurückkehren ins Fenster automatisch ab („Ordner abgleichen“ geht auch von
Hand): neue Dateien kommen dazu, verschobene werden wiedererkannt, fehlende gemeldet.

### Was in der App passiert

| In der App | Im Projektordner |
|---|---|
| Fotos hinzufügen (Dateien, Ordner, Drag & Drop) | Kopie im passenden Monatsordner; dasselbe Foto ein zweites Mal ergibt keine zweite Datei |
| Foto einem anderen Monat zuordnen | Die Datei wandert in dessen Ordner (auch bei „Rückgängig“) |
| Kopie für einen weiteren Monat | Eigene Datei im zweiten Monatsordner |
| Foto entfernen | Nur aussortiert, die Datei bleibt liegen; „zurückholen“ geht jederzeit |
| Gestalten, Bildtexte, Favoriten | `lichtjahr.json`, automatisch gespeichert |
| Druck-PDF erzeugen | `Export/Familienkalender-2027-Druck.pdf` (PDF/X-1a oder PDF/X-4, mit Prüfbericht) |
| PDF-Entwurf erzeugen | `Export/Familienkalender-2027-Entwurf.pdf` |

### Vom Handy im Heimnetz

```sh
lichtjahr serve --host 0.0.0.0
# → Lichtjahr 1.0.0 läuft: http://192.168.178.20:8470/?token=…
```

Sobald der Dienst im Netz erreichbar ist, verlangt er einen Zugriffsschlüssel. Er wird automatisch erzeugt
und steht in der angezeigten Adresse (oder wird mit `--token` selbst gesetzt). Die App behält ihn nur im
Arbeitsspeicher, nicht im Browser-Speicher. Für unterwegs eignet sich ein VPN wie Tailscale; der Dienst
richtet so etwas bewusst nicht selbst ein.

Ohne Schlüssel antwortet der Dienst nur unter `localhost` bzw. `127.0.0.1` und weist andere Hostnamen ab
(Schutz vor DNS-Rebinding, bei dem eine fremde Webseite sich als „localhost“ ausgibt).

### Mehrere Fenster und Geräte

Bearbeiten kann immer nur ein Fenster; weitere zeigen „Nur ansehen“ und übernehmen automatisch, sobald das
Projekt frei ist. Wer ein Fenster schließt, gibt die Sperre sofort frei; bleibt ein Gerät einfach liegen,
läuft sie nach 2 Minuten ohne Lebenszeichen ab. Geht die Sperre während der Arbeit verloren (Rechner war im
Ruhezustand, inzwischen hat jemand anderes übernommen), sichert die App den letzten Stand auf diesem Rechner
und bietet ihn beim nächsten Öffnen an.

## Projektordner

```text
Kalender-2027/
├── lichtjahr.json          Manifest: Fotos, Gestaltungsstand, Revision (Schema-Version 1)
├── Fotos/
│   ├── 01 Januar/          ein Kandidatenordner je Monat – leere Ordner sind gültig
│   ├── …
│   ├── 12 Dezember/
│   └── Ohne Monat/
├── Export/                 fertige PDFs
└── .lichtjahr/
    ├── lock.json           Bearbeitungssperre
    └── journal.jsonl       Journal für Dateiverschiebungen
```

Vorschaubilder liegen nicht im Projektordner, sondern in einem Cache; die Liste der bekannten Projekte,
gerettete Entwürfe und das Modell der Gesichtserkennung liegen in einem Datenordner auf diesem Rechner
(`--data-dir` und `--cache-dir` ändern das):

| System  | Daten                                  | Cache                              |
|---------|----------------------------------------|------------------------------------|
| Linux   | `~/.local/share/lichtjahr`             | `~/.cache/lichtjahr`               |
| macOS   | `~/Library/Application Support/Lichtjahr` | `~/Library/Caches/Lichtjahr`    |
| Windows | `%LOCALAPPDATA%\Lichtjahr`             | `%LOCALAPPDATA%\Lichtjahr\Cache`   |

Gibt es `~/.local/share/lichtjahr` schon (frühere Versionen nutzten den Ort überall), bleibt es dabei.

## Druck-PDF

`POST /api/projects/{id}/export/print` nimmt das PDF der Oberfläche (Fotos als sRGB-JPEG, alles andere CMYK) und
ein Druckprofil entgegen (`lichtjahr/printing.py`):

1. Fotos mit Pillow/LittleCMS über das ICC-Profil nach CMYK, als CMYK-JPEG ohne Adobe-Konvention (alle PDF-Leser zeigen es gleich)
2. Formularfeld `standard`: `x1a` (Standard) für PDF/X-1a:2001 – PDF 1.3 ohne Objektströme, OutputIntent mit eingebettetem Profil, `GTS_PDFXVersion`, `Trapped`, Datumsangaben (pikepdf/qpdf) – oder `x4` für PDF/X-4: PDF 1.6 mit denselben Angaben und zusätzlich XMP-Metadaten (`pdfxid:GTS_PDFXVersion`, Dokument- und Instanz-ID, Version, Ausgabeart)
3. Preflight auf die fertige Datei: PDF/X-Pflichtangaben (bei X-4 samt XMP), PDF- und ICC-Version, nur CMYK, Gesamtfarbauftrag, Beschnitt, Schriften, Transparenz, Bildauflösung
4. Ablage in `Export/`, Antwort mit Pfad und Prüfbericht

**Rezepte und Druckausgleich:** Die Oberfläche rechnet die Anpassungen eines Fotos in eine 3×3-Farbmatrix und eine Tonkurve um; die Vorschau wendet sie als SVG-Filter an, die Oberfläche auf die gesendeten Pixel, und der Dienst (numpy) dieselben Zahlen auf Fotos aus dem Original und in der Druckansicht. Mit dem Formularfeld `tune=true` kommt die Kurve des Druckausgleichs dazu, und der Dienst schärft auf der Helligkeit (`UnsharpMask`, Stärke aus dem Profil).

**Großer Farbraum:** Zu jedem Foto schreibt die Oberfläche einen Eintrag `/LJSource` ins Bildobjekt (Asset-ID, Matrix
von Zielpixel zu Fotopixel, Hintergrund und halbtransparente Flächen). Hat das Original ein anderes RGB-Profil als sRGB
(Display P3, Adobe RGB …), rendert der Dienst den Ausschnitt mit Pillow aus dem Original, mischt die Flächen im Farbraum
des Fotos und rechnet von diesem Profil direkt nach CMYK um; der Bericht nennt, wie viele Fotos das waren. Sonst gilt die
sRGB-Fassung der Oberfläche. Der Eintrag wird in jedem Fall aus dem Druck-PDF entfernt. Vorschaubilder behalten das
Profil des Fotos: Browser zeigen die Farben richtig, und die Druckansicht rechnet vom echten Farbraum aus.

Druckprofile: mitgeliefert unter `lichtjahr/icc/` (basICColor, zlib-Lizenz), eigene ICC-Dateien über
`POST /api/printers` (landen im Datenordner unter `printers/`). Das Profil muss ein CMYK-Ausgabeprofil sein;
Profile der ICC-Version 4 gehen nur mit PDF/X-4. Die Druckbedingung (z. B. FOGRA51) wird aus Beschreibung oder Messdaten erkannt.

## Nextcloud und andere WebDAV-Server

`lichtjahr/storage/webdav.py` bietet dieselbe Speicher-Schnittstelle wie der lokale Ordner. Die beiden atomaren
Grundoperationen, auf denen Sperre und Manifest beruhen, wertet **der Server** aus, damit sie auch zwischen
Rechnern halten:

| Operation | WebDAV-Anfrage |
|---|---|
| exklusiv anlegen | `PUT` mit `If-None-Match: *` (412, wenn es die Datei gibt) |
| ersetzen, wenn unverändert | `PUT` mit `If-Match: <ETag>` (412, wenn sie sich geändert hat) |
| verschieben / kopieren, nie überschreiben | `MOVE` / `COPY` mit `Overwrite: F` |
| auflisten | `PROPFIND`, Ebene für Ebene (Nextcloud erlaubt kein `Depth: infinity`) |

Der Server muss bei jeder Änderung ein neues ETag vergeben und bedingte Anfragen auswerten; Nextcloud und
ownCloud tun das. Projekte werden mit `url`, `username` und `password` statt `path` angelegt oder geöffnet
(`POST /api/projects`, `POST /api/projects/open`). Der Dienst prüft die Anmeldung und legt die Zugangsdaten in
`credentials.json` im Datenordner ab (Rechte 0600). Sie stehen nie in `lichtjahr.json`, `projects.json` oder in
einer Antwort der Schnittstelle; „Projekt vergessen“ entfernt sie wieder. Unverschlüsseltes `http://` geht nur
für Adressen im eigenen Netz. Vorschaubilder liegen im lokalen Cache, jedes Foto wird je Änderung einmal geladen.

Die Tests lassen die gesamte Projekt-Testreihe zusätzlich gegen einen WsgiDAV-Server laufen (`tests/davserver.py`,
mit inhaltsbasierten ETags und nacheinander bearbeiteten Anfragen wie bei Nextcloud), einschließlich eines
Wettlaufs von sechs Clients um die Sperre. Gegen eine echte Nextcloud laufen sie nicht automatisch; im praktischen
Einsatz funktioniert es.

**Eigene Dateisperren von Nextcloud (HTTP 423):** Während ein anderer Vorgang eine Datei schreibt (der
Nextcloud-Sync-Client, eine parallele Anfrage) oder nach einem abgebrochenen Upload sperrt Nextcloud sie kurz und
antwortet mit 423. Der Dienst versucht es dann einige Male über etwa fünf Sekunden erneut. Bleibt die Sperre, zeigt
die App eine verständliche Meldung (HTTP 503 mit `Retry-After`) statt eines Speicherfehlers; Nextcloud gibt solche
Sperren von selbst wieder frei.

## Grundsätze

- **Originale bleiben unangetastet.** Fotos werden nie verändert oder überschrieben. Verschieben ändert nur
  den Pfad; bei gleichem Namen entsteht `foto (2).jpg`.
- **Jedes Foto gehört zu genau einem Monat**, nämlich zu seinem Ordner. Ein Monatswechsel verschiebt die
  Datei; eine Kopie für einen weiteren Monat entsteht nur ausdrücklich und bekommt eine eigene ID.
- **Stabile IDs.** Fotos behalten ihre ID, auch wenn sie außerhalb der App verschoben werden (Wiedererkennung
  über die SHA-256-Prüfsumme).
- **Keine stillen Verluste.** Fehlende oder veränderte Dateien werden gemeldet, ihre Verwendung bleibt erhalten.
- **Journal.** Datei verschieben und Manifest aktualisieren sind zwei Schritte. Bricht dazwischen etwas ab,
  schließt der Dienst den Vorgang beim nächsten Erwerb der Sperre ab oder vermerkt ihn als abgebrochen.
- **Eine Person bearbeitet, andere schauen zu.** Die Sperre hat eine begrenzte Laufzeit (Lease) und wird
  regelmäßig erneuert. Eine abgelaufene Sperre kann kontrolliert übernommen werden; der alte Besitzer
  bemerkt das beim nächsten Schreiben und kann nichts mehr überschreiben.
- **Veraltete Schreiber werden abgewiesen.** Gespeichert wird nur mit passender Revision (`If-Match`);
  sonst antwortet der Dienst mit 409 und dem aktuellen Stand.

## Schnittstelle

Die vollständige Beschreibung zeigt der laufende Dienst unter `http://localhost:8470/api/docs`.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Lebenszeichen |
| GET / POST | `/api/projects` | bekannte Projekte / neues Projekt anlegen |
| POST | `/api/projects/open` | vorhandenen Projektordner öffnen |
| GET | `/api/projects/{id}` | Übersicht (Fotos je Monat, Sperre, Speicherort) |
| GET / POST / DELETE | `/api/projects/{id}/lock` | Sperre ansehen / erwerben / freigeben |
| POST | `/api/projects/{id}/lock/heartbeat` | Sperre verlängern |
| GET / PUT | `/api/projects/{id}/manifest` | Manifest lesen / speichern (`If-Match: <Revision>`) |
| PATCH | `/api/projects/{id}/editor` | nur den Gestaltungsstand speichern (`If-Match`) |
| POST | `/api/projects/{id}/save` | automatisches Speichern der App: Gestaltung plus Bildtexte, Favoriten, Aussortieren in einer Revision |
| POST | `/api/projects/{id}/export` | PDF in `Export/` ablegen |
| POST | `/api/projects/{id}/scan` | Fotoordner abgleichen |
| GET / POST | `/api/projects/{id}/assets` | Fotos auflisten / hochladen (`month` 0–11; Antwort mit `duplicate`) |
| GET | `/api/projects/{id}/assets/{aid}/thumb?size=360` | Vorschaubild |
| GET | `/api/projects/{id}/assets/{aid}/original` | Originaldatei |
| POST | `/api/projects/{id}/assets/{aid}/move` / `copy` | Monat wechseln / ausdrücklich kopieren |
| POST | `/api/projects/{id}/export/print` | Druck-PDF (`standard=x1a` oder `x4`) mit Farbprofil und Prüfbericht |
| GET | `/api/projects/{id}/assets/{aid}/proof?printer=&size=1600&paper=1&gamut=0&tune=1&adj=` | Softproof: das Foto, wie es mit dem Profil gedruckt aussieht (zwischengespeichertes JPEG, wahlweise mit Papierweiß und Farbumfang-Schraffur); `adj` ist das kompilierte Rezept des Fotos (`m0,…,m8;l0,…,l64`), `tune` nimmt den Druckausgleich dazu |
| GET | `/api/printers/{id}/tune` | Druckausgleich für das Profil: Tonkurve (65 Stützstellen), Stärke, Schärfung; abgeleitet aus dem Schwarzpunkt des Profils |
| POST | `/api/printers/{id}/proof-colors` | Softproof für die CMYK-Farben der Oberfläche (`{colors: {id: [c,m,y,k]}, paper}`), liefert Bildschirm-Hexwerte und die Papierfarbe |
| GET | `/api/projects/{id}/export/{datei}` | PDF aus `Export/` herunterladen |
| GET / POST / DELETE | `/api/printers` | Druckprofile auflisten / eigenes ICC-Profil hinzufügen / entfernen |
| GET / POST | `/api/people/model` | Status des Erkennungsmodells / einmalig laden (SFace, 10 MB, SHA-256 geprüft) in den Datenordner |
| POST | `/api/projects/{id}/people` | Gesichter mit je 128 Merkmalen für die angegebenen Fotos; nur lokal zwischengespeichert, nie im Projektordner; die Oberfläche gruppiert sie zu Personen |
| POST | `/api/projects/{id}/faces` | Gesichter in den angegebenen Fotos (`{ids: [...]}`): Rechtecke in Bruchteilen des Fotos, je Prüfsumme zwischengespeichert; ohne OpenCV `available: false` |
| GET / PUT / DELETE | `/api/projects/{id}/draft` | Entwurf auf diesem Rechner retten (204, wenn keiner da ist) |

Schreibende Aufrufe brauchen die Kopfzeile `X-Lichtjahr-Session` mit der Sitzung aus dem Sperr-Erwerb.

## Tests

```sh
pip install -e ".[dev]"
pytest
```

Die Tests decken unter anderem ab:
- gleichzeitigen Sperr-Erwerb und gleichzeitige Übernahme einer abgelaufenen Sperre durch mehrere Prozesse (genau einer gewinnt)
- veraltete Schreiber
- außerhalb der App verschobene, veränderte und gelöschte Fotos
- einen simulierten Absturz mitten in einer Verschiebung
- bytegetreues Verschieben ohne Überschreiben
- die EXIF-Ausrichtung der Vorschaubilder
- Duplikate beim Hochladen, Aussortieren, Speichern nur erlaubter Felder, Export, Hostnamen-Prüfung
- Druck-PDF: Farbumrechnung, Merkmale von PDF/X-1a und PDF/X-4, ICC-Version 4 nur mit X-4, Preflight-Befunde, eigene Druckprofile
- Softproof von Fotos und Farben, Farbumfang-Warnung
- großer Farbraum: Erkennung, Vorschau mit Profil, Druck und Softproof aus dem Farbraum des Originals (gedrehte und gezoomte Ausschnitte, Flächen)

## Ausblick

- Belichtungsfusion (Mertens) für starkes Gegenlicht und Farbrauschminderung, wenn Tiefen angehoben werden.

HEIC und TIFF: Mit der Erweiterung `heic` liest der Dienst iPhone-Fotos direkt (Vorschau, Gesichter, Druck aus dem Original samt Display P3). Browser können HEIC und TIFF nicht dekodieren, darum liefert `/original` solche Dateien als JPEG in voller Größe mit dem Farbprofil des Fotos (zwischengespeichert).
