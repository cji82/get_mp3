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

  const createButton = () => {
    const btn = document.createElement('button');
    btn.id = 'get-mp3-btn';
    btn.type = 'button';
    btn.textContent = 'MP3 저장';
    btn.className = 'get-mp3-btn';
    btn.addEventListener('click', async () => {
      const url = getVideoUrl();
      if (!url || !/youtube\.com\/watch|youtu\.be\//.test(url)) {
        alert('유튜브 재생 페이지에서만 사용할 수 있습니다.');
        return;
      }
      const title = getVideoTitle();
      btn.disabled = true;
      btn.textContent = '변환 중…';
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'CONVERT_MP3',
          youtubeUrl: url,
          title: title
        });
        if (res && res.ok) {
          btn.textContent = '저장됨';
          setTimeout(() => { btn.textContent = 'MP3 저장'; }, 2000);
        } else {
          alert(res?.error || '변환 실패');
          btn.textContent = 'MP3 저장';
        }
      } catch (e) {
        const msg = e?.message || '';
        if (msg.includes('Extension context invalidated') || msg.includes('context invalidated')) {
          alert('확장 프로그램이 새로고침된 상태입니다. 이 페이지를 새로 고침(F5)한 뒤 다시 시도해 주세요.');
        } else {
          alert(msg || '확장 프로그램 오류');
        }
        btn.textContent = 'MP3 저장';
      }
      btn.disabled = false;
    });
    return btn;
  };

  const inject = () => {
    if (document.getElementById('get-mp3-btn')) return;
    const titleEl = getTitleEl();
    if (!titleEl) return;
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
  };

  const run = () => {
    inject();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  const observer = new MutationObserver(() => {
    if (!document.getElementById('get-mp3-btn')) run();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
