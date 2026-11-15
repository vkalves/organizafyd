@echo off
rem Batch / start.cmd / Windows 10 / Python 3.11+ companion
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Install Python 3.12 from https://www.python.org/downloads/windows/ including the Python launcher.
  pause
  exit /b 1
)
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)"
if errorlevel 1 (
  echo Python 3.11 or newer is required.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" py -3 -m venv .venv
if not exist ".venv\Scripts\python.exe" goto failed
if exist ".venv\zyon-ready-v1" goto run
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -c "from pathlib import Path; Path('.venv/zyon-ready-v1').touch()"
:run
".venv\Scripts\python.exe" -m zyon.server
if errorlevel 1 goto failed
exit /b 0
:failed
echo Companion could not start. Check the messages above and desktop\README.md.
pause
exit /b 1
