# Get MP3 – 유튜브 → MP3 크롬 확장

유튜브 재생 페이지에서 MP3로 저장하는 크롬 확장 + Node 백엔드.

## 요구사항

- Node.js 18+
- yt-dlp: 서버가 `server` 폴더의 yt-dlp.exe를 사용 (이미 있거나 [릴리스](https://github.com/yt-dlp/yt-dlp/releases)에서 받아 넣기)
- ffmpeg: `server` 폴더에서 **get-ffmpeg.ps1** 실행하면 ffmpeg.exe, ffprobe.exe 자동 다운로드

## 서버 실행

```bash
cd server
npm install
npm start
```

기본 주소: http://localhost:38472

### Windows 시작 시 자동 실행

- **등록:** `server` 폴더에서 `install-autostart.bat` 더블클릭 → 다음 로그인부터 서버가 자동 실행됩니다 (창 없이).
- **해제:** `uninstall-autostart.bat` 실행.

## 크롬 확장 설치

1. Chrome에서 `chrome://extensions` 열기
2. "개발자 모드" 켜기
3. "압축 해제된 확장 프로그램 로드" → `extension` 폴더 선택

## 사용법

1. 서버 실행 후 유튜브 영상 페이지 접속
2. 화면 오른쪽 아래 **MP3 저장** 버튼 클릭
3. 변환 완료 시 브라우저 기본 다운로드 폴더에 저장

팝업에서 **음질** 선택 가능 (고음질/보통/저용량).

## 디렉터리

- `server/` – Express API (yt-dlp 호출)
- `extension/` – 크롬 확장 (Manifest V3)
