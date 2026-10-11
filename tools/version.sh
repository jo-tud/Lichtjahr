#!/bin/sh
# Versionsnummer an allen Stellen setzen: Paket, Download-Links und Beispielausgaben in READMEs und Website.
# Aufruf: tools/version.sh 1.4.0   (danach den Abschnitt [Unreleased] im CHANGELOG umbenennen)
set -e
new="$1"
case "$new" in [0-9]*.[0-9]*.[0-9]*) ;; *) echo "Aufruf: tools/version.sh X.Y.Z" >&2; exit 1 ;; esac
cd "$(dirname "$0")/.."
old=$(sed -n 's/^__version__ = "\(.*\)"/\1/p' backend/lichtjahr/__init__.py)
[ "$old" = "$new" ] && { echo "Schon $new"; exit 0; }
oldmm=${old%.*}; newmm=${new%.*}
files="backend/lichtjahr/__init__.py README.md README.de.md backend/README.md backend/README.de.md site/index.html site/de/index.html"
for f in $files; do
  # volle Nummer überall, „Version 1.3“ / „in 1.3“ auf der Website als Kurzform
  sed -i.bak -e "s/$(echo "$old" | sed 's/\./\\./g')/$new/g" "$f"
  case "$f" in site/*) sed -i.bak -e "s/\([ >]\)$(echo "$oldmm" | sed 's/\./\\./g')\([<“\" ]\)/\1$newmm\2/g" "$f" ;; esac
  rm -f "$f.bak"
done
echo "Version $old → $new. Jetzt CHANGELOG.md: ## [Unreleased] → ## [$new] – $(date +%Y-%m-%d)"
grep -rnF "$old" $files || true
