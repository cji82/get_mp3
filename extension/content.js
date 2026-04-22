(function () {
  const TITLE_SELECTORS = [
    'h1.ytd-video-primary-info-renderer',
    'ytd-video-primary-info-renderer h1',
    '#title h1',
    'ytd-watch-metadata h1'
  ];

  const getVideoUrl = () => window.location.href.replace(/#.*$/, '').trim();

  const getTitleEl = () => {
    for (const sel of TITLE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent) return el;
    }
    return null;
  };

  const getVideoTitle = () => {
    const h1 = getTitleEl();
    return (h1 && h1.textContent && h1.textContent.trim()) || '';
  };
  const DOWNLOAD_OPTIONS = [
    { label: '빠른 저장 (M4A, 매우 빠름)', format: 'm4a', quality: 0, speedFactor: 0.06, baseSec: 8 },
    { label: 'MP3 저장 (고음질, 320k)', format: 'mp3', quality: 0, speedFactor: 0.30, baseSec: 20 },
    { label: 'MP3 저장 (보통, 약 160k)', format: 'mp3', quality: 5, speedFactor: 0.20, baseSec: 16 },
    { label: 'MP3 저장 (저음질, 약 64k)', format: 'mp3', quality: 9, speedFactor: 0.14, baseSec: 12 }
  ];
  const ESTIMATE_PROFILE_KEY = 'estimateProfilesV1';
  const estimateProfiles = {};
  chrome.storage.local.get([ESTIMATE_PROFILE_KEY], (o) => {
    const saved = o && o[ESTIMATE_PROFILE_KEY];
    if (!saved || typeof saved !== 'object') return;
    for (const k of Object.keys(saved)) estimateProfiles[k] = saved[k];
  });

  const getOptionKey = (option) => `${option.format}:${option.quality}`;
  const cpuCores = Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
  const deviceMemoryGb = Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : 4;

  const getHardwareScore = () => {
    // 대략적인 상대 성능 점수(1.0 기준: 보통 PC)
    const coreScore = Math.max(0.6, Math.min(2.2, cpuCores / 8));
    const memScore = Math.max(0.8, Math.min(1.5, deviceMemoryGb / 8));
    return coreScore * memScore;
  };

  const getHardwareBaseFactor = (option) => {
    // 1시간 영상 처리 시 소요 비율(소요시간/영상시간)의 초기 추정치
    const score = getHardwareScore();
    if (option.format === 'm4a') return Math.max(0.003, 0.010 / score);
    if (option.quality === 0) return Math.max(0.006, 0.024 / score); // MP3 고음질
    if (option.quality === 5) return Math.max(0.005, 0.019 / score); // MP3 보통
    return Math.max(0.004, 0.015 / score); // MP3 저음질
  };

  const getVideoDurationSec = () => {
    const video = document.querySelector('video');
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return null;
    return Math.floor(video.duration);
  };

  const formatEta = (sec) => {
    const s = Math.max(1, Math.round(sec));
    if (s < 60) return `${s}초`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return r > 0 ? `${m}분 ${r}초` : `${m}분`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}시간 ${rm}분` : `${h}시간`;
  };

  const getEstimateFactor = (option) => {
    const key = getOptionKey(option);
    const saved = estimateProfiles[key];
    if (saved && Number.isFinite(saved.factor) && saved.factor > 0) return saved.factor;
    return getHardwareBaseFactor(option);
  };

  const formatEtaRange = (etaSec, samples = 0) => {
    // 학습 데이터가 쌓일수록 범위를 좁힌다.
    let minMul = 0.75;
    let maxMul = 1.45;
    if (samples >= 1) { minMul = 0.82; maxMul = 1.28; }
    if (samples >= 3) { minMul = 0.88; maxMul = 1.18; }
    if (samples >= 6) { minMul = 0.92; maxMul = 1.12; }
    const minSec = Math.max(1, Math.round(etaSec * minMul));
    const maxSec = Math.max(minSec + 1, Math.round(etaSec * maxMul));
    return `${formatEta(minSec)}~${formatEta(maxSec)}`;
  };

  const buildOptionText = (option, durationSec) => {
    if (!durationSec) return `${option.label} · 예상: 계산 중`;
    const factor = getEstimateFactor(option);
    const eta = option.baseSec + (durationSec * factor);
    const key = getOptionKey(option);
    const samples = estimateProfiles[key]?.samples || 0;
    const hint = samples > 0 ? '학습' : '초기';
    return `${option.label} · 예상: ${formatEtaRange(eta, samples)} (${hint})`;
  };

  const formatProgressText = (status, progress, message) => {
    if (status === 'queued') return '대기 중…';
    if (status === 'running') {
      if (typeof progress === 'number' && Number.isFinite(progress)) {
        if (message) return `${Math.floor(progress)}% · ${message}`;
        return `변환 중 ${Math.floor(progress)}%`;
      }
      return message || '변환 중…';
    }
    if (status === 'done') return '저장 중…';
    if (status === 'error') return '실패';
    return message || '변환 중…';
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'CONVERT_PROGRESS') return;
    const btn = document.getElementById('get-mp3-btn');
    if (!btn) return;
    btn.textContent = formatProgressText(msg.status, msg.progress, msg.message);
  });

  const createButton = () => {
    const wrap = document.createElement('div');
    wrap.className = 'get-mp3-menu-wrap';
    const btn = document.createElement('button');
    btn.id = 'get-mp3-btn';
    btn.type = 'button';
    btn.textContent = '다운로드';
    btn.className = 'get-mp3-btn';
    const menu = document.createElement('div');
    menu.className = 'get-mp3-menu';
    menu.hidden = true;
    let busy = false;

    const setIdle = () => {
      busy = false;
      btn.disabled = false;
      btn.textContent = '다운로드';
      menu.hidden = true;
    };

    const startDownload = async (option) => {
      const url = getVideoUrl();
      const durationSec = getVideoDurationSec();
      if (!url || !/youtube\.com\/watch|youtu\.be\//.test(url)) {
        alert('유튜브 재생 페이지에서만 사용할 수 있습니다.');
        return;
      }
      const title = getVideoTitle();
      const startedAt = Date.now();
      busy = true;
      btn.disabled = true;
      btn.textContent = '요청 중…';
      menu.hidden = true;
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'CONVERT_MP3',
          youtubeUrl: url,
          title,
          quality: option.quality,
          format: option.format
        });
        if (res && res.ok) {
          if (durationSec && durationSec > 0) {
            const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
            const observedFactor = elapsedSec / durationSec;
            const key = getOptionKey(option);
            const prev = estimateProfiles[key];
            const prevFactor = (prev && Number.isFinite(prev.factor) && prev.factor > 0) ? prev.factor : getHardwareBaseFactor(option);
            const prevSamples = prev?.samples || 0;
            // 초기에는 새 관측치 반영을 크게, 이후 점진적으로 완만하게.
            const alpha = prevSamples === 0 ? 0.9 : (prevSamples < 3 ? 0.65 : 0.35);
            const nextFactor = (prevFactor * (1 - alpha)) + (observedFactor * alpha);
            const nextSamples = (prev?.samples || 0) + 1;
            estimateProfiles[key] = { factor: nextFactor, samples: nextSamples };
            chrome.storage.local.set({ [ESTIMATE_PROFILE_KEY]: estimateProfiles });
          }
          btn.textContent = '저장됨';
          setTimeout(() => setIdle(), 1500);
        } else {
          alert(res?.error || '변환 실패');
          setIdle();
        }
      } catch (e) {
        const msg = e?.message || '';
        if (msg.includes('Extension context invalidated') || msg.includes('context invalidated')) {
          alert('확장 프로그램이 새로고침된 상태입니다. 이 페이지를 새로 고침(F5)한 뒤 다시 시도해 주세요.');
        } else {
          alert(msg || '확장 프로그램 오류');
        }
        setIdle();
      }
    };

    const menuItems = [];
    DOWNLOAD_OPTIONS.forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'get-mp3-menu-item';
      item.textContent = option.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (busy) return;
        startDownload(option);
      });
      menu.appendChild(item);
      menuItems.push({ item, option });
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (busy) return;
      const durationSec = getVideoDurationSec();
      menuItems.forEach(({ item, option }) => {
        item.textContent = buildOptionText(option, durationSec);
      });
      menu.hidden = !menu.hidden;
    });

    document.addEventListener('click', () => {
      if (!busy) menu.hidden = true;
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  };

  const isWatchPage = () => /youtube\.com\/watch|youtu\.be\//.test(window.location.href);

  const inject = () => {
    if (document.getElementById('get-mp3-btn')) return true;
    const titleEl = getTitleEl();
    if (!titleEl) return false;
    const row = document.createElement('div');
    row.id = 'get-mp3-wrap';
    row.className = 'get-mp3-wrap';
    row.style.display = 'flex';
    row.style.flexWrap = 'nowrap';
    row.style.alignItems = 'center';
    row.style.gap = '12px';
    titleEl.parentNode.insertBefore(row, titleEl);
    row.appendChild(titleEl);
    row.appendChild(createButton());
    return true;
  };

  const run = () => {
    if (!isWatchPage()) return;
    if (inject()) return;
    retryInject();
  };

  const MAX_RETRIES = 25;
  const RETRY_MS = 400;
  let retryCount = 0;
  function retryInject() {
    if (document.getElementById('get-mp3-btn') || retryCount >= MAX_RETRIES) return;
    retryCount += 1;
    setTimeout(() => {
      if (inject()) { retryCount = 0; return; }
      retryInject();
    }, RETRY_MS);
  }

  const runOrRetry = () => {
    retryCount = 0;
    run();
  };

  const requestResume = () => {
    const url = getVideoUrl();
    if (!url || !/youtube\.com\/watch|youtu\.be\//.test(url)) return;
    chrome.runtime.sendMessage({ type: 'RESUME_MP3', youtubeUrl: url }).catch(() => {});
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runOrRetry);
  } else {
    runOrRetry();
  }
  setTimeout(requestResume, 500);
  const observer = new MutationObserver(() => {
    if (isWatchPage() && !document.getElementById('get-mp3-btn')) runOrRetry();
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  setInterval(() => {
    if (isWatchPage() && !document.getElementById('get-mp3-btn')) runOrRetry();
  }, 1500);
})();
