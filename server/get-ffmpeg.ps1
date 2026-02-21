# server 폴더에 ffmpeg.exe, ffprobe.exe 다운로드 후 압축 해제
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$zip = Join-Path $dir "ffmpeg.zip"
$url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-02-21-13-00/ffmpeg-N-122924-g3be4545b67-win64-gpl.zip"

Write-Host "ffmpeg 다운로드 중..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host "압축 해제 중..."
$extract = Join-Path $dir "ffmpeg_extract"
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $extract -Force

$subdir = Get-ChildItem $extract -Directory | Select-Object -First 1
Copy-Item (Join-Path $subdir.FullName "bin\ffmpeg.exe") (Join-Path $dir "ffmpeg.exe") -Force
Copy-Item (Join-Path $subdir.FullName "bin\ffprobe.exe") (Join-Path $dir "ffprobe.exe") -Force

Remove-Item $extract -Recurse -Force
Remove-Item $zip -Force
Write-Host "완료: ffmpeg.exe, ffprobe.exe 가 $dir 에 있습니다."
pause
