@echo off
setlocal
cd /d "%~dp0"
node scripts\zigbee-launcher.mjs
if errorlevel 1 pause
