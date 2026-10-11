"""Meldungen auf Englisch (Standard) oder Deutsch.

Wie in der Oberfläche steht der deutsche Text im Code und ist zugleich der Schlüssel:
``_t("Foto nicht gefunden.")``, Platzhalter in geschweiften Klammern: ``_t("{name}: …", name=name)``.
Die Sprache gilt je Anfrage (``Accept-Language``, gesetzt von einer Middleware) bzw. für die Befehlszeile
nach der Systemsprache.
"""

from __future__ import annotations

import contextvars
import locale
import os

_lang: contextvars.ContextVar[str] = contextvars.ContextVar("lichtjahr_lang", default="en")


def pick(header_or_locale: str | None) -> str:
    """„de-DE,de;q=0.9,en;q=0.8“ oder „de_DE.UTF-8“ → „de“; alles andere → „en“."""
    for part in (header_or_locale or "").replace("_", "-").split(","):
        tag = part.split(";")[0].strip().lower()
        if tag.startswith("de") or tag.startswith("german"):     # Windows meldet „German_Germany“
            return "de"
        if tag.startswith("en"):
            return "en"
    return "en"


def system_lang() -> str:
    for var in ("LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"):
        if os.environ.get(var):
            return pick(os.environ[var])
    try:
        return pick(locale.getlocale()[0])
    except ValueError:
        return "en"


def set_lang(lang: str) -> contextvars.Token:
    return _lang.set(lang if lang in ("de", "en") else "en")


def current() -> str:
    return _lang.get()


def _t(text: str, **kw) -> str:
    s = EN.get(text, text) if _lang.get() == "en" else text
    return s.format(**kw) if kw else s


