@echo off
title xcmod Admin
echo Starting xcmod with admin privileges...
cd /d "%~dp0"

set "electron_path=%~dp0node_modules\electron\dist\electron.exe"
set "i18next_path=%~dp0node_modules\i18next\index.js"

if not exist "%electron_path%" (
    echo Electron not found. Installing dependencies...
    npm install
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies.
        echo Please check if Node.js is installed and npm is available.
        pause
        exit /b 1
    )
    echo Dependencies installed successfully.
) else (
    echo Dependencies already installed.
)

if not exist "%electron_path%" (
    echo ERROR: Electron still not found after installation.
    echo Path: %electron_path%
    pause
    exit /b 1
)

powershell -Command "Start-Process -FilePath '%electron_path%' -ArgumentList '%~dp0.' -Verb RunAs -WorkingDirectory '%~dp0'"