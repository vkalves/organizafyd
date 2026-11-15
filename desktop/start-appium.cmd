@echo off
rem Batch / start-appium.cmd / Windows 10 / loopback Appium
setlocal
cd /d "%~dp0"
if not exist "tools\node_modules\.bin\appium.cmd" (
  echo Run setup-appium.cmd first.
  pause
  exit /b 1
)
set "APPIUM_HOME=%LOCALAPPDATA%\ZyonCompanion\appium"
rem Bind only to loopback. Never enable debug logs or relaxed security.
call "tools\node_modules\.bin\appium.cmd" --address 127.0.0.1 --port 4723 --log-level error --log-no-colors
pause
