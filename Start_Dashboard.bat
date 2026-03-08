@echo off
title Guard Backbone Launcher
echo Starting Guard Backbone GUI...
powershell -ExecutionPolicy Bypass -File "./launch_gui.ps1"
if %errorlevel% neq 0 pause
