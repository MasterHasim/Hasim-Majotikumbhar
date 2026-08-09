@echo off
setlocal
cd /d "C:\DP\Whats App Panel"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-WhatsApp-Panel.ps1"
endlocal
