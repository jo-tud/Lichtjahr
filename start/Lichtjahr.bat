@echo off
rem Lichtjahr starten (Windows). Im Release-Ordner liegt diese Datei neben dem Paket lichtjahr-*.whl;
rem im Repository nimmt sie den Dienst aus backend\ und die Oberflaeche aus prototyp\dist.
rem Benoetigt wird nur uv (https://docs.astral.sh/uv/): es richtet Python und alle Pakete im Benutzerordner ein.
rem Weitere Angaben werden an "lichtjahr serve" durchgereicht, z. B. --host 0.0.0.0 fuer das Handy.
rem Texte ohne Umlaute, damit sie in jeder Konsole lesbar bleiben.
setlocal
set "HERE=%~dp0"
set "PATH=%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin;%PATH%"
set "DE="
for /f %%l in ('powershell -NoProfile -Command "(Get-Culture).TwoLetterISOLanguageName" 2^>nul') do if /i "%%l"=="de" set "DE=1"

where uv >nul 2>nul
if not errorlevel 1 goto have_uv
if defined DE (
  echo Lichtjahr braucht einmalig das Hilfsprogramm uv ^(von Astral^). Es richtet Python und alles Weitere
  echo fuer Lichtjahr in deinem Benutzerordner ein; systemweit wird nichts installiert.
  set /p "ANSWER=uv jetzt installieren? [J/n] "
) else (
  echo Lichtjahr needs the helper program uv ^(by Astral^) once. It sets up Python and everything else
  echo for Lichtjahr in your user folder; nothing is installed system-wide.
  set /p "ANSWER=Install uv now? [Y/n] "
)
if /i "%ANSWER%"=="n" goto cancelled
if /i "%ANSWER%"=="nein" goto cancelled
if /i "%ANSWER%"=="no" goto cancelled
powershell -NoProfile -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
where uv >nul 2>nul
if errorlevel 1 goto failed

:have_uv
set "FROM="
set "STATIC="
set "REFRESH="
for %%f in ("%HERE%lichtjahr-*.whl") do set "FROM=%%~ff"
if defined FROM goto start
if not exist "%HERE%..\backend\pyproject.toml" goto missing
set "FROM=%HERE%..\backend"
set "STATIC=--static "%HERE%..\prototyp\dist""
rem im Repository: geaenderten Code jedes Mal neu bauen
set "REFRESH=--reinstall-package lichtjahr"

:start
if defined DE (echo Lichtjahr startet. Beim ersten Mal werden etwa 150 MB geladen, das dauert ein paar Minuten.) else (echo Starting Lichtjahr. The first start downloads about 150 MB and takes a few minutes.)
uvx --python 3.12 %REFRESH% --from "%FROM%" --with pillow-heif lichtjahr serve %STATIC% %*
goto done

:cancelled
if defined DE (echo Abgebrochen. uv selbst installieren: https://docs.astral.sh/uv/) else (echo Cancelled. To install uv yourself: https://docs.astral.sh/uv/)
goto done

:failed
if defined DE (echo uv liess sich nicht installieren. Bitte selbst installieren: https://docs.astral.sh/uv/) else (echo uv could not be installed. Please install it yourself: https://docs.astral.sh/uv/)
goto done

:missing
if defined DE (echo Das Lichtjahr-Paket ^(lichtjahr-*.whl^) fehlt neben dieser Datei.) else (echo The Lichtjahr package ^(lichtjahr-*.whl^) is missing next to this file.)

:done
pause
endlocal
