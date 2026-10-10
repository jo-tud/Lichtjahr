# Hinweise für Claude

## Arbeitsweise
- Größere Änderungen auf einem eigenen Branch mit Pull Request; nicht direkt auf `main`.
- Das Repository ist öffentlich. Keine privaten Angaben über die Familie oder ihren Kalenderprozess
  (Namen, Wohnort, Bundesland, Druckerei, Server, Zugangsdaten) in Code, Commits, PRs oder Doku.
- Die Spezifikation liegt bewusst nicht im Repository. Der Nutzer fügt sie bei Bedarf in die Sitzung ein.
  Sie ist eine Richtschnur, keine starre Vorgabe: Eigene bessere Lösungen sind erwünscht, Abweichungen
  und Einwände kurz begründen.
- Antworten an den Nutzer auf Deutsch.
- Sprachen: Englisch ist Standard für App und Doku, Deutsch gleichwertig. In der Oberfläche stehen die Texte
  deutsch im Quelltext und sind der Schlüssel für `_t()` (Oberfläche) bzw. `_tc()` (gedruckter Kalender);
  englische Wörterbücher in `prototyp/src/i18n/en_*.js`, im Dienst `backend/lichtjahr/i18n.py`. Neue Texte immer
  mit Übersetzung anlegen; `node tools/i18n-check.cjs` findet Lücken. README.md (Englisch) und README.de.md
  gemeinsam pflegen, ebenso backend/README.md und backend/README.de.md.
- Andere Programme im README nicht abwertend vergleichen; nur die Erfahrung beim Kalendermachen beschreiben.

## Produkt
- Ziel ist ein Werkzeug für den jährlichen Familien-Fotokalender: Fotos den Monaten zuordnen, layouten,
  CMYK-PDF für die Druckerei.
- Immer ein „Wow-Feature“ mitdenken: etwas, bei dem man beim ersten Benutzen staunt, dass die App das kann.
  Ideen bisher: Durchblättern des fertigen Kalenders an der Wand, Kalendarium findet selbst eine ruhige
  Bildstelle und passende Schriftfarbe, Übersicht „wer ist wie oft auf den Fotos“, Vorauswahl aus Serienbildern.

## Lokaler Dienst (`backend/`)
- Python/FastAPI, Projektordner als Datenquelle, Sperre mit Lease, Journal für Verschiebungen. Doku: `backend/README.md`.
- Vor einem Push: `cd backend && pytest` (die Sperrtests laufen mit mehreren Prozessen).

## Prototyp (`prototyp/`)
- Eine einzelne HTML-Datei, gebaut mit `prototyp/build.sh` aus `prototyp/src/`. Nach Änderungen neu bauen
  und `prototyp/dist/kalenderwerkstatt.html` mit committen.
- Zwei Exporte: der PDF-Entwurf im Browser (CMYK ohne ICC-Profil, nicht druckfertig) und das Druck-PDF über den
  Dienst (`backend/lichtjahr/printing.py`: LittleCMS, PDF/X-1a, Preflight). Auch das Druck-PDF nicht als
  „zertifiziert“ bezeichnen: geprüft wird mit dem eigenen Preflight. Keine ECI- oder Adobe-Profile ins Repo.
- Vor einem Push im Browser testen (Playwright mit Chromium ist in der Cloud-Umgebung vorhanden),
  Desktop und Handy-Größe, und das exportierte PDF rendern.
- Wenn sich das Aussehen deutlich ändert: `node tools/screenshots.cjs` erneuert die Bilder im README.
- Anbindung an den Dienst in `src/b1_service.js` (nur aktiv, wenn die Seite vom Dienst kommt). Nach Änderungen
  an Dienst oder Anbindung `node tools/e2e-dienst.cjs` laufen lassen (startet den Dienst mit Testfotos).

## Open Source
- Code unter MIT; Jost unter OFL; Schulferien-Daten (OpenHolidays API) unter ODbL – Quellenangabe in App,
  Register und README erhalten.
- README, CONTRIBUTING und Roadmap aktuell halten, wenn Funktionen dazukommen.
