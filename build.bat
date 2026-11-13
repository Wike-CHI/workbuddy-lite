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

echo [*] compiling resources...
rc /nologo /fo bin\obj\app.res src\app.rc
if errorlevel 1 (
  echo [x] resource compile failed
  exit /b 1
)

echo [*] compiling...
cl /nologo /std:c++17 /EHsc /O2 /MD /utf-8 /W3 /wd4996 ^
  /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_CRT_SECURE_NO_WARNINGS ^
  /I third_party /I third_party\webview2\include /I src ^
  src\common.cpp src\agent_host.cpp src\acp_client.cpp src\normalize.cpp src\catalog.cpp src\backend.cpp src\main.cpp ^
  bin\obj\app.res ^
  /Fo:bin\obj\ /Fe:bin\workbuddy-lite.exe ^
  /link /SUBSYSTEM:WINDOWS /LIBPATH:third_party\webview2\lib\x64 ^
  WebView2LoaderStatic.lib user32.lib gdi32.lib gdiplus.lib ole32.lib oleaut32.lib advapi32.lib ^
  shell32.lib shlwapi.lib version.lib ws2_32.lib comctl32.lib

if errorlevel 1 (
  echo [x] build failed
  exit /b 1
)

if exist web (
  if exist bin\web rmdir /s /q bin\web
  xcopy /e /i /q web bin\web >nul
)
echo [+] done: bin\workbuddy-lite.exe
