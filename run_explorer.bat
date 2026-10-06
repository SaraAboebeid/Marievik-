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
start "" http://127.0.0.1:8020
python -m explorer.server %*
