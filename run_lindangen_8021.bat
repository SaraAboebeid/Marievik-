@echo off
rem Lindängen explorer on its own port (8021), so it can run beside a Marievik server already on 8020.
rem The same server code serves every project; ?project=lindangen picks parametric/site/lindangen_site.json.
cd /d "%~dp0"
set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
start "" "http://127.0.0.1:8021/explorer?project=lindangen"
"%PY%" -m explorer.server --port 8021 %*
