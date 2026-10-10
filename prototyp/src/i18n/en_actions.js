// Englische Texte für Aktionen, Rückfragen und Meldungen (a5_actions.js), Editor (a6_editor.js),
// Wandansicht (a8_wall.js) und die Platzsuche des Kalendariums (a9_place.js)
Object.assign(EN, {
  // gemeinsame Knöpfe
  'Abbrechen': 'Cancel',
  'Entfernen': 'Remove',

  // Format wechseln
  'Auf {format} wechseln?': 'Switch to {format}?',
  'Auf den Seiten steht 1 Foto.': 'There is 1 photo on the pages.',
  'Auf den Seiten stehen {n} Fotos.': 'There are {n} photos on the pages.',
  'Rahmen und Kalendarium passen sich dem neuen Format an, Bildausschnitte bleiben so weit wie möglich erhalten. Danach die Seiten bitte einmal durchsehen. Rückgängig ist jederzeit möglich.': 'Frames and the calendar grid adapt to the new format, and crops are kept as far as possible. Please look through the pages afterwards. You can undo this at any time.',
  'Format wechseln': 'Switch format',

  // Layout und Rahmen
  '1 freies Foto des Monats eingesetzt.': 'Added 1 unused photo from this month.',
  '{n} freie Fotos des Monats eingesetzt.': 'Added {n} unused photos from this month.',
  '1 Foto hat im neuen Layout keinen Rahmen. Ein Wechsel zurück holt es wieder.': '1 photo has no frame in the new layout. Switch back to get it back.',
  '{n} Fotos haben im neuen Layout keinen Rahmen. Ein Wechsel zurück holt sie wieder.': '{n} photos have no frame in the new layout. Switch back to get them back.',
  'Rahmen stehen wieder wie in der Vorlage.': 'Frames are back to the layout’s defaults.',
  'Leere Kopie des Rahmens angelegt.': 'Added an empty copy of the frame.',
  '1 Foto eingesetzt.': 'Added 1 photo.',
  '{n} Fotos eingesetzt.': 'Added {n} photos.',
  'Keine passenden freien Fotos für diesen Monat.': 'No suitable unused photos for this month.',
  '1 Foto auf {page} eingesetzt.': 'Added 1 photo to {page}.',
  '{n} Fotos auf {page} eingesetzt.': 'Added {n} photos to {page}.',
  'Für {page} gibt es keine freien Fotos mehr.': 'There are no unused photos left for {page}.',

  // Kalendarium
  'Standardposition übernommen. Seiten mit eigener Position bleiben, wie sie sind.': 'Set as default position. Pages with their own position stay as they are.',
  'Für alle Monate übernommen.': 'Applied to all months.',

  // Beispielprojekt, Projekt zurücksetzen
  'Beispiel entfernt. Mit „Kalender automatisch gestalten“ kommen deine Fotos auf die Seiten.': 'Sample removed. Use “Design calendar automatically” to put your photos on the pages.',
  'Beispiel entfernt. Jetzt eigene Fotos hinzufügen.': 'Sample removed. Now add your own photos.',
  'Leeres Projekt beginnen?': 'Start an empty project?',
  'Alle Seiten, Fotos und Einstellungen dieses Projekts werden aus dem Browser gelöscht. Das lässt sich nicht rückgängig machen. Deine Fotodateien auf dem Rechner bleiben unberührt.': 'All pages, photos and settings of this project will be deleted from the browser. This can’t be undone. Your photo files on your computer stay untouched.',
  'Alles löschen und neu beginnen': 'Delete everything and start over',

  // Fotos entfernen
  '1 Foto aus dem Projekt entfernen?': 'Remove 1 photo from the project?',
  '{n} Fotos aus dem Projekt entfernen?': 'Remove {n} photos from the project?',
  'Es steht auf Kalenderseiten ({pages}) und wird dort herausgenommen.': 'It is on calendar pages ({pages}) and will be taken out there.',
  '1 davon steht auf Kalenderseiten ({pages}) und wird dort herausgenommen.': '1 of them is on calendar pages ({pages}) and will be taken out there.',
  '{n} davon stehen auf Kalenderseiten ({pages}) und werden dort herausgenommen.': '{n} of them are on calendar pages ({pages}) and will be taken out there.',
  'Die Dateien auf deinem Rechner bleiben unberührt und lassen sich unter „Fotos“ wieder zurückholen.': 'The files on your computer stay untouched and can be brought back under “Photos”.',
  'Die Dateien auf deinem Rechner bleiben unberührt. Rückgängig ist möglich.': 'The files on your computer stay untouched. You can undo this.',

  // Export
  '1 Problem vor dem Export': '1 problem before export',
  '{n} Probleme vor dem Export': '{n} problems before export',
  'Betroffen: {pages}. Leere Rahmen bleiben im PDF weiß, zu kleine Fotos werden unscharf.': 'Affected: {pages}. Empty frames stay white in the PDF, and photos that are too small will look blurry.',
  'Zu {page}': 'Go to {page}',
  'Trotzdem als Entwurf exportieren': 'Export as draft anyway',

  // Blätter
  'Weiteres Motiv für {month} eingefügt.': 'Added an extra photo sheet for {month}.',
  'Freies Blatt eingefügt.': 'Added a free sheet.',
  'Blatt entfernen?': 'Remove sheet?',
  'Auf dem Blatt steht 1 Foto. Es bleibt im Fotopool erhalten. Rückgängig ist möglich.': 'There is 1 photo on this sheet. It stays in your photo pool. You can undo this.',
  'Auf dem Blatt stehen {n} Fotos. Sie bleiben im Fotopool erhalten. Rückgängig ist möglich.': 'There are {n} photos on this sheet. They stay in your photo pool. You can undo this.',

  // Geburtstage
  'Bitte Name und Tag eintragen.': 'Please enter a name and a day.',
  'Geburtstag von {name} eingetragen.': 'Added birthday for {name}.',

  // Jedes Foto gehört genau einem Monat (src-Werte erscheinen in der Fotoinfo unter „Monat aus“)
  'von Hand': 'set by hand',
  'Kopie': 'copy',
  'Foto nach {to} verschoben.': 'Moved photo to {to}.',
  'Foto von {from} nach {to} verschoben.': 'Moved photo from {from} to {to}.',
  'Foto wird schon verwendet': 'Photo already in use',
  'Das Foto gehört zu keinem Monat und steht auf: {pages}. Jedes Foto gehört zu genau einem Monat.': 'This photo has no month and is on: {pages}. Each photo belongs to exactly one month.',
  'Das Foto gehört zu {from} und steht auf: {pages}. Jedes Foto gehört zu genau einem Monat.': 'This photo belongs to {from} and is on: {pages}. Each photo belongs to exactly one month.',
  'Nach {month} verschieben, dort entfernen': 'Move to {month}, remove it there',
  'Kopie für {month} anlegen': 'Make a copy for {month}',
  '1 Foto steht schon auf Seiten': '1 photo is already on pages',
  '{n} Fotos stehen schon auf Seiten': '{n} photos are already on pages',
  'Betroffen: {pages}. Beim Verschieben wird es dort aus dem Rahmen genommen.': 'Affected: {pages}. Moving it takes it out of its frame there.',
  'Betroffen: {pages}. Beim Verschieben werden sie dort aus den Rahmen genommen.': 'Affected: {pages}. Moving them takes them out of their frames there.',
  'Verschieben und dort entfernen': 'Move and remove there',
  '„Ohne Monat“': '“No month”',
  '1 Foto nach {to} verschoben.': 'Moved 1 photo to {to}.',
  '{n} Fotos nach {to} verschoben.': 'Moved {n} photos to {to}.',

  // Kalender automatisch gestalten
  'Zuerst Fotos hinzufügen, dann gestaltet die App den Kalender.': 'Add photos first, then the app designs your calendar.',
  'Alle Rahmen sind schon gefüllt oder es gibt keine freien Fotos mehr.': 'All frames are already filled, or there are no unused photos left.',
  'Kalender wird gestaltet': 'Designing your calendar',
  'Kalendarien suchen ruhige Stellen …': 'Calendar grids are looking for calm spots …',
  '1 Foto auf {pages} neu gestaltete und weitere Seiten verteilt, Kalendarien an ruhige Stellen gesetzt.': 'Placed 1 photo on the pages ({pages} newly designed) and moved the calendar grids to calm spots.',
  '{n} Fotos auf {pages} neu gestaltete und weitere Seiten verteilt, Kalendarien an ruhige Stellen gesetzt.': 'Placed {n} photos on the pages ({pages} newly designed) and moved the calendar grids to calm spots.',
  '1 Foto auf Seiten verteilt, Kalendarien an ruhige Stellen gesetzt.': 'Placed 1 photo on the pages and moved the calendar grids to calm spots.',
  '{n} Fotos auf Seiten verteilt, Kalendarien an ruhige Stellen gesetzt.': 'Placed {n} photos on the pages and moved the calendar grids to calm spots.',

  // Editor: Ziehen und Antippen
  'Fotos tauschen': 'Swap photos',
  'Ersetzt das Foto': 'Replaces photo',
  'Hier einsetzen': 'Place here',
  'Jetzt auf einen Rahmen tippen.': 'Now tap a frame.',

  // An der Wand
  'Kalender an der Wand': 'Calendar on the wall',
  'Schließen': 'Close',
  'Vorheriger Monat': 'Previous month',
  'Nächster Monat': 'Next month',
  'Wischen oder aufs Blatt tippen zum Umblättern': 'Swipe or tap the sheet to turn the page',
  'Aufs Blatt klicken, wischen oder Pfeiltasten zum Umblättern · Esc schließt': 'Click the sheet, swipe or use the arrow keys to turn the page · Esc closes',
  '{month} {year}, weiteres Motiv': '{month} {year}, extra photo',
  'Motiv A': 'Photo A',
  'Motiv B': 'Photo B',
  'Anderes Motiv': 'Other photo',

  // Platz automatisch finden
  'oben links': 'at the top left',
  'oben': 'at the top',
  'oben rechts': 'at the top right',
  'in der Mitte links': 'on the left',
  'in der Mitte': 'in the middle',
  'in der Mitte rechts': 'on the right',
  'unten links': 'at the bottom left',
  'unten': 'at the bottom',
  'unten rechts': 'at the bottom right',
  'Für diese Seite gibt es keinen passenden Platz (Kalendarium aus oder zu groß).': 'There’s no suitable spot on this page (calendar grid is off or too large).',
  'Ruhige Stelle {where} gefunden, dunkle Schrift. Rückgängig ist möglich.': 'Found a calm spot {where}, with dark text. You can undo this.',
  'Ruhige Stelle {where} gefunden, helle Schrift. Rückgängig ist möglich.': 'Found a calm spot {where}, with light text. You can undo this.',
  'Ruhige Stelle {where} gefunden, dunkle Schrift mit Fläche dahinter. Rückgängig ist möglich.': 'Found a calm spot {where}, with dark text on a backdrop. You can undo this.',
  'Ruhige Stelle {where} gefunden, helle Schrift mit Fläche dahinter. Rückgängig ist möglich.': 'Found a calm spot {where}, with light text on a backdrop. You can undo this.',
  'Kalendarien werden platziert': 'Placing calendar grids',
  '1 Kalendarium auf eine ruhige Bildstelle gesetzt. Jede Seite lässt sich danach von Hand korrigieren.': 'Moved 1 calendar grid to a calm spot in the photo. You can still adjust each page by hand.',
  '{n} Kalendarien auf ruhige Bildstellen gesetzt. Jede Seite lässt sich danach von Hand korrigieren.': 'Moved {n} calendar grids to calm spots in the photos. You can still adjust each page by hand.',
  'Das Foto lässt sich gerade nicht analysieren.': 'The photo can’t be analyzed right now.',
  'Fotos werden verbessert': 'Enhancing photos',
  '1 Foto automatisch verbessert. Jedes lässt sich einzeln nachregeln.': '1 photo enhanced automatically. Each one can be fine-tuned individually.',
  '{n} Fotos automatisch verbessert. Jedes lässt sich einzeln nachregeln.': '{n} photos enhanced automatically. Each one can be fine-tuned individually.',
  'Monate werden verglichen': 'Comparing months',
  'Dafür braucht es Fotos auf mindestens zwei Monatsseiten.': 'This needs photos on at least two month pages.',
  'Alle Monate angleichen': 'Match all months',
  'Belichtung und Farbstimmung der Monate werden einander angenähert. Die Jahreszeiten bleiben erkennbar, der Kalender wirkt wie aus einem Guss.': 'Exposure and color mood of the months are brought closer together. The seasons stay recognizable, and the calendar looks all of a piece.',
  'Vorher': 'Before',
  'Monate angeglichen. Jedes Foto lässt sich weiter einzeln nachregeln.': 'Months matched. Each photo can still be fine-tuned individually.',
});
