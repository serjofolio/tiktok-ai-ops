const $ = (id) => document.getElementById(id);
const bg = (msg) => new Promise((resolve, reject) => chrome.runtime.sendMessage(msg, (r) => (r?.ok ? resolve(r.data) : reject(new Error(r?.error || '插件未连接运营台')))));
let items = [];

// 已连接：显示找货；没连接：展开连接设置
async function loadHunt() {
  try {
    const me = await bg({ type: 'api', path: '/ext/me' });
    $('msg').className = 'ok';
    $('msg').textContent = `已连接：${me.user.username}`;
    ({ items } = await bg({ type: 'api', path: '/ext/products' }));
    $('product').innerHTML = items.length
      ? items.map((p) => `<option value="${p.id}">【${p.verdict}】${p.name.slice(0, 36).replace(/</g, '&lt;')}${p.offers ? ` · 已有 ${p.offers} 个货源` : ''}</option>`).join('')
      : '<option value="">选品库里还没有「可以上 / 谨慎测试」的商品</option>';
    const { lastProduct } = await chrome.storage.local.get('lastProduct');
    if (items.some((p) => p.id === lastProduct)) $('product').value = lastProduct;
    syncKw();
    $('hunt').hidden = false;
  } catch (e) {
    $('conn').open = true;
    $('msg').className = 'err';
    $('msg').textContent = e.message;
  }
}
const syncKw = () => ($('kw').value = items.find((p) => p.id === $('product').value)?.kw || '');
$('product').onchange = syncKw;

for (const b of document.querySelectorAll('[data-mode]')) {
  b.onclick = async () => {
    const productId = $('product').value;
    if (!productId) return;
    chrome.storage.local.set({ lastProduct: productId });
    $('hmsg').className = '';
    $('hmsg').textContent = '正在打开 1688…';
    try {
      await bg({ type: 'hunt', productId, mode: b.dataset.mode, kw: $('kw').value, detailN: $('dn').checked ? 3 : 0 });
      $('hmsg').className = 'ok';
      $('hmsg').textContent = '已在新标签页开始自动找货';
    } catch (e) {
      $('hmsg').className = 'err';
      $('hmsg').textContent = e.message;
    }
  };
}

chrome.storage.sync.get({ server: self.DEFAULT_SERVER || '', token: '' }, (v) => {
  $('server').value = v.server;
  $('token').value = v.token;
  if (v.server && v.token) loadHunt();
  else $('conn').open = true;
});
$('save').onclick = () => {
  const server = $('server').value.trim().replace(/\/+$/, '');
  const token = $('token').value.trim();
  chrome.storage.sync.set({ server, token }, () => {
    $('msg').className = '';
    $('msg').textContent = '测试中…';
    loadHunt();
  });
};