EN = {
    # Zugriff und Anfragen
    "Unbekannter Hostname. Bitte über http://localhost aufrufen.": "Unknown host name. Please open it via http://localhost.",
    "Zugriffsschlüssel fehlt oder ist falsch.": "Access key missing or wrong.",
    "Speicherfehler: {error}": "Storage error: {error}",
    "Projekt unbekannt. Bitte über „Projekt öffnen“ hinzufügen.": "Unknown project. Please add it via “Open project”.",
    "Speicherart {kind} wird noch nicht unterstützt.": "Storage type {kind} is not supported yet.",
    "Sitzung fehlt.": "Session missing.",
    "Datei nicht gefunden.": "File not found.",
    "Die Datei ist zu groß für ein ICC-Profil.": "The file is too large for an ICC profile.",
    "Foto nicht gefunden.": "Photo not found.",
    "Die Datei fehlt im Projektordner.": "The file is missing from the project folder.",
    "Monat muss zwischen 0 (Januar) und 11 (Dezember) liegen.": "Month must be between 0 (January) and 11 (December).",
    # Sperre
    "Gesperrt durch {holder} auf {device}": "Locked by {holder} on {device}",
    "Es liegt keine Anfrage vor.": "There is no request.",
    "Zuerst die Bearbeitung anfragen.": "Request editing first.",
    "Bitte noch etwas auf eine Antwort warten.": "Please wait a little longer for an answer.",
    "Die Sperre gehört nicht mehr dieser Sitzung.": "The lock no longer belongs to this session.",
    "Die Sperre wurde zwischenzeitlich verändert.": "The lock was changed in the meantime.",
    "Zum Ändern zuerst die Bearbeitungssperre erwerben.": "Acquire the editing lock before making changes.",
    # Projekt
    "In diesem Ordner gibt es schon ein Lichtjahr-Projekt.": "This folder already contains a Lichtjahr project.",
    "Hier liegt kein Lichtjahr-Projekt (lichtjahr.json fehlt).": "There is no Lichtjahr project here (lichtjahr.json is missing).",
    "lichtjahr.json ist beschädigt: {error}": "lichtjahr.json is damaged: {error}",
    "Das Projekt stammt aus einer neueren Lichtjahr-Version.": "The project was created with a newer version of Lichtjahr.",
    "lichtjahr.json ist ungültig: {error}": "lichtjahr.json is invalid: {error}",
    "Das Projekt wurde inzwischen geändert (Revision {revision}).": "The project was changed in the meantime (revision {revision}).",
    "{name}: kein unterstütztes Bildformat (JPEG, PNG, WebP, TIFF, GIF).": "{name}: not a supported image format (JPEG, PNG, WebP, TIFF, GIF).",
    "Ungültiges Format: {error}": "Invalid format: {error}",
    "Für HEIC die Erweiterung installieren: pip install 'lichtjahr[heic]'": "For HEIC, install the extension: pip install 'lichtjahr[heic]'",
    "Export: nur PDF-Dateien.": "Export: PDF files only.",
    "Verschiebung abgeschlossen: {src} → {dst}": "Move completed: {src} → {dst}",
    "Verschiebung nicht ausgeführt, Datei liegt weiter in {src}": "Move not carried out, the file is still in {src}",
    "Unklarer Stand, bitte prüfen: {src} / {dst}": "Unclear state, please check: {src} / {dst}",
    "Pfad außerhalb des Projektordners: {path}": "Path outside the project folder: {path}",
    "Bitte einen Ordner oder eine WebDAV-Adresse angeben.": "Please enter a folder or a WebDAV address.",
    # WebDAV
    "Die WebDAV-Adresse muss mit https:// beginnen.": "The WebDAV address must start with https://.",
    "Bitte eine https://-Adresse verwenden; http:// geht nur im eigenen Netz.": "Please use an https:// address; http:// only works on your own network.",
    "Der WebDAV-Server ist nicht erreichbar: {error}": "The WebDAV server can’t be reached: {error}",
    "Anmeldung am WebDAV-Server abgelehnt. Benutzername und App-Passwort prüfen.": "The WebDAV server rejected the login. Check user name and app password.",
    "WebDAV-Fehler {status} bei {path}": "WebDAV error {status} at {path}",
    "Unter dieser Adresse gibt es keinen WebDAV-Ordner ({status}).": "There is no WebDAV folder at this address ({status}).",
    "Nextcloud hält {path} gerade gesperrt (WebDAV 423). Meist schreibt gleichzeitig ein anderes Programm an der Datei, etwa der Nextcloud-Sync, oder ein abgebrochener Upload hat eine Sperre hinterlassen. Nextcloud gibt sie nach einiger Zeit selbst frei; bitte gleich noch einmal versuchen.":
        "Nextcloud is holding a lock on {path} right now (WebDAV 423). Usually another program is writing the file at the same time, such as the Nextcloud sync client, or an interrupted upload left a lock behind. Nextcloud releases it by itself after a while; please try again shortly.",
    # Druckprofile
    "Unbekanntes Druckprofil.": "Unknown print profile.",
    "Für „{name}“ fehlt die ICC-Datei {icc}.": "The ICC file {icc} for “{name}” is missing.",
    "Das Profil hat ICC-Version 4. Dafür PDF/X-4 wählen; PDF/X-1a braucht ein Profil der Version 2.":
        "The profile is ICC version 4. Choose PDF/X-4 for it; PDF/X-1a needs a version 2 profile.",
    "Mitgelieferte Profile lassen sich nicht löschen.": "Bundled profiles can’t be deleted.",
    "Keine gültige ICC-Datei: {error}": "Not a valid ICC file: {error}",
    "Das Profil beschreibt {space}, gebraucht wird ein CMYK-Druckprofil.": "The profile describes {space}; a CMYK print profile is needed.",
    "Das ist kein Ausgabeprofil für den Druck.": "This is not an output profile for printing.",
    "Eigenes Profil": "Custom profile",
    "Das PDF der Oberfläche ist unlesbar: {error}": "The PDF from the app can’t be read: {error}",
    "Unerwarteter JPEG-Aufbau.": "Unexpected JPEG structure.",
    "Gestrichenes Papier · FOGRA39": "Coated paper · FOGRA39",
    "Ungestrichenes Papier · FOGRA47": "Uncoated paper · FOGRA47",
    "Verbreiteter Standard für Fotokalender auf glänzendem oder mattem Papier. Verlangt die Druckerei PSO Coated v3 (FOGRA51), deren Profil als eigenes Druckprofil hinzufügen; frei mitliefern dürfen wir es nicht.":
        "Common standard for photo calendars on glossy or matte paper. If your print shop asks for PSO Coated v3 (FOGRA51), add that profile as a custom print profile; we’re not allowed to bundle it.",
    "Für Naturpapier, das Farben etwas weicher und matter wiedergibt.": "For natural paper, which renders colors a little softer and more matte.",
    # Preflight
    "PDF/X-Kennung fehlt.": "PDF/X identification is missing.",
    "Angabe zur Überfüllung (Trapped) fehlt.": "Trapping information (Trapped) is missing.",
    "Titel fehlt.": "Title is missing.",
    "PDF-Version {version}, für {std} höchstens {max}.": "PDF version {version}; {std} allows at most {max}.",
    "XMP-Metadaten fehlen oder sind unvollständig ({missing}).": "XMP metadata missing or incomplete ({missing}).",
    "Das eingebettete Profil hat ICC-Version {version}; PDF/X-1a erlaubt nur Version 2.": "The embedded profile is ICC version {version}; PDF/X-1a only allows version 2.",
    "Transparenz (in PDF/X-4 erlaubt)": "Transparency (allowed in PDF/X-4)",
    "Unbekannter PDF/X-Standard.": "Unknown PDF/X standard.",
    "Das PDF ist verschlüsselt.": "The PDF is encrypted.",
    "Dokument-ID fehlt.": "Document ID is missing.",
    "Ausgabebedingung (OutputIntent mit ICC-Profil) fehlt.": "Output condition (OutputIntent with ICC profile) is missing.",
    "Endformat (TrimBox) fehlt.": "Trim size (TrimBox) is missing.",
    "Beschnittrahmen ragt über das Papierformat hinaus.": "The bleed box extends beyond the media box.",
    "Seite verwendet Transparenz.": "The page uses transparency.",
    "Transparenz-Einstellung gefunden.": "Transparency setting found.",
    "Schrift {font} ist nicht eingebettet.": "Font {font} is not embedded.",
    "Bild {name} ist nicht in CMYK ({cs}).": "Image {name} is not CMYK ({cs}).",
    "Bild {name} hat eine Transparenzmaske.": "Image {name} has a transparency mask.",
    "Farbe außerhalb von CMYK im Seiteninhalt ({op}).": "Color outside CMYK in the page content ({op}).",
    "Foto mit nur {dpi} dpi wird sichtbar unscharf (ab {min} dpi gut).": "Photo with only {dpi} dpi will look blurry (good from {min} dpi).",
    "Foto mit {dpi} dpi (bestens ab {good} dpi).": "Photo with {dpi} dpi (best from {good} dpi).",
    "Eingebettetes Inline-Bild gefunden.": "Embedded inline image found.",
    "Beschnitt nur {short} mm, verlangt {bleed} mm.": "Bleed only {short} mm, {bleed} mm required.",
    "Gesamtfarbauftrag bis {tac} %, erlaubt sind {limit} %.": "Total ink coverage up to {tac}%, {limit}% allowed.",
    "{pdfx} mit Ausgabebedingung {condition}": "{pdfx} with output condition {condition}",
    "Alle Farben in CMYK, Fotos mit Farbprofil umgerechnet ({intent})": "All colors in CMYK, photos converted with the color profile ({intent})",
    "wahrnehmungsorientiert": "perceptual",
    "relativ farbmetrisch": "relative colorimetric",
    "Gesamtfarbauftrag höchstens {tac} % (Grenze {limit} %)": "Total ink coverage at most {tac}% (limit {limit}%)",
    "Beschnitt mindestens {bleed} mm an allen Seiten": "Bleed of at least {bleed} mm on all sides",
    "Schriften vollständig eingebettet": "Fonts fully embedded",
    "Keine Transparenz": "No transparency",
    "Für den Druck angepasst: Mitteltöne {mid} % heller, Tiefen geöffnet, geschärft": "Adapted for print: midtones {mid}% lighter, shadows opened up, sharpened",
    "1 Foto mit großem Farbraum ({names}) direkt aus dem Original umgerechnet": "1 photo with a wide color space ({names}) converted straight from the original",
    "{n} Fotos mit großem Farbraum ({names}) direkt aus dem Original umgerechnet": "{n} photos with a wide color space ({names}) converted straight from the original",
    "Kleinste Bildauflösung {dpi} dpi": "Lowest image resolution {dpi} dpi",
    # Personen
    "Für die Gesichtserkennung fehlt OpenCV im Dienst.": "OpenCV is missing in the service, so faces can’t be recognized.",
    "Das Erkennungsmodell ließ sich nicht laden: {error}": "The recognition model couldn’t be loaded: {error}",
    # Befehlszeile
    "Hinweis: Der Dienst ist im Netz erreichbar ({host}). Zugriff nur mit Schlüssel.": "Note: the service is reachable on the network ({host}). Access only with the key.",
    "{path}: {error}  Neues Projekt mit „lichtjahr init {path}“ anlegen.": "{path}: {error}  Create a new project with “lichtjahr init {path}”.",
    "Projekt: {title} {year} ({location})": "Project: {title} {year} ({location})",
    "Lichtjahr {version} läuft: {url}": "Lichtjahr {version} is running: {url}",
    "Lichtjahr {version} läuft bereits: {url}": "Lichtjahr {version} is already running: {url}",
    "Lichtjahr {version} läuft noch in einem anderen Fenster. Bitte dort beenden und dann neu starten.": "Lichtjahr {version} is still running in another window. Please quit it there and start again.",
    "Port {port} ist belegt, und kein freier in der Nähe gefunden. Mit --port einen anderen wählen.": "Port {port} is in use and no free port was found nearby. Choose another one with --port.",
    "Port {old} ist belegt, Lichtjahr nimmt {new}.": "Port {old} is in use, Lichtjahr uses {new}.",
    "Die Adresse {host} lässt sich auf diesem Rechner nicht nutzen: {error}": "The address {host} can't be used on this computer: {error}",
    "Dieses Fenster offen lassen, solange du am Kalender arbeitest. Beenden mit Strg+C oder Fenster schließen.": "Keep this window open while you work on the calendar. To quit, press Ctrl+C or close the window.",
    "Diese Adresse (mit Schlüssel) auf dem Handy öffnen; sie gilt nur in eurem Netz.": "Open this address (including the key) on your phone; it only works on your home network.",
    "API-Dokumentation: {url}": "API documentation: {url}",
    "Projekt „{title}“ für {year} angelegt in {root}": "Project “{title}” for {year} created in {root}",
    "Fotos in die Monatsordner unter {photos}/ legen oder später in der App hinzufügen.": "Put photos into the month folders under {photos}/ or add them later in the app.",
    "Familienkalender": "Family Calendar",
}
