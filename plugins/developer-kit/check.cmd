@echo off
setlocal
if "%~1"=="" (
  echo Drag a plugin folder or ZIP onto this file.
  pause
  exit /b 1
)
node "%~dp0lx-plugin.cjs" check "%~1"
set "lx_plugin_result=%errorlevel%"
pause
exit /b %lx_plugin_result%
