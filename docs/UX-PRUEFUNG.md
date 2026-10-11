# UX-Prüfung vom 10.10.2026

Zwei unabhängige UX-Agenten (Skill: `.claude/skills/ux-pruefung/SKILL.md`) haben den Prototyp mit drei Personas
bedient: Desktop (Sabine, Helga) und Handy (Jonas, echte Touch-Gesten). Ziel war eine herausragende, innovative,
gut bedienbare UX; Barrierefreiheit war ausdrücklich kein Ziel. Insgesamt 36 Befunde und 14 Vorschläge.

## Umgesetzt
| Befund | Umsetzung |
|---|---|
| Foto nach „Entfernen“ + Rückgängig + Neuladen verloren (Sev 4) | Bilddaten werden erst beim Laden aufgeräumt; die letzten 15 Schritte überdauern das Neuladen |
| Weiße Kalenderschrift auf leerem Papier druckt unsichtbar (Sev 4) | Prüfung erkennt Schrift in Papierfarbe; Titel hat standardmäßig eine helle Fläche |
| „Beispielbilder entfernen“ hinterlässt leere Layouts (Sev 3) | Seiten werden zurückgesetzt |
| Kein „ganzes Jahr füllen“ (Sev 3) | „Kalender automatisch gestalten“: Layout je Monat nach Fotozahl und Format, Rahmen füllen, Kalendarien an ruhige Stellen; Angebot direkt nach dem Import |
| Layoutwechsel lässt neue Rahmen leer | neue Rahmen werden mit freien Fotos des Monats gefüllt |
| Automatisches Füllen nimmt unscharfe Fotos (Sev 3) | Auswahl berücksichtigt die Auflösung im Rahmen; Seitenleiste markiert zu kleine Fotos |
| Titelseite: Fotoauswahl leer (Sev 3) | ohne Favoriten startet die Auswahl mit allen Fotos |
| Rückgängig unsichtbar (Sev 3) | Meldung mit Seite, Sprung dorthin; Meldungen mit „Rückgängig“-Knopf |
| Geburtstage schwer zu finden (Sev 3) | Schnelleingabe im Reiter „Kalender“, Import aus Kontakten (.vcf/.ics) |
| Handy: Leinwand verschwindet beim Bearbeiten (Sev 3) | Seite bleibt oben fixiert, Werkzeuge und Fotos scrollen darunter |
| Handy: Gesten kollidieren mit Scrollen, versehentliches Verschieben/Zuschneiden (Sev 3) | lange drücken zum Verschieben/Tauschen, Doppeltipp für den Ausschnitt, Pinch-Mindestabstand |
| Anfasser zu klein, Vergrößern überlappt Nachbarn (Sev 3) | Trefferfläche ca. 40 px; Nachbarn an gemeinsamen Kanten gehen mit (Alt: allein) |
| Schritt „4 PDF“ am Handy abgeschnitten (Sev 3) | „An der Wand“ am Handy in die Werkzeugleiste verlegt |
| Export-Rückfrage ohne Details | nennt betroffene Seiten, „Zu …“ springt hin; Prüfung mit „Füllen“-Knöpfen |
| dpi-Warnungen zu früh | Schwellen 150 (knapp) und 100 dpi (unscharf); dpi aktualisiert sich beim Zoomen |
| Zurück-Taste verlässt die App, Neuladen springt zum Januar | Schritte in der Browser-Historie; letzte Seite wird wiederhergestellt („Willkommen zurück“) |
| Importfehler ohne Dateinamen | Karte mit Dateinamen und Hinweis zu HEIC |
| „Wirklich …?“ klappt nach 4 s zurück | Rückfragen als Dialog |
| Banner „Eigene Fotos laden“ öffnet keine Auswahl | öffnet direkt die Dateiauswahl |
| Auto-Platzierung ändert die gewählte Form | Form bleibt erhalten |
| Wand: Wischen am Handy, schnelle Klicks verschluckt | Touch-Gesten in der Szene, Klicks werden vorgemerkt |
| Fachsprache im PDF-Schritt | einfache Angaben vorn, technische Angaben aufklappbar |
| Kleinigkeiten | Einzahl/Mehrzahl, Hinweistexte für Touch bzw. Maus, feste Höhe der Werkzeugleiste, Geburtstagsfelder |
| Abschluss | nach dem Export eine kurze Feier und „An der Wand ansehen“ |

## Offen / später
- ~~Gesichtserkennung für Zuschnitt und Kalendarium~~ – erledigt (mit dem lokalen Dienst, seit 1.0).
- Nativer Teilen-Dialog für das PDF auf dem Handy.
- Kalendarium nach Layoutwechsel automatisch neu platzieren (bewusst nicht automatisch, Standardort hat Vorrang).
- Ordnerimport mit Umlauten nur im Testbrowser fehlgeschlagen; in echten Browsern prüfen.
