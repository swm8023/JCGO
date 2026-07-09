@echo off
setlocal
cd /d "%~dp0"
go run ./cmd/jcgo-deploy deploy
exit /b %ERRORLEVEL%
