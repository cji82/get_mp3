const serverInput = document.getElementById('server');

chrome.storage.local.get(['serverUrl'], (o) => {
  serverInput.value = o.serverUrl || 'http://127.0.0.1:38472';
});

serverInput.addEventListener('change', () => {
  const url = (serverInput.value || '').trim().replace(/\/$/, '') || 'http://127.0.0.1:38472';
  chrome.storage.local.set({ serverUrl: url });
});
