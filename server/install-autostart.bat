@echo off
chcp 65001 >nul
set "SERVER_DIR=%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%SERVER_DIR%start-server.vbs"

echo Get MP3 서버를 Windows 시작 시 자동 실행하도록 등록합니다.
echo.
echo 다음 위치에 바로가기를 만듭니다:
echo %STARTUP%
echo.

powershell -NoProfile -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%STARTUP%\GetMP3-Server.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%VBS%\"'; $s.WorkingDirectory='%SERVER_DIR%'; $s.WindowStyle=7; $s.Save()"
if exist "%STARTUP%\GetMP3-Server.lnk" (
  echo 등록 완료. 다음 로그인부터 서버가 자동으로 실행됩니다.
) else (
  echo 등록 실패. 수동으로 %STARTUP% 에 가서
  echo start-server.vbs 를 복사해 두어도 됩니다.
)
echo.
pause
