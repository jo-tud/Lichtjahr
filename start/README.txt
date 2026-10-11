Lichtjahr – family photo wall calendar
======================================

Start
-----
  macOS     Double-click "Lichtjahr.command".
            If macOS refuses to open it: System Settings > Privacy & Security > "Open Anyway",
            or in Terminal:  sh Lichtjahr.command
  Windows   Double-click "Lichtjahr.bat".
            If Windows SmartScreen warns: "More info" > "Run anyway".
  Linux     ./lichtjahr.sh  (or double-click, depending on your file manager)

The first time, the script installs the helper program uv (by Astral, asks first) and downloads
Python and the required packages (about 150 MB) into your user folder. Nothing is installed
system-wide. Later starts take a few seconds.

Lichtjahr then opens in your browser at http://localhost:8470/. Keep the window open while you
work on the calendar; close it to quit.

From your phone on the home network:  ./lichtjahr.sh --host 0.0.0.0  (Windows: Lichtjahr.bat --host 0.0.0.0)
The window then shows an address with an access key.

Update
------
Download the new ZIP from https://github.com/jo-tud/Lichtjahr/releases/latest and unpack it (it may replace
this folder). Close the window of the running Lichtjahr, then start the new script. Projects, print profiles
and access data stay where they are; the first start of a new version takes a moment longer.

Working on one calendar together
--------------------------------
Share the project folder (for example in Nextcloud, with edit permission). The other person starts Lichtjahr
and chooses "Open existing" with their own address of the shared folder. Only one person edits at a time; the
other sees the calendar read-only and can take over as soon as it is free. Use the same Lichtjahr version.

More: https://github.com/jo-tud/Lichtjahr


Lichtjahr – Familien-Fotokalender
=================================

Starten
-------
  macOS     „Lichtjahr.command“ doppelklicken.
            Falls macOS das Öffnen verweigert: Systemeinstellungen > Datenschutz & Sicherheit >
            „Dennoch öffnen“, oder im Terminal:  sh Lichtjahr.command
  Windows   „Lichtjahr.bat“ doppelklicken.
            Falls SmartScreen warnt: „Weitere Informationen“ > „Trotzdem ausführen“.
  Linux     ./lichtjahr.sh  (oder je nach Dateimanager doppelklicken)

Beim ersten Mal richtet das Skript das Hilfsprogramm uv ein (von Astral, fragt vorher) und lädt
Python und die nötigen Pakete (etwa 150 MB) in deinen Benutzerordner. Systemweit wird nichts
installiert. Spätere Starts dauern wenige Sekunden.

Lichtjahr öffnet sich dann im Browser unter http://localhost:8470/. Das Fenster offen lassen,
solange du am Kalender arbeitest; zum Beenden schließen.

Vom Handy im Heimnetz:  ./lichtjahr.sh --host 0.0.0.0  (Windows: Lichtjahr.bat --host 0.0.0.0)
Das Fenster zeigt dann eine Adresse mit Zugriffsschlüssel.

Aktualisieren
-------------
Das neue ZIP von https://github.com/jo-tud/Lichtjahr/releases/latest herunterladen und entpacken (es darf
diesen Ordner ersetzen). Das Fenster des laufenden Lichtjahr schließen, dann das neue Skript starten.
Projekte, Druckprofile und Zugangsdaten bleiben erhalten; der erste Start einer neuen Version dauert etwas länger.

Gemeinsam an einem Kalender
---------------------------
Den Projektordner teilen (zum Beispiel in Nextcloud, mit dem Recht zum Bearbeiten). Die andere Person startet
Lichtjahr und wählt „Vorhandenes öffnen“ mit ihrer eigenen Adresse des geteilten Ordners. Bearbeiten kann immer
nur eine Person; die andere sieht den Kalender zum Ansehen und kann übernehmen, sobald er frei ist. Beide
dieselbe Lichtjahr-Version verwenden.

Mehr: https://github.com/jo-tud/Lichtjahr
