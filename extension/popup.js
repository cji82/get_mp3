const select = document.getElementById('quality');
const serverInput = document.getElementById('server');

chrome.storage.local.get(['audioQuality', 'serverUrl'], (o) => {
  const v = (o.audioQuality !== undefined ? o.audioQuality : 0).toString();
  if (select.querySelector(`option[value="${v}"]`)) select.value = v;
  serverInput.value = o.serverUrl || 'http://127.0.0.1:38472';
});

select.addEventListener('change', () => {
  chrome.storage.local.set({ audioQuality: parseInt(select.value, 10) });
});
serverInput.addEventListener('change', () => {
  const url = (serverInput.value || '').trim().replace(/\/$/, '') || 'http://127.0.0.1:38472';
  chrome.storage.local.set({ serverUrl: url });
});
