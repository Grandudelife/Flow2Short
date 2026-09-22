@echo off
setlocal
set "APP_DIR=%~dp0app"
set "PORT=43121"

where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:%PORT%/"
  py -3 -m http.server %PORT% --bind 127.0.0.1 --directory "%APP_DIR%"
  exit /b
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:%PORT%/"
  python -m http.server %PORT% --bind 127.0.0.1 --directory "%APP_DIR%"
  exit /b
)

echo Python 3 was not found. Use the GitHub Pages version or install Python 3.
pause
