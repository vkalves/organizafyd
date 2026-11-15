@echo off
rem Batch / install-requirements.cmd / Windows 10 x64 / companion dependency installer
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-requirements.ps1"
set "install_result=%ERRORLEVEL%"
echo.
if "%install_result%"=="0" (
  echo Installation finished. Open start-appium.cmd, then start.cmd.
) else (
  echo Installation stopped. Read the message above, fix it, then run this file again.
)
pause
exit /b %install_result%
