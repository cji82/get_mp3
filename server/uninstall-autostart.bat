@echo off
chcp 65001 >nul
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

set "REMOVED=0"
if exist "%STARTUP%\GetMP3-Server.lnk" (del /Q "%STARTUP%\GetMP3-Server.lnk" & set "REMOVED=1")
if exist "%STARTUP%\GetMP3-Server.vbs" (del /Q "%STARTUP%\GetMP3-Server.vbs" & set "REMOVED=1")
if "%REMOVED%"=="1" (echo 자동 시작 등록을 해제했습니다.) else (echo 등록된 자동 시작 항목이 없습니다.)
echo.
pause
