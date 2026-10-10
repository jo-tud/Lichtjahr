# Lichtjahr – lokaler Dienst

Der Dienst arbeitet direkt in einem **Projektordner** auf deinem Rechner. Er liest die Fotos aus
Monatsordnern, erzeugt Vorschaubilder, speichert den Gestaltungsstand und schützt das Projekt mit einer
Bearbeitungssperre. Die Oberfläche im Browser spricht über eine HTTP-Schnittstelle mit ihm.

Der Dienst liefert die Oberfläche gleich mit aus: `lichtjahr serve` starten, Adresse im Browser öffnen, fertig.

## Installation

Voraussetzung: Python 3.11 oder neuer (unter Linux meist vorhanden).

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
```

## Benutzung

```sh
# Dienst starten – nur auf diesem Rechner erreichbar
lichtjahr serve
# → Lichtjahr 0.1.0 läuft: http://localhost:8470/
```

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
| PDF erzeugen | `Export/Familienkalender-2027-Entwurf.pdf` |

### Vom Handy im Heimnetz

```sh
lichtjahr serve --host 0.0.0.0
# → Lichtjahr 0.1.0 läuft: http://192.168.178.20:8470/?token=…
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

Vorschaubilder liegen nicht im Projektordner, sondern im Cache (`~/.cache/lichtjahr`). Die Liste der
bekannten Projekte und gerettete Entwürfe liegen unter `~/.local/share/lichtjahr`.

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

## Ausblick

- Nextcloud über WebDAV als zweiter Speicherort mit derselben Schnittstelle (Sperre am gemeinsamen Endpunkt mit ETag-Prüfung).
- Druckexport im Dienst mit Farbmanagement (LittleCMS) und Preflight.
