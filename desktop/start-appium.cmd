@echo off
rem Batch / start-appium.cmd / Windows 10 / loopback Appium with isolated runtime
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -Mode Appium
if errorlevel 1 pause
