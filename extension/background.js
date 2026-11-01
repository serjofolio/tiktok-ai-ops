// 代替页面请求运营台接口（带 API 令牌），避免跨域限制
const cfg = () => chrome.storage.sync.get({ server: '', token: '' });

async function call(path, { method = 'GET', body } = {}) {
  const { server, token } = await cfg();
  if (!server || !token) throw new Error('请先点浏览器右上角的插件图标，填写运营台地址和 API 令牌');
  const res = await fetch(server.replace(/\/+$/, '') + '/api' + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败 (' + res.status + ')');
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'api') return;
  call(msg.path, msg)
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: e.message }));
  return true;
});
