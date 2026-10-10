"""Start ohne Terminal-Kenntnisse: Browser öffnen, zweiter Start, belegter Port, Datenordner je Betriebssystem."""

import os

import pytest

from lichtjahr import cli, config
from lichtjahr.i18n import pick


@pytest.fixture
def started(monkeypatch, tmp_path):
    """uvicorn und Browser abfangen; zurück kommt, was gestartet bzw. geöffnet worden wäre."""
    import uvicorn
    import webbrowser
    seen = {"opened": [], "port": None, "waiting": []}
    monkeypatch.setattr(uvicorn, "run", lambda app, host, port, log_level: seen.update(port=port))
    monkeypatch.setattr(webbrowser, "open", lambda url: seen["opened"].append(url))
    monkeypatch.setattr(cli, "_open_when_ready", lambda url, port: seen["waiting"].append(url))
    base = ["--data-dir", str(tmp_path / "d"), "--cache-dir", str(tmp_path / "c")]
    return seen, base


def run(argv):
    with pytest.raises(SystemExit) as e:
        cli.main(argv)
    return e.value.code


def test_opens_browser_unless_told_not_to(started, monkeypatch):
    seen, base = started
    monkeypatch.setattr(cli, "_port_free", lambda host, port: True)
    assert run([*base, "serve", "--port", "8470"]) == 0
    assert seen["port"] == 8470 and seen["waiting"] == ["http://localhost:8470/"]
    seen["waiting"].clear()
    assert run([*base, "serve", "--no-browser"]) == 0
    assert seen["waiting"] == []


def test_second_start_only_opens_the_browser(started, monkeypatch, capsys):
    seen, base = started
    monkeypatch.setattr(cli, "_port_free", lambda host, port: False)
    monkeypatch.setattr(cli, "_lichtjahr_at", lambda port: "1.0.0")
    assert run([*base, "serve"]) == 0
    assert seen["port"] is None                       # kein zweiter Dienst
    assert seen["opened"] == ["http://localhost:8470/"]
    assert "8470" in capsys.readouterr().out


def test_busy_port_moves_on(started, monkeypatch, capsys):
    seen, base = started
    monkeypatch.setattr(cli, "_port_free", lambda host, port: port >= 8472)
    monkeypatch.setattr(cli, "_lichtjahr_at", lambda port: None)    # ein anderes Programm
    assert run([*base, "serve", "--no-browser"]) == 0
    assert seen["port"] == 8472
    assert "8472" in capsys.readouterr().out


def test_port_free_sees_a_listening_socket():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        assert not cli._port_free("127.0.0.1", s.getsockname()[1])


def test_lichtjahr_at_nothing():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert cli._lichtjahr_at(port) is None


def test_default_dirs_per_platform(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "AppData" / "Local"))
    for var in ("XDG_DATA_HOME", "XDG_CACHE_HOME"):
        monkeypatch.delenv(var, raising=False)
    data, cache = config.default_dirs("darwin")
    assert data == str(tmp_path / "Library" / "Application Support" / "Lichtjahr")
    assert cache == str(tmp_path / "Library" / "Caches" / "Lichtjahr")
    data, cache = config.default_dirs("win32")
    assert data == os.path.join(str(tmp_path / "AppData" / "Local"), "Lichtjahr")
    assert cache == os.path.join(data, "Cache")
    assert config.default_dirs("linux")[0] == str(tmp_path / ".local" / "share" / "lichtjahr")
    # Wer den alten Ordner schon hat, behält ihn
    (tmp_path / ".local" / "share" / "lichtjahr").mkdir(parents=True)
    assert config.default_dirs("darwin")[0] == str(tmp_path / ".local" / "share" / "lichtjahr")


def test_windows_locale_counts_as_german():
    assert pick("German_Germany") == "de"
    assert pick("English_United States") == "en"
