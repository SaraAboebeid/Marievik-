@echo off
rem Marievik+ Explorer - starts the server and opens the browser.
cd /d "%~dp0"
if not exist "explorer\web\dist\index.html" (
  echo The web app is not built yet. Building it now ^(needs Node.js^)...
  pushd explorer\web
  call npm install
  call npm run build
  popd
)
rem Use the project's virtual environment (see Setup in README.md) if there is one.
set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
start "" http://127.0.0.1:8020
"%PY%" -m explorer.server %*
