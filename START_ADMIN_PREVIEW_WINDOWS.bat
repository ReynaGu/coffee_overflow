@echo off
cd /d "%~dp0"
echo Coffee Overflow: Hudson admin PREVIEW (sample data only)
echo This preview does not connect to your team's database.
echo.
start "Admin Preview Server" /MIN cmd /k "node admin\preview-server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173/admin/"
echo Preview opened. Close the minimized server window to stop it.
