@echo off
setlocal
cd /d "%~dp0frontend"

if not exist node_modules (
  echo [*] installing frontend dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo [*] building frontend...
call npm run build
if errorlevel 1 exit /b 1

echo [+] done: web\
