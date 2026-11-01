// 代替页面请求运营台接口（带 API 令牌），避免跨域限制；调度自动找货任务（打开 1688 搜索 / 以图搜 / 详情页）
const cfg = () => chrome.storage.sync.get({ server: '', token: '' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---------- 任务：按标签页记录，页面跳转后（以图搜上传后会跳到结果页）内容脚本接着做 ----------
async function tasks() {
  return (await chrome.storage.session.get({ tasks: {} })).tasks;
}
async function setTask(tabId, t) {
  const all = await tasks();
  if (t) all[tabId] = t;
  else delete all[tabId];
  await chrome.storage.session.set({ tasks: all });
}

const SEARCH_URL = (kw) => `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}&charset=utf8`;

// 生成一个找货任务：关键词 → 打开 1688 搜索结果页；以图搜 → 打开 1688 首页上传主图
async function makeTask({ productId, mode, kw, detailN = 3 }) {
  const t = await call(`/ext/products/${encodeURIComponent(productId)}/task`);
  if (mode === 'image' && !t.image) throw new Error('这个商品没有主图，没法以图搜，请用关键词搜');
  return { productId, name: t.name, image: t.image, kw: (kw || t.kw || '').trim(), mode, detailN: Number(detailN) || 0, stage: mode === 'image' ? 'upload' : 'collect', at: Date.now() };
}

// 先建空白标签、记好任务再跳转：页面加载时任务一定已经在
async function openWithTask(url, task, active) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active });
  await setTask(tab.id, task);
  await chrome.tabs.update(tab.id, { url });
  return tab;
}

async function hunt(opts) {
  const modes = opts.mode === 'both' ? ['keyword', 'image'] : [opts.mode];
  for (const mode of modes) {
    const task = await makeTask({ ...opts, mode });
    await openWithTask(mode === 'image' ? 'https://www.1688.com/' : SEARCH_URL(task.kw), task, true);
  }
}

// 商品主图转成 JPEG（1688 以图搜不认 webp 等格式），交给内容脚本放进上传框
async function imageData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('商品主图下载失败 (' + res.status + ')');
  let blob = await res.blob();
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  } catch {}
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { b64: btoa(s), type: blob.type || 'image/jpeg' };
}

// ---------- 补详情：依次在后台标签打开排名靠前的详情页，采集完关掉 ----------
const waiting = new Map(); // tabId → resolve
async function details(fromTab, productId, urls) {
  const say = (text, done) => chrome.tabs.sendMessage(fromTab, { type: 'progress', text, done }).catch(() => {});
  let ok = 0;
  for (const [i, url] of urls.entries()) {
    say(`正在打开第 ${i + 1}/${urls.length} 个详情页补全阶梯价、库存、重量、发货地…`);
    const tab = await openWithTask(url, { productId, stage: 'detail', at: Date.now() }, false);
    const r = await Promise.race([new Promise((res) => waiting.set(tab.id, res)), sleep(45000).then(() => ({ ok: false, error: '超时' }))]);
    waiting.delete(tab.id);
    await setTask(tab.id, null);
    if (r.ok) ok++;
    else if (r.captcha) {
      // 1688 要验证：留着标签让用户处理，剩下的不再打开
      say(`第 ${i + 1} 个详情页触发了 1688 验证，已停止补详情（已补 ${ok} 个）。完成验证后可在详情页手动点「发送到运营台」。`, true);
      return;
    }
    chrome.tabs.remove(tab.id).catch(() => {});
    await sleep(1500 + Math.random() * 2000);
  }
  say(`完成：补全了 ${ok}/${urls.length} 个详情。回到运营台「1688 找货」看比价结果。`, true);
}

// 以图搜结果在新标签打开时，任务跟过去
chrome.tabs.onCreated.addListener(async (tab) => {
  const t = tab.openerTabId != null && (await tasks())[tab.openerTabId];
  if (t && t.mode === 'image' && t.stage === 'collect') {
    await setTask(tab.id, t);
    await setTask(tab.openerTabId, null);
  }
});

chrome.tabs.onRemoved.addListener((id) => {
  waiting.get(id)?.({ ok: false, error: '标签被关闭' });
  setTask(id, null);
});

const handlers = {
  api: (msg) => call(msg.path, msg),
  hunt: (msg) => hunt(msg),
  task: async (msg, tab) => (await tasks())[tab.id] || null,
  // 网页上的「插件自动搜」链接带 #tkops=商品ID&mode=…，由内容脚本认领成任务
  adopt: async (msg, tab) => {
    const t = await makeTask(msg);
    await setTask(tab.id, t);
    return t;
  },
  update: async (msg, tab) => {
    const t = (await tasks())[tab.id];
    if (t) await setTask(tab.id, { ...t, ...msg.patch });
  },
  done: async (msg, tab) => setTask(tab.id, null),
  image: (msg) => imageData(msg.url),
  details: async (msg, tab) => {
    details(tab.id, msg.productId, msg.urls.slice(0, 5));
  },
  detailDone: async (msg, tab) => waiting.get(tab.id)?.(msg),
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const fn = handlers[msg?.type];
  if (!fn) return;
  Promise.resolve(fn(msg, sender.tab || {}))
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: e.message }));
  return true;
});
