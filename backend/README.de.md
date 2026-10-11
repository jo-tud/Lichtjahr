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
# → Lichtjahr 1.4.1 läuft: http://localhost:8470/   (öffnet den Browser; --no-browser verhindert das)
```

Ein zweiter Start öffnet nur den Browser erneut, mit Zugriffsschlüssel und gegebenenfalls dem genannten
Projekt; läuft noch eine ältere Version, bittet er, diese zuerst zu beenden. Ist Port 8470 von einem anderen
Programm belegt, nimmt der Dienst den nächsten freien und sagt das. Der laufende Dienst hinterlegt seine
Adresse in `running.json` im Datenordner (nur für dich lesbar, wird beim Beenden entfernt).

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
# → Lichtjahr 1.4.1 läuft: http://192.168.178.20:8470/?token=…
```

Sobald der Dienst im Netz erreichbar ist, verlangt er einen Zugriffsschlüssel. Er wird automatisch erzeugt
und steht in der angezeigten Adresse (oder wird mit `--token` selbst gesetzt). Die App behält ihn nur im
Arbeitsspeicher, nicht im Browser-Speicher. Für unterwegs eignet sich ein VPN wie Tailscale; der Dienst
richtet so etwas bewusst nicht selbst ein.

Ohne Schlüssel antwortet der Dienst nur unter `localhost` bzw. `127.0.0.1` und weist andere Hostnamen ab
(Schutz vor DNS-Rebinding, bei dem eine fremde Webseite sich als „localhost“ ausgibt).

### Mehrere Fenster und Geräte

Bearbeiten kann immer nur ein Fenster; weitere zeigen „Nur ansehen“ und übernehmen automatisch, sobald das
Projekt frei ist. Beim Ansehen ist Ändern in der Oberfläche gesperrt, und das Fenster lädt den Stand der
bearbeitenden Person, sobald sich `lichtjahr.json` ändert (es vergleicht einen kurzen `stamp` aus dem Sperrstatus:
ETag bei WebDAV, Änderungszeit und Größe auf der Festplatte). Wer ein Fenster schließt, gibt die Sperre sofort frei; bleibt ein Gerät einfach liegen,
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
    ├── journal.jsonl       Journal für Dateiverschiebungen
    └── fonts/              für diesen Kalender gewählte Schriften (siehe Schriften)
