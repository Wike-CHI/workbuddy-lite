@echo off
setlocal
cd /d "%~dp0"

set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  echo [x] vcvars64.bat not found. Install Visual Studio 2022 C++ toolchain.
  exit /b 1
)

if not exist bin mkdir bin
if not exist bin\obj mkdir bin\obj

call "%VCVARS%" >nul
if errorlevel 1 exit /b 1

echo [*] compiling updater...
cl /nologo /std:c++17 /EHsc /O2 /MD /utf-8 /W3 ^
  /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_CRT_SECURE_NO_WARNINGS ^
  src\updater_main.cpp ^
  /Fo:bin\obj\ /Fe:bin\workbuddy-updater.exe ^
  /link /SUBSYSTEM:CONSOLE shell32.lib

if errorlevel 1 (
  echo [x] updater build failed
  exit /b 1
)
echo [+] done: bin\workbuddy-updater.exe
