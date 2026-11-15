@echo off
rem Batch / start.cmd / Windows 10 / companion with isolated runtime
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -Mode Companion
if errorlevel 1 pause
