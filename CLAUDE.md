# Hinweise für Claude

## Arbeitsweise
- Größere Änderungen auf einem eigenen Branch mit Pull Request; nicht direkt auf `main`.
- Das Repository ist öffentlich. Keine privaten Angaben über die Familie oder ihren Kalenderprozess
  (Namen, Wohnort, Bundesland, Druckerei, Server, Zugangsdaten) in Code, Commits, PRs oder Doku.
- Die Spezifikation liegt bewusst nicht im Repository. Der Nutzer fügt sie bei Bedarf in die Sitzung ein.
  Sie ist eine Richtschnur, keine starre Vorgabe: Eigene bessere Lösungen sind erwünscht, Abweichungen
  und Einwände kurz begründen.
- Antworten und Oberfläche auf Deutsch.

## Produkt
- Ziel ist ein Werkzeug für den jährlichen Familien-Fotokalender: Fotos den Monaten zuordnen, layouten,
  CMYK-PDF für die Druckerei.
- Immer ein „Wow-Feature“ mitdenken: etwas, bei dem man beim ersten Benutzen staunt, dass die App das kann.
  Ideen bisher: Durchblättern des fertigen Kalenders an der Wand, Kalendarium findet selbst eine ruhige
  Bildstelle und passende Schriftfarbe, Übersicht „wer ist wie oft auf den Fotos“, Vorauswahl aus Serienbildern.

## Prototyp (`prototyp/`)
- Eine einzelne HTML-Datei, gebaut mit `prototyp/build.sh` aus `prototyp/src/`. Nach Änderungen neu bauen
  und `prototyp/dist/kalenderwerkstatt.html` mit committen.
- Das PDF ist ein Entwurf (CMYK ohne ICC-Profil, kein PDF/X) und darf nicht als druckfertig bezeichnet werden.
- Vor einem Push im Browser testen (Playwright mit Chromium ist in der Cloud-Umgebung vorhanden),
  Desktop und Handy-Größe, und das exportierte PDF rendern.