```

Vorschaubilder liegen nicht im Projektordner, sondern in einem Cache (zusammen mit berechneten Vorschauen,
Google Fonts und Gesichtsmerkmalen); die Liste der bekannten Projekte (`projects.json`), App-Passwörter für WebDAV
(`credentials.json`, nur für dich lesbar), eigene Druckprofile (`printers/`), gerettete Entwürfe, das Modell der
Gesichtserkennung und die Adresse des laufenden Dienstes (`running.json`) liegen in einem Datenordner auf diesem
Rechner (`--data-dir` und `--cache-dir` ändern das):

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

**Gegenlicht und Rauschen** (`lichtjahr/detail.py`, braucht OpenCV): Beides wirkt örtlich und läuft deshalb im Dienst, vor dem Rezept. Gegenlicht: Fünf künstliche Belichtungen (−1 bis +3 Blenden) des Fotos werden per Belichtungsfusion gemischt (Mertens, die Pyramide endet bei etwa 32 Pixeln, damit die Wirkung örtlich bleibt), immer auf einer Fassung mit 1600 Pixeln; heraus kommt eine Helligkeitskarte, die kantentreu (Guided Filter) auf jede Größe übertragen wird, damit Vorschau und Druck übereinstimmen. Sie hellt vor allem auf: Abdunkeln ist begrenzt, fast weiße Flächen bleiben unberührt, ein heller Himmel wird nicht grau. Rauschen: Stärke nach dem gemessenen Rauschen (Immerkær, auch je Helligkeitsstufe), Farbrauschen kräftig auf halber Größe, Helligkeitsrauschen behutsam (Non-Local Means). Wo die Helligkeitskarte das Foto danach aufhellt, wird das Rauschen um denselben Faktor sichtbarer; die Stärke ändert sich deshalb je Bildpunkt (zwei Non-Local-Means-Ergebnisse verschiedener Stärke, gemischt nach der gewünschten Stärke): Aufgehellte Schatten werden kräftiger entrauscht, der Rest behält seine Details. **Struktur** (`t`, −1 … +1): Feindetail (was ein Guided Filter mit Radius ≈ 1/600 der langen Seite und kleinem ε entfernt) wird in voller Auflösung skaliert; weiches Coring beim Dreifachen des gemessenen Rauschens (mal der örtlichen Aufhellung) verhindert, dass Rauschen verstärkt wird, starke Kanten bleiben in der Basisschicht, also keine Lichthöfe, Gesichter bekommen beim Betonen die Hälfte. **Druckschärfung** (`detail.sharpen`, für das Druck-PDF mit *Fotos an Papier und Druck anpassen* und die Lupe): Unscharfmaskierung nur auf der Helligkeit, weiches Coring beim Dreifachen des gemessenen Rauschens, Überschwingen begrenzt auf den Bereich der 3×3-Nachbarschaft plus 15 %. **Lichter, Tiefen, Klarheit örtlich:** Mit dem Dienst schickt die Oberfläche diese als Teil von `fx` (`h`, `s`, `c`, −1 … +1), statt sie in die Tonkurve zu rechnen. Lichter und Tiefen wirken auf eine kantentreue Basisschicht (Guided Filter auf der Helligkeit in Blenden), also nach Beleuchtung: Oberflächen wie dunkle Haut behalten ihre Helligkeit, fast Weißes bleibt weiß. Klarheit nutzt den schnellen lokalen Laplace-Filter (Paris et al. 2011, Aubry et al. 2014) nur in den mittleren Bändern (etwa 1/200 bis 1/20 der langen Seite): feine Strukturen und Rauschen bleiben, große Kanten bekommen keine Lichthöfe. Alles Örtliche, die Fusion eingeschlossen, landet in einer Helligkeitskarte auf 1600 Pixeln, die auf die Zielgröße übertragen wird; Aufgehelltes bekommt eine weiche Schulter statt abgeschnittener Lichter. Gesichtsschutz: Ein Gesicht wird nie stärker aufgehellt als der Median dessen, was um es herum aufgehellt wird (Haare, Hals, Kleidung), und Gegenlicht wird aus Pixeln außerhalb der Gesichter erkannt, dazu das Lichtverhältnis je Gesicht (hellste 5 % zum Median in linearem Licht, unabhängig vom Hautton). Die Einstellung reist als `fx=f0.40n0.30h-0.20s0.35c0.25t0.30` an Vorschau, Softproof und Original mit und als `/FX` im Eintrag `/LJSource` des Druck-PDFs. `POST /quality` misst je Foto Rauschen und Gegenlicht und schlägt eine Stärke vor; zwischengespeichert nach Prüfsumme.

**Großer Farbraum:** Zu jedem Foto schreibt die Oberfläche einen Eintrag `/LJSource` ins Bildobjekt (Asset-ID, Matrix
von Zielpixel zu Fotopixel, Hintergrund und halbtransparente Flächen). Hat das Original ein anderes RGB-Profil als sRGB
(Display P3, Adobe RGB …), rendert der Dienst den Ausschnitt mit Pillow aus dem Original, mischt die Flächen im Farbraum
des Fotos und rechnet von diesem Profil direkt nach CMYK um; der Bericht nennt, wie viele Fotos das waren. Sonst gilt die
sRGB-Fassung der Oberfläche. Der Eintrag wird in jedem Fall aus dem Druck-PDF entfernt. Vorschaubilder behalten das
Profil des Fotos: Browser zeigen die Farben richtig, und die Druckansicht rechnet vom echten Farbraum aus.

Druckprofile: mitgeliefert unter `lichtjahr/icc/` (basICColor, zlib-Lizenz), eigene ICC-Dateien über
`POST /api/printers` (landen im Datenordner unter `printers/`). Das Profil muss ein CMYK-Ausgabeprofil sein;
Profile der ICC-Version 4 gehen nur mit PDF/X-4. Die Druckbedingung (z. B. FOGRA51) wird aus Beschreibung oder Messdaten erkannt.

## Schriften

Die Oberfläche setzt Text selbst (Breiten aus der Schrift) und bettet jede Schrift als TrueType mit
WinAnsi-Kodierung ein, im PDF-Entwurf wie im Druck-PDF. `lichtjahr/fonts.py` bringt deshalb jede Schrift in diese
Form, bevor sie ins Projekt kommt (fontTools): Variable Schriften werden auf die Strichstärke festgelegt (400 für
normal, 600 oder der nächste vorhandene Schnitt für fett), CFF-Umrisse werden in TrueType umgerechnet, die Schrift
wird auf die Zeichen reduziert, die der Kalender druckt (Latin-1 und die Sonderzeichen von Windows-1252), und
Schriften, deren OS/2-`fsType` *Restricted License* sagt, werden abgelehnt.

- **Google Fonts:** `GET /api/fonts/google` liefert das Verzeichnis (von `fonts.google.com/metadata/fonts`, eine Woche
  im Zwischenspeicher, ohne Internet gilt der letzte Stand). Erst wenn jemand eine Familie auswählt, fragt der
  Dienst Google danach (TrueType über die CSS-Schnittstelle), bereitet sie auf und hält sie für die Vorschau bereit.
- **Im Projekt:** Gewählte Schriften liegen in `.lichtjahr/fonts/` mit dem Verzeichnis `fonts.json` – so haben sie
  alle, die mitarbeiten, auch ohne Internet. Der Gestaltungsstand verweist nur darauf (`doc.fonts.head`, `doc.fonts.text`).

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
| DELETE | `/api/projects/{id}` | Projekt auf diesem Rechner vergessen (samt WebDAV-Zugangsdaten); der Ordner bleibt unberührt |
| POST | `/api/projects/open` | vorhandenen Projektordner öffnen |
| GET | `/api/projects/{id}` | Übersicht (Fotos je Monat, Sperre, Speicherort) |
| GET / POST / DELETE | `/api/projects/{id}/lock` | Sperre ansehen (mit offener Anfrage und `stamp` des Manifests) / erwerben / freigeben |
| POST | `/api/projects/{id}/lock/heartbeat` | Sperre verlängern (wahlweise mit neuem Namen `holder`); die Antwort enthält eine offene Übergabe-Anfrage |
| POST | `/api/projects/{id}/lock/request` | Bearbeitung anfragen (`{holder}`); liefert die Sitzung der Anfragenden |
| POST | `/api/projects/{id}/lock/answer` | Wer bearbeitet, antwortet: `{status: "later", minutes}` oder `{status: "declined"}` |
| POST | `/api/projects/{id}/lock/handover` | Wer bearbeitet, übergibt die Sperre an die Sitzung der Anfragenden |
| POST | `/api/projects/{id}/lock/force` | Übernehmen ohne Zustimmung, nur nach einer eigenen Anfrage, die 45 s unbeantwortet blieb (nach „gleich“ die erbetenen Minuten plus 45 s); gemessen mit der Uhr des Speichers |
| GET / PUT | `/api/projects/{id}/manifest` | Manifest lesen / speichern (`If-Match: <Revision>`) |
| PATCH | `/api/projects/{id}/editor` | nur den Gestaltungsstand speichern (`If-Match`) |
| POST | `/api/projects/{id}/save` | automatisches Speichern der App: Gestaltung plus Bildtexte, Favoriten, Aussortieren in einer Revision |
| POST | `/api/projects/{id}/export` | PDF in `Export/` ablegen |
| POST | `/api/projects/{id}/scan` | Fotoordner abgleichen |
| GET / POST | `/api/projects/{id}/assets` | Fotos auflisten / hochladen (`month` 0–11; Antwort mit `duplicate`) |
| GET | `/api/projects/{id}/assets/{aid}/thumb?size=360&fx=` | Vorschaubild; mit `fx` (z. B. `f0.6n0.3`) mit Gegenlicht-Fusion und Rauschminderung (zwischengespeichert) |
| GET | `/api/projects/{id}/assets/{aid}/original?fx=` | Originaldatei; mit `fx` als JPEG in voller Größe mit Gegenlicht-Fusion und Rauschminderung |
| GET | `/api/projects/{id}/assets/{aid}/loupe?cx=&cy=&w=&h=&scale=&pw=&fx=&adj=&printer=&tune=&proof=&paper=` | Drucklupe: `w` × `h` Druckpixel um (`cx`, `cy`) (Bruchteile des Fotos), `scale` Druckpixel je Fotopixel (`pw`: Fotobreite, wie die Oberfläche sie kennt); gerechnet wie das Druck-PDF aus dem Original in voller Größe mit `fx`, Rezept, Druckausgleich und Schärfung, mit `proof` als Softproof. Der Header `X-Lichtjahr-Box` nennt den gezeigten Bereich (am Rand eingerückt); die letzten zwei Fassungen in voller Größe bleiben im Speicher |
| POST | `/api/projects/{id}/quality` | Rauschen und Gegenlicht der angegebenen Fotos (`{ids: [...]}`) mit vorgeschlagener Stärke (`fusion`, `denoise`, 0 = nicht nötig), je Prüfsumme zwischengespeichert; ohne OpenCV `available: false` |
| POST | `/api/projects/{id}/assets/{aid}/move` / `copy` | Monat wechseln / ausdrücklich kopieren |
| POST | `/api/projects/{id}/export/print` | Druck-PDF (`standard=x1a` oder `x4`) mit Farbprofil und Prüfbericht |
| GET | `/api/projects/{id}/assets/{aid}/proof?printer=&size=1600&paper=1&gamut=0&tune=1&adj=&fx=` | Softproof: das Foto, wie es mit dem Profil gedruckt aussieht (zwischengespeichertes JPEG, wahlweise mit Papierweiß und Farbumfang-Schraffur); `adj` ist das kompilierte Rezept des Fotos (`m0,…,m8;l0,…,l64`), `tune` nimmt den Druckausgleich dazu, `fx` die Einstellung für Gegenlicht und Rauschen |
| GET | `/api/printers/{id}/tune` | Druckausgleich für das Profil: Tonkurve (65 Stützstellen), Stärke, Schärfung; abgeleitet aus dem Schwarzpunkt des Profils |
| POST | `/api/printers/{id}/proof-colors` | Softproof für die CMYK-Farben der Oberfläche (`{colors: {id: [c,m,y,k]}, paper}`), liefert Bildschirm-Hexwerte und die Papierfarbe |
| GET | `/api/projects/{id}/export/{datei}` | PDF aus `Export/` herunterladen |
| GET / POST | `/api/printers` | Druckprofile auflisten (je mit `richBlack`: dem dunkelsten neutralen CMYK-Schwarz innerhalb des Farbauftrags, seinem L* und dem von reinem K) / eigenes ICC-Profil hinzufügen |
| DELETE | `/api/printers/{id}` | Eigenes Druckprofil entfernen |
| GET / POST | `/api/people/model` | Status des Erkennungsmodells / einmalig laden (SFace, 10 MB, SHA-256 geprüft) in den Datenordner |
| POST | `/api/projects/{id}/people` | Gesichter mit je 128 Merkmalen für die angegebenen Fotos; nur lokal zwischengespeichert, nie im Projektordner; die Oberfläche gruppiert sie zu Personen |
| POST | `/api/projects/{id}/faces` | Gesichter in den angegebenen Fotos (`{ids: [...]}`): Rechtecke in Bruchteilen des Fotos, je Prüfsumme zwischengespeichert; ohne OpenCV `available: false` |
| GET / PUT / DELETE | `/api/projects/{id}/draft` | Entwurf auf diesem Rechner retten (204, wenn keiner da ist) |
| GET | `/api/fonts/google` | Verzeichnis der Google Fonts mit lateinischen Zeichen (`family`, `category`, `weights`), beliebteste zuerst |
| GET | `/api/fonts/google/{family}` (`/{cut}.ttf`) | Eine Google-Schrift für die Vorschau laden und aufbereiten (zwischengespeichert): Dateien, fehlende Zeichen, Adressen |
| GET / POST | `/api/projects/{id}/fonts` | Schriften im Projekt / eine hinzufügen: Formularfeld `google` (Familie) oder Dateien `regular` (+ optional `bold`) |
| GET | `/api/projects/{id}/fonts/{file}` | Eine Schriftdatei aus `.lichtjahr/fonts/` |

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
- Gegenlicht-Fusion (Motiv heller, Himmel nicht grau, Vorschau wie Druck), Rauschminderung, Analyse schlägt nur vor, wo nötig, `fx` an Vorschau, Softproof, Original und Druck-PDF
- großer Farbraum: Erkennung, Vorschau mit Profil, Druck und Softproof aus dem Farbraum des Originals (gedrehte und gezoomte Ausschnitte, Flächen)

## Ausblick

- Echte Belichtungsreihen (mehrere Aufnahmen mit unterschiedlicher Belichtung) zu einem Foto verschmelzen.

HEIC und TIFF: Mit der Erweiterung `heic` liest der Dienst iPhone-Fotos direkt (Vorschau, Gesichter, Druck aus dem Original samt Display P3). Browser können HEIC und TIFF nicht dekodieren, darum liefert `/original` solche Dateien als JPEG in voller Größe mit dem Farbprofil des Fotos (zwischengespeichert).
