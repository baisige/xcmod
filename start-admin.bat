@echo off
title xcmod Admin
echo Starting xcmod with admin privileges...
cd /d "%~dp0"

set "electron_path=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%electron_path%" (
    echo Electron not found at: %electron_path%
    echo Please run: npm install
    pause
    exit /b 1
)

powershell -Command "Start-Process -FilePath '%electron_path%' -ArgumentList '%~dp0.' -Verb RunAs -WorkingDirectory '%~dp0'"
