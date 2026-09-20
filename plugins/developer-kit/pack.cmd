@echo off
setlocal
if "%~1"=="" (
  echo Drag a plugin folder onto this file.
  pause
  exit /b 1
)
node "%~dp0lx-plugin.cjs" pack "%~1"
set "lx_plugin_result=%errorlevel%"
pause
exit /b %lx_plugin_result%
