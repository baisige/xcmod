@echo off
title xcmod
echo 正在启动 xcmod...
cd /d "%~dp0"
"%~dp0node_modules\electron\dist\electron.exe" .
pause