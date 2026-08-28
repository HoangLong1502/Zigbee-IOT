@echo off
setlocal EnableExtensions
cd /d "%~dp0"
node scripts\stop-all.mjs
if errorlevel 1 pause
