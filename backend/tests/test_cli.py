"""Start ohne Terminal-Kenntnisse: Browser öffnen, zweiter Start, belegter Port, Datenordner je Betriebssystem."""

import os

import pytest

from lichtjahr import cli, config
from lichtjahr.i18n import pick


def free_port() -> int:
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def started(monkeypatch, tmp_path):
    """Dienst und Browser abfangen; zurück kommt, was gestartet bzw. geöffnet worden wäre."""
    import webbrowser
    seen = {"opened": [], "port": None, "browser": None, "running": None}

    def run_server(app, sock, browser_url):
        seen.update(port=sock.getsockname()[1], browser=browser_url, running=cli._Running(str(tmp_path / "d")).read())
        mode = os.stat(tmp_path / "d" / "running.json").st_mode & 0o777
        seen["mode"] = mode
    monkeypatch.setattr(cli, "_run_server", run_server)
    monkeypatch.setattr(webbrowser, "open", lambda url: seen["opened"].append(url))
    base = ["--data-dir", str(tmp_path / "d"), "--cache-dir", str(tmp_path / "c")]
    return seen, base, tmp_path


def run(argv):
    with pytest.raises(SystemExit) as e:
        cli.main(argv)
    return e.value.code


def test_opens_browser_unless_told_not_to(started):
    seen, base, tmp = started
    port = free_port()
    assert run([*base, "serve", "--port", str(port)]) == 0
    assert seen["port"] == port and seen["browser"] == f"http://localhost:{port}/"
    assert seen["running"]["port"] == port
    if os.name == "posix":                                                # Dateirechte gibt es so nur unter Unix
        assert seen["mode"] == 0o600                                      # mit Schlüssel, nur für den Besitzer
    assert not (tmp / "d" / "running.json").exists()                     # nach dem Beenden aufgeräumt
    assert run([*base, "serve", "--port", str(port), "--no-browser"]) == 0
    assert seen["browser"] is None


def test_lan_start_opens_with_token(started):
    seen, base, _ = started
    port = free_port()
    assert run([*base, "serve", "--host", "127.0.0.1", "--token", "abc", "--port", str(port)]) == 0
    assert seen["browser"] == f"http://localhost:{port}/?token=abc"


def own_instance(tmp, port, monkeypatch, version=None, token=None):
    cli._Running(str(tmp / "d")).write({"instance": "i1", "pid": 1, "host": "0.0.0.0", "port": port, "token": token,
                                        "version": version or cli.__version__})
    monkeypatch.setattr(cli, "_probe", lambda host, p: {"ok": True, "version": version or cli.__version__, "instance": "i1"} if p == port else None)


def test_second_start_opens_the_running_one_with_its_key(started, monkeypatch, capsys):
    seen, base, tmp = started
    port = free_port()
    own_instance(tmp, port, monkeypatch, token="geheim")
    assert run([*base, "serve", "--port", str(port)]) == 0
    assert seen["port"] is None                       # kein zweiter Dienst
    assert seen["opened"] == [f"http://localhost:{port}/?token=geheim"]
    assert "geheim" not in capsys.readouterr().out    # Schlüssel nicht ins Fenster


def test_second_start_with_project_opens_it_there(started, monkeypatch):
    seen, base, tmp = started
    port = free_port()
    assert run([*base, "init", str(tmp / "k"), "--year", "2027"]) == 0
    own_instance(tmp, port, monkeypatch)
    assert run([*base, "serve", str(tmp / "k"), "--port", str(port)]) == 0
    assert seen["port"] is None and len(seen["opened"]) == 1 and "projekt=" in seen["opened"][0]


def test_second_start_finds_it_on_the_port_it_moved_to(started, monkeypatch):
    seen, base, tmp = started
    port = free_port()
    own_instance(tmp, port, monkeypatch)              # lief auf einem anderen Port als dem angefragten
    assert run([*base, "serve", "--port", "8470"]) == 0
    assert seen["port"] is None and seen["opened"] == [f"http://localhost:{port}/"]


