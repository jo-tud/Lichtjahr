#!/bin/sh
# Lichtjahr starten (macOS und Linux). Im Release-Ordner liegt dieses Skript neben dem Paket
# lichtjahr-*.whl; im Repository nimmt es den Dienst aus backend/ und die Oberfläche aus prototyp/dist.
# Benötigt wird nur uv (https://docs.astral.sh/uv/): es richtet Python und alle Pakete im Benutzerordner ein.
# Weitere Angaben werden an „lichtjahr serve“ durchgereicht, z. B. --host 0.0.0.0 für das Handy.
HERE=$(cd "$(dirname "$0")" && pwd)
# Ohne Terminal gestartet (Doppelklick im Dateimanager): in einem Terminalfenster neu starten, damit man die
# Rückfrage sieht und Lichtjahr durch Schließen des Fensters beenden kann
if [ ! -t 0 ] && [ -z "${LICHTJAHR_IN_TERMINAL:-}" ]; then
  export LICHTJAHR_IN_TERMINAL=1
  for t in x-terminal-emulator gnome-terminal konsole xfce4-terminal xterm; do
    command -v "$t" >/dev/null 2>&1 || continue
    case "$t" in
      gnome-terminal) exec "$t" -- "$HERE/$(basename "$0")" "$@" ;;
      xfce4-terminal) exec "$t" -x "$HERE/$(basename "$0")" "$@" ;;
      *) exec "$t" -e "$HERE/$(basename "$0")" "$@" ;;
    esac
  done
fi
PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export PATH
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in de*) DE=1 ;; *) DE= ;; esac
say() { if [ -n "$DE" ]; then printf '%s\n' "$2"; else printf '%s\n' "$1"; fi; }

if ! command -v uv >/dev/null 2>&1; then
  say "Lichtjahr needs the helper program uv (by Astral) once. It sets up Python and everything else" \
      "Lichtjahr braucht einmalig das Hilfsprogramm uv (von Astral). Es richtet Python und alles Weitere"
  say "for Lichtjahr in your user folder; nothing is installed system-wide." \
      "für Lichtjahr in deinem Benutzerordner ein; systemweit wird nichts installiert."
  if [ ! -t 0 ]; then                                # niemand kann antworten: nichts ohne Zustimmung installieren
    say "Please start this script in a terminal." "Bitte dieses Skript in einem Terminal starten."
    exit 1
  fi
  if [ -n "$DE" ]; then printf 'uv jetzt installieren? [J/n] '; else printf 'Install uv now? [Y/n] '; fi
  read -r answer || answer=n
  case "$answer" in
    [nN]*) say "Cancelled. To install uv yourself: https://docs.astral.sh/uv/" \
               "Abgebrochen. uv selbst installieren: https://docs.astral.sh/uv/"; exit 1 ;;
  esac
  if command -v curl >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh
  else wget -qO- https://astral.sh/uv/install.sh | sh; fi
  if ! command -v uv >/dev/null 2>&1; then
    say "uv could not be installed. Please install it yourself: https://docs.astral.sh/uv/" \
        "uv ließ sich nicht installieren. Bitte selbst installieren: https://docs.astral.sh/uv/"
    exit 1
  fi
fi

REFRESH=
WHEEL=$(ls "$HERE"/lichtjahr-*.whl 2>/dev/null | tail -n 1)
if [ -n "$WHEEL" ]; then
  FROM=$WHEEL
elif [ -f "$HERE/../backend/pyproject.toml" ]; then
  FROM="$HERE/../backend"
  REFRESH="--reinstall-package lichtjahr"            # im Repository: geänderten Code jedes Mal neu bauen
  set -- --static "$HERE/../prototyp/dist" "$@"
else
  say "The Lichtjahr package (lichtjahr-*.whl) is missing next to this script." \
      "Das Lichtjahr-Paket (lichtjahr-*.whl) fehlt neben diesem Skript."
  exit 1
fi

say "Starting Lichtjahr. The first start downloads about 150 MB and takes a few minutes." \
    "Lichtjahr startet. Beim ersten Mal werden etwa 150 MB geladen, das dauert ein paar Minuten."
# shellcheck disable=SC2086
exec uvx --python 3.12 $REFRESH --from "$FROM" --with pillow-heif lichtjahr serve "$@"
