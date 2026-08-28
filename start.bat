@echo off
setlocal EnableExtensions
cd /d "%~dp0"
node scripts\start-all.mjs
if errorlevel 1 pause