def test_stale_running_file_is_ignored(started, monkeypatch):
    seen, base, tmp = started
    port = free_port()
    cli._Running(str(tmp / "d")).write({"instance": "alt", "host": "127.0.0.1", "port": port})
    assert run([*base, "serve", "--no-browser", "--port", str(port)]) == 0   # niemand antwortet: normal starten
    assert seen["port"] == port


def test_other_version_still_running(started, monkeypatch, capsys):
    seen, base, tmp = started
    port = free_port()
    own_instance(tmp, port, monkeypatch, version="0.9.0")
    assert run([*base, "serve", "--port", str(port)]) == 1
    assert seen["port"] is None and seen["opened"] == []
    assert "0.9.0" in capsys.readouterr().err


def test_busy_port_moves_on(started, capsys):
    import socket
    seen, base, _ = started
    with socket.socket() as other:                    # ein anderes Programm
        other.bind(("127.0.0.1", 0))
        other.listen()
        port = other.getsockname()[1]
        assert run([*base, "serve", "--no-browser", "--port", str(port)]) == 0
    assert seen["port"] not in (None, port)
    assert str(seen["port"]) in capsys.readouterr().out


def test_no_port_left_at_the_top(started, monkeypatch, capsys):
    seen, base, _ = started
    monkeypatch.setattr(cli, "_bind", lambda host, port: None if port < 65536 else pytest.fail("Port über 65535"))
    assert run([*base, "serve", "--port", "65530"]) == 1
    assert "65530" in capsys.readouterr().err


def test_unusable_address_is_named(started, monkeypatch, capsys):
    seen, base, _ = started
    def no_ipv6(host, port):
        raise OSError(97, "Address family not supported by protocol")
    monkeypatch.setattr(cli, "_bind", no_ipv6)
    assert run([*base, "serve", "--host", "::1", "--port", "8470"]) == 1
    assert "::1" in capsys.readouterr().err and seen["port"] is None


def test_bind_rejects_out_of_range_and_busy():
    import socket
    assert cli._bind("127.0.0.1", 65536) is None and cli._bind("127.0.0.1", 0) is None
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        assert cli._bind("127.0.0.1", s.getsockname()[1]) is None


def test_browser_opens_only_once_started(monkeypatch):
    import threading
    import webbrowser
    opened = threading.Event()
    monkeypatch.setattr(webbrowser, "open", lambda url: opened.set())

    class Server:
        started = False
        should_exit = False
    srv = Server()
    cli._open_when_started(srv, "http://localhost:1/")
    assert not opened.wait(.3)
    srv.started = True
    assert opened.wait(2)


def test_probe_nothing_there():
    assert cli._probe("127.0.0.1", free_port()) is None


def test_health_names_the_instance(tmp_path):
    from fastapi.testclient import TestClient
    from lichtjahr.api import create_app
    from lichtjahr.config import Settings
    st = Settings.default(str(tmp_path / "d"), str(tmp_path / "c"))
    assert TestClient(create_app(st), base_url="http://localhost").get("/api/health").json()["instance"] == st.instance


def test_default_dirs_per_platform(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "AppData" / "Local"))
    for var in ("XDG_DATA_HOME", "XDG_CACHE_HOME"):
        monkeypatch.delenv(var, raising=False)
    n = os.path.normpath                                                  # Trenner wie auf dem jeweiligen System
    data, cache = config.default_dirs("darwin")
    assert n(data) == str(tmp_path / "Library" / "Application Support" / "Lichtjahr")
    assert n(cache) == str(tmp_path / "Library" / "Caches" / "Lichtjahr")
    data, cache = config.default_dirs("win32")
    assert data == os.path.join(str(tmp_path / "AppData" / "Local"), "Lichtjahr")
    assert cache == os.path.join(data, "Cache")
    assert n(config.default_dirs("linux")[0]) == str(tmp_path / ".local" / "share" / "lichtjahr")
    # Wer den alten Ordner schon hat, behält ihn
    (tmp_path / ".local" / "share" / "lichtjahr").mkdir(parents=True)
    assert n(config.default_dirs("darwin")[0]) == str(tmp_path / ".local" / "share" / "lichtjahr")


def test_windows_locale_counts_as_german():
    assert pick("German_Germany") == "de"
    assert pick("English_United States") == "en"
