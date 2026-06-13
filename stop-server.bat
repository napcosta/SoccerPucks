@echo off
cd /d "%~dp0"
echo Stopping stuck Python servers on port 8000...
powershell -NoProfile -Command "Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"
echo Done. You can now run serve.bat
pause
