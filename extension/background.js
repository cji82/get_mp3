const DEFAULT_SERVER = 'http://127.0.0.1:38472';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'CONVERT_MP3') {
    sendResponse({ ok: false, error: 'Unknown message' });
    return true;
  }
  (async () => {
    try {
      const { serverUrl = DEFAULT_SERVER, audioQuality = 0 } = await chrome.storage.local.get(['serverUrl', 'audioQuality']);
      const base = (serverUrl || DEFAULT_SERVER).replace(/\/$/, '');
      const q = Math.min(9, Math.max(0, parseInt(audioQuality, 10) || 0));
      const res = await fetch(`${base}/convert?url=${encodeURIComponent(msg.youtubeUrl)}&quality=${q}`);
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || res.statusText };
      }
      if (!data.downloadUrl) {
        return { ok: false, error: '서버 응답 오류' };
      }
      const safe = (s) => (s || '').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'audio';
      const filename = `${safe(msg.title || '')}.mp3`;
      await chrome.downloads.download({ url: data.downloadUrl, filename });
      return { ok: true };
    } catch (e) {
      const msg = (e && e.message) || '요청 실패';
      const hint = msg === 'Failed to fetch' || msg.includes('fetch')
        ? '서버가 꺼져 있거나 연결할 수 없습니다. 터미널에서 server 폴더로 가서 npm start 로 서버를 켜 주세요. (포트 38472)'
        : msg;
      return { ok: false, error: hint };
    }
  })().then(sendResponse);
  return true;
});
