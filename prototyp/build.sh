#!/bin/sh
cd "$(dirname "$0")"
{
  echo '<title>Lichtjahr</title>'
  # Schrift der Oberfläche (IBM Plex, OFL) eingebettet: die App lädt nichts von fremden Servern
  printf '<style>'
  printf '@font-face{font-family:"IBM Plex Sans";font-weight:400 600;font-display:swap;src:url(data:font/woff2;base64,%s) format("woff2")}' "$(base64 < fonts/plex/IBMPlexSans-Var.woff2 | tr -d '\n')"
  for w in 400 500; do
    printf '@font-face{font-family:"IBM Plex Mono";font-weight:%s;font-display:swap;src:url(data:font/woff2;base64,%s) format("woff2")}' "$w" "$(base64 < fonts/plex/IBMPlexMono-$w.woff2 | tr -d '\n')"
  done
  echo '</style>'
  echo '<style>'; cat src/style.css; echo '</style>'
  cat src/body.html
  echo '<script>'; cat fonts/fonts.js src/schoolholidays.js src/i18n.js src/i18n/*.js src/jpeg.js src/pdf.js src/a1_core.js src/a2_photos.js src/a3_render.js src/a4_ui.js src/a5_actions.js src/a6_editor.js src/a7_export.js src/a9_place.js src/b1_service.js src/b2_print.js src/b3_faces.js src/b4_adjust.js src/b5_series.js src/b6_people.js src/b7_loupe.js src/b8_fonts.js src/a8_wall.js; echo '</script>'
} > dist/kalenderwerkstatt.html
# Eigenständige Seite für den Start ohne Claude-Artefakt (lokal im Browser oder über den Dienst)
{
  printf '<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
  printf '<link rel="icon" href="data:image/svg+xml,%%3Csvg xmlns=%%27http://www.w3.org/2000/svg%%27 viewBox=%%270 0 20 20%%27%%3E%%3Ccircle cx=%%275%%27 cy=%%275%%27 r=%%274%%27 fill=%%27%%2300a0e3%%27/%%3E%%3Ccircle cx=%%2715%%27 cy=%%275%%27 r=%%274%%27 fill=%%27%%23e5007e%%27/%%3E%%3Ccircle cx=%%275%%27 cy=%%2715%%27 r=%%274%%27 fill=%%27%%23ffd500%%27/%%3E%%3Ccircle cx=%%2715%%27 cy=%%2715%%27 r=%%274%%27 fill=%%27%%231a2028%%27/%%3E%%3C/svg%%3E">\n'
  printf '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}body{margin:0;font:14px system-ui}img{max-width:100%%}[hidden]{display:none!important}</style>\n</head>\n<body>\n'
  cat dist/kalenderwerkstatt.html
  printf '\n</body>\n</html>\n'
} > dist/index.html

