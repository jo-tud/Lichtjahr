#!/bin/sh
cd "$(dirname "$0")"
{
  echo '<title>Kalenderwerkstatt</title>'
  echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">'
  echo '<style>'; cat src/style.css; echo '</style>'
  cat src/body.html
  echo '<script>'; cat fonts/fonts.js src/schoolholidays.js src/jpeg.js src/pdf.js src/a1_core.js src/a2_photos.js src/a3_render.js src/a4_ui.js src/a5_actions.js src/a6_editor.js src/a7_export.js src/a8_wall.js; echo '</script>'
} > dist/kalenderwerkstatt.html
