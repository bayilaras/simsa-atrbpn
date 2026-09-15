@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\local-runtime.ps1" -Action status
set "SIMSA_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %SIMSA_EXIT%
