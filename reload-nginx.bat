@echo off
setlocal

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reload-nginx.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [FAILED] Nginx reload did not complete. See the PowerShell output above.
  pause
)

exit /b %EXIT_CODE%
