@echo off
setlocal DisableDelayedExpansion
if not "%~1"=="" goto explicit
python -I -S -c "import sys; sys.exit(0 if sys.implementation.name == 'cpython' and (3,10) <= sys.version_info[:2] <= (3,14) else 1)" >nul 2>nul
if errorlevel 1 goto launcher
python -I -S "%~dp0build.py"
exit /b %errorlevel%
:launcher
py -3 -I -S -c "import sys; sys.exit(0 if sys.implementation.name == 'cpython' and (3,10) <= sys.version_info[:2] <= (3,14) else 1)" >nul 2>nul
if errorlevel 1 goto missing
py -3 -I -S "%~dp0build.py"
exit /b %errorlevel%
:explicit
if not exist "%~1" goto missing
"%~1" -I -S "%~dp0build.py"
exit /b %errorlevel%
:missing
echo Python 3.10 bis 3.14, x64, erforderlich. Embedded-Python wird unterstuetzt.
echo Aufruf: ERZEUGEN.cmd "C:\Pfad\zu\python.exe"
exit /b 1
