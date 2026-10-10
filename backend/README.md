# Lichtjahr – lokaler Dienst

Der Dienst arbeitet direkt in einem **Projektordner** auf deinem Rechner. Er liest die Fotos aus
Monatsordnern, erzeugt Vorschaubilder, speichert den Gestaltungsstand und schützt das Projekt mit einer
Bearbeitungssperre. Die Oberfläche im Browser spricht über eine HTTP-Schnittstelle mit ihm.

> Stand: erste Ausbaustufe. Der Dienst und seine Schnittstelle sind fertig und getestet. Die Oberfläche
> speichert noch im Browser; die Anbindung an den Dienst ist der nächste Schritt (siehe Roadmap im Haupt-README).

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
# Projekt anlegen (legt die Monatsordner an)
lichtjahr init ~/Bilder/Kalender-2027 --year 2027

# Dienst starten – nur auf diesem Rechner erreichbar
lichtjahr serve
# → Lichtjahr 0.1.0 läuft: http://localhost:8470/
```

Danach Fotos einfach in die Monatsordner legen, auch nach und nach und mit anderen Programmen. Ein
„Abgleich“ (Schaltfläche in der App bzw. `POST /api/projects/{id}/scan`) nimmt neue Dateien auf, erkennt
verschobene wieder und meldet fehlende.

### Vom Handy im Heimnetz

```sh
lichtjahr serve --host 0.0.0.0
# → Lichtjahr 0.1.0 läuft: http://0.0.0.0:8470/?token=…
```

Sobald der Dienst im Netz erreichbar ist, verlangt er einen Zugriffsschlüssel. Er wird automatisch erzeugt
und in der Adresse angezeigt (oder mit `--token` selbst gesetzt). Für unterwegs eignet sich ein VPN wie
Tailscale; der Dienst richtet so etwas bewusst nicht selbst ein.

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
| PATCH | `/api/projects/{id}/editor` | nur den Gestaltungsstand speichern |
| POST | `/api/projects/{id}/scan` | Fotoordner abgleichen |
| GET / POST | `/api/projects/{id}/assets` | Fotos auflisten / hochladen (`month` 0–11) |
| GET | `/api/projects/{id}/assets/{aid}/thumb?size=360` | Vorschaubild |
| GET | `/api/projects/{id}/assets/{aid}/original` | Originaldatei |
| POST | `/api/projects/{id}/assets/{aid}/move` / `copy` | Monat wechseln / ausdrücklich kopieren |
| GET / PUT | `/api/projects/{id}/draft` | Entwurf lokal retten |

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

## Ausblick

- Nextcloud über WebDAV als zweiter Speicherort mit derselben Schnittstelle (Sperre am gemeinsamen Endpunkt mit ETag-Prüfung).
- Anbindung der Oberfläche an den Dienst.
- Druckexport im Dienst mit Farbmanagement (LittleCMS) und Preflight.
