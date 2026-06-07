@echo off
cd /d "%~dp0"
start "FileFlow Converter API" /MIN cmd /k "python server.py"
start "FileFlow App" /MIN cmd /k "%~dp0run-fileflow.cmd"
echo FileFlow app: http://127.0.0.1:5180
echo Converter API: http://127.0.0.1:8765/health
