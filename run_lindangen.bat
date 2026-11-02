@echo off
rem Marievik+ Explorer opened on Lindängen (Malmö). The same server as run_explorer.bat serves every project:
rem ?project=lindangen picks parametric/site/lindangen_site.json. If the server is already running, just open the link.
cd /d "%~dp0"
set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
start "" "http://127.0.0.1:8020/explorer?project=lindangen"
"%PY%" -m explorer.server %*
