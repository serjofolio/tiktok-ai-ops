const $ = (id) => document.getElementById(id);
chrome.storage.sync.get({ server: self.DEFAULT_SERVER || '', token: '' }, (v) => {
  $('server').value = v.server;
  $('token').value = v.token;
});
$('save').onclick = () => {
  const server = $('server').value.trim().replace(/\/+$/, '');
  const token = $('token').value.trim();
  chrome.storage.sync.set({ server, token }, () => {
    $('msg').textContent = '测试中…';
    chrome.runtime.sendMessage({ type: 'api', path: '/ext/me' }, (r) => {
      $('msg').className = r?.ok ? 'ok' : 'err';
      $('msg').textContent = r?.ok ? `已连接：${r.data.user.username}` : r?.error || '连接失败';
    });
  });
};
