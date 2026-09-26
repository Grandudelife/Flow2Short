@echo off
setlocal enabledelayedexpansion
set "APP_DIR=%~dp0app"
set "PORT=43121"

where py >nul 2>nul
if %errorlevel%==0 (
  set "PORT="
  for /f %%P in ('py -3 "%~dp0server\select_port.py"') do set "PORT=%%P"
  if not defined PORT goto no_port
  start "" "http://127.0.0.1:!PORT!/"
  py -3 "%~dp0server\local_server.py" !PORT! "%APP_DIR%"
  exit /b
)

where python >nul 2>nul
if %errorlevel%==0 (
  set "PORT="
  for /f %%P in ('python "%~dp0server\select_port.py"') do set "PORT=%%P"
  if not defined PORT goto no_port
  start "" "http://127.0.0.1:!PORT!/"
  python "%~dp0server\local_server.py" !PORT! "%APP_DIR%"
  exit /b
)

echo Python 3 was not found. Use the GitHub Pages version or install Python 3.
pause
exit /b

:no_port
echo No available localhost port for Flow2Short. Close an older launcher and try again.
pause
