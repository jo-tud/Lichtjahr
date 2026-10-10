#!/bin/sh
# Release bauen: Paket (Wheel) mit eingebauter Oberfläche und ein ZIP zum Herunterladen mit Startskripten.
# Aufruf:  tools/package.sh            → release/lichtjahr-<version>-py3-none-any.whl, release/Lichtjahr-<version>.zip
#          tools/package.sh --check    → zusätzlich: Paket in frischer Umgebung installieren, Dienst starten, prüfen
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
VERSION=$(sed -n 's/^__version__ = "\(.*\)"/\1/p' backend/lichtjahr/__init__.py)
OUT="$ROOT/release"
rm -rf "$OUT" backend/build backend/lichtjahr/static
mkdir -p "$OUT" backend/lichtjahr/static

prototyp/build.sh
cp prototyp/dist/index.html backend/lichtjahr/static/index.html
# Die Kopie nur fürs Paket; danach wieder weg, sonst verdeckt sie in einer Entwicklungs-Installation prototyp/dist
trap 'rm -rf "$ROOT/backend/lichtjahr/static" "$ROOT/backend/build"' EXIT
(cd backend && python3 -m pip wheel . --no-deps -q -w "$OUT")
WHEEL="$OUT/lichtjahr-$VERSION-py3-none-any.whl"
[ -f "$WHEEL" ] || { echo "Paket fehlt: $WHEEL" >&2; exit 1; }
python3 - "$WHEEL" <<'PY'
import sys, zipfile
names = zipfile.ZipFile(sys.argv[1]).namelist()
for need in ("lichtjahr/static/index.html", "lichtjahr/models/face_detection_yunet_2023mar.onnx", "lichtjahr/icc/README.md"):
    assert need in names, f"{need} fehlt im Paket"
PY

DIR="$OUT/Lichtjahr-$VERSION"
mkdir -p "$DIR"
cp "$WHEEL" "$DIR/"
cp start/lichtjahr.sh "$DIR/Lichtjahr.command"          # macOS: Doppelklick öffnet das Terminal
cp start/lichtjahr.sh "$DIR/lichtjahr.sh"                # Linux
python3 -c "import sys; d=open(sys.argv[1],'rb').read().replace(b'\r\n',b'\n'); open(sys.argv[2],'wb').write(d.replace(b'\n',b'\r\n'))" \
  start/Lichtjahr.bat "$DIR/Lichtjahr.bat"               # Windows; cmd braucht CRLF, sonst springt goto daneben
cp start/README.txt LICENSE "$DIR/"
chmod +x "$DIR/Lichtjahr.command" "$DIR/lichtjahr.sh"
(cd "$OUT" && rm -f "Lichtjahr-$VERSION.zip" && python3 - "Lichtjahr-$VERSION" <<'PY'
import os, sys, zipfile
base = sys.argv[1]
with zipfile.ZipFile(base + ".zip", "w", zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(base)):
        path = os.path.join(base, name)
        info = zipfile.ZipInfo.from_file(path, arcname=f"{base}/{name}")
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = (0o100755 if os.access(path, os.X_OK) else 0o100644) << 16   # Ausführbar bleibt ausführbar
        with open(path, "rb") as fh:
            z.writestr(info, fh.read())
PY
)
rm -rf "$DIR"
echo "Lichtjahr $VERSION:"; ls -l "$OUT"

[ "${1:-}" = "--check" ] || exit 0
# Probelauf wie bei einem Nutzer: frische Umgebung, nur das Paket, Dienst starten, Oberfläche und API abfragen
TMP=$(mktemp -d)
python3 -m venv "$TMP/venv"
"$TMP/venv/bin/pip" install -q "$WHEEL"
PORT=8599
"$TMP/venv/bin/lichtjahr" --data-dir "$TMP/data" --cache-dir "$TMP/cache" serve --no-browser --port $PORT > "$TMP/log" 2>&1 &
PID=$!
ok=
for _ in $(seq 1 50); do
  if python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:$PORT/api/health').status==200 else 1)" 2>/dev/null; then ok=1; break; fi
  sleep 0.3
done
python3 - "$PORT" "$VERSION" <<'PY' || ok=
import json, sys, urllib.request
port, version = sys.argv[1], sys.argv[2]
health = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health"))
assert health["version"] == version, health
page = urllib.request.urlopen(f"http://127.0.0.1:{port}/").read().decode("utf-8")
assert "<title>Lichtjahr</title>" in page and "serviceScan" in page, "Oberfläche fehlt"
print("Probelauf: Dienst", health["version"], "liefert die Oberfläche aus.")
PY
kill $PID 2>/dev/null || true
cat "$TMP/log"
rm -rf "$TMP"
[ -n "$ok" ] || { echo "Probelauf fehlgeschlagen" >&2; exit 1; }
