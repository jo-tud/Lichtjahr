import glob
import os
import re

from lichtjahr.i18n import EN, _t, pick, set_lang
from lichtjahr.printing import BUILTIN

SRC = os.path.join(os.path.dirname(__file__), "..", "lichtjahr")


def test_every_message_has_an_english_translation():
    keys = set()
    for path in glob.glob(os.path.join(SRC, "**", "*.py"), recursive=True):
        if path.endswith("i18n.py"):
            continue
        with open(path, encoding="utf-8") as fh:
            keys.update(m.group(1) for m in re.finditer(r'_t\(\s*"((?:[^"\\]|\\.)*)"', fh.read()))
    keys.update(b[k] for b in BUILTIN for k in ("name", "note"))
    assert sorted(k for k in keys if k not in EN) == []
    assert sorted(k for k in EN if k not in keys) == []                  # keine verwaisten Einträge


def test_language_choice():
    assert pick("de-DE,de;q=0.9,en;q=0.8") == "de" and pick("en-GB") == "en" and pick("fr-FR,de;q=0.5") == "de"
    assert pick(None) == "en" and pick("de_DE.UTF-8") == "de"
    set_lang("de")
    assert _t("Foto nicht gefunden.") == "Foto nicht gefunden."
    set_lang("en")
    assert _t("{name}: kein unterstütztes Bildformat (JPEG, PNG, WebP, TIFF, GIF).", name="a.pdf").startswith("a.pdf: not a supported")
