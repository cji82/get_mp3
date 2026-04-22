const DEFAULT_SERVER = 'http://127.0.0.1:38472';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATUS_POLL_INTERVAL_MS = 1000;
const activePolls = new Map(); // key(url|quality|format) -> Promise<{ok:boolean,error?:string}>

async function notifyProgress(tabId, payload) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'CONVERT_PROGRESS', ...payload });
  } catch (_) {
    // 탭 이동/새로고침으로 수신자가 사라진 경우는 무시
  }
}

function normalizeFormat(format) {
  return (format || '').toString().toLowerCase() === 'm4a' ? 'm4a' : 'mp3';
}

function makePollKey(url, quality, format) {
  return `${url}::${quality}::${normalizeFormat(format)}`;
}

async function pollJobUntilDone({ base, jobId, tabId }) {
  let transientFailCount = 0;
  for (;;) {
    await sleep(STATUS_POLL_INTERVAL_MS);
    let statusRes;
    let statusData;
    try {
      statusRes = await fetch(`${base}/convert/status/${encodeURIComponent(jobId)}`);
      statusData = await statusRes.json();
    } catch (_) {
      transientFailCount += 1;
      if (transientFailCount >= 10) {
        return { ok: false, error: '상태 조회 연결이 끊겼습니다. 서버 상태를 확인해 주세요.' };
      }
      continue;
    }
    transientFailCount = 0;
    if (!statusRes.ok) return { ok: false, error: statusData.error || statusRes.statusText };
    await notifyProgress(tabId, {
      status: statusData.status,
      progress: statusData.progress,
      message: statusData.message
    });

    if (statusData.status === 'done') {
      if (!statusData.downloadUrl) {
        return { ok: false, error: '변환 완료 상태지만 다운로드 URL이 아직 준비되지 않았습니다. 다시 시도해 주세요.' };
      }
      return { ok: true, downloadUrl: statusData.downloadUrl };
    }
    if (statusData.status === 'error') {
      return { ok: false, error: statusData.error || '변환 실패' };
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'CONVERT_MP3' && msg.type !== 'RESUME_MP3') {
    sendResponse({ ok: false, error: 'Unknown message' });
    return true;
  }
  (async () => {
    try {
      const { serverUrl = DEFAULT_SERVER, audioQuality = 0 } = await chrome.storage.local.get(['serverUrl', 'audioQuality']);
      const base = (serverUrl || DEFAULT_SERVER).replace(/\/$/, '');
      const q = Math.min(9, Math.max(0, parseInt(msg.quality, 10) || parseInt(audioQuality, 10) || 0));
      const format = normalizeFormat(msg.format);
      const tabId = sender?.tab?.id;
      const key = makePollKey(msg.youtubeUrl, q, format);

      if (msg.type === 'RESUME_MP3') {
        const activeRes = await fetch(`${base}/convert/active?url=${encodeURIComponent(msg.youtubeUrl)}`);
        const activeData = await activeRes.json();
        if (!activeRes.ok) return { ok: false, error: activeData.error || activeRes.statusText };
        if (!activeData.jobId) return { ok: true, resumed: false };
        const activeQ = Math.min(9, Math.max(0, parseInt(activeData.quality, 10) || 0));
        const activeFormat = normalizeFormat(activeData.format);
        const activeKey = makePollKey(msg.youtubeUrl, activeQ, activeFormat);
        await notifyProgress(tabId, {
          status: activeData.status,
          progress: activeData.progress,
          message: activeData.message
        });
        if (!activePolls.has(activeKey)) {
          activePolls.set(activeKey, pollJobUntilDone({ base, jobId: activeData.jobId, tabId }).finally(() => activePolls.delete(activeKey)));
        }
        return { ok: true, resumed: true };
      }

      let downloadUrl = null;
      const startRes = await fetch(`${base}/convert/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: msg.youtubeUrl, quality: q, format })
      });
      if (!startRes.ok) {
        // 구버전 서버 호환: 단건 변환 API로 폴백
        const fallbackRes = await fetch(`${base}/convert?url=${encodeURIComponent(msg.youtubeUrl)}&quality=${q}&format=${format}`);
        const fallbackData = await fallbackRes.json();
        if (!fallbackRes.ok) {
          return { ok: false, error: fallbackData.error || fallbackRes.statusText };
        }
        downloadUrl = fallbackData.downloadUrl;
      } else {
        const startData = await startRes.json();
        if (!startData.jobId) return { ok: false, error: '작업 시작 실패' };
        await notifyProgress(tabId, { status: 'queued', progress: 0, message: '대기 중' });
        if (!activePolls.has(key)) {
          activePolls.set(key, pollJobUntilDone({ base, jobId: startData.jobId, tabId }).finally(() => activePolls.delete(key)));
        }
        const result = await activePolls.get(key);
        if (!result?.ok) return result || { ok: false, error: '변환 실패' };
        downloadUrl = result.downloadUrl;
      }

      if (!downloadUrl) {
        return { ok: false, error: '서버 응답 오류(다운로드 URL 없음)' };
      }
      const safe = (s) => (s || '').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'audio';
      const ext = normalizeFormat(format);
      const filename = `${safe(msg.title || '')}.${ext}`;
      await notifyProgress(tabId, { status: 'done', progress: 100, message: '저장 중' });
      await chrome.downloads.download({ url: downloadUrl, filename });
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
