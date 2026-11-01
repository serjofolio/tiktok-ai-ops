// 代替页面请求运营台接口（带 API 令牌），避免跨域限制；调度自动找货任务（打开 1688 搜索 / 以图搜 / 详情页）
const cfg = () => chrome.storage.sync.get({ server: '', token: '' });
// 操作节奏倍数：正常为 1；自动化测试里调小
const pace = async () => Number((await chrome.storage.local.get({ pace: 1 })).pace) || 1;
const sleep = async (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (a, b = a) => sleep((a + Math.random() * (b - a)) * (await pace()));

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

// ---------- 防风控：1688 弹过验证后一段时间内不自动打开详情页；两次找货至少间隔 15 秒 ----------
const COOLDOWN = 20 * 60 * 1000;
async function cooldownLeft() {
  const { captchaAt = 0 } = await chrome.storage.local.get('captchaAt');
  return Math.max(0, captchaAt + COOLDOWN - Date.now());
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
  const prepared = [];
  for (const mode of modes) prepared.push(await makeTask({ ...opts, mode }));
  for (const [i, task] of prepared.entries()) {
    const { lastHuntAt = 0 } = await chrome.storage.session.get('lastHuntAt');
    const gap = lastHuntAt + 15000 - Date.now();
    if (gap > 0) await sleep(gap * (await pace()));
    else if (i) await wait(6000, 10000);
    await chrome.storage.session.set({ lastHuntAt: Date.now() });
    await openWithTask(task.mode === 'image' ? 'https://www.1688.com/' : SEARCH_URL(task.kw), task, true);
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

// ---------- 补详情：像人一样隔十几秒在后台打开 1 个详情页，看一会儿、采集完关掉 ----------
const waiting = new Map(); // tabId → resolve
async function details(fromTab, productId, urls) {
  const say = (text, done) => chrome.tabs.sendMessage(fromTab, { type: 'progress', text, done }).catch(() => {});
  // 后台脚本空闲 30 秒会被浏览器回收：补详情期间定时调用一下扩展接口保持运行
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    await openDetails(say, productId, urls);
  } finally {
    clearInterval(keepAlive);
  }
}
async function openDetails(say, productId, urls) {
  let ok = 0;
  for (const [i, url] of urls.entries()) {
    const left = await cooldownLeft();
    if (left) {
      say(`1688 刚弹过验证，${Math.ceil(left / 60000)} 分钟内插件不自动打开详情页（避免账号被风控）。已补 ${ok} 个；需要的话手动打开详情页，点「运营台找货 → 发送本页货源」。`, true);
      return;
    }
    await wait(8000, 15000);
    say(`正在后台打开第 ${i + 1}/${urls.length} 个详情页补全阶梯价、库存、重量、发货地…`);
    const tab = await openWithTask(url, { productId, stage: 'detail', at: Date.now() }, false);
    const r = await Promise.race([new Promise((res) => waiting.set(tab.id, res)), sleep(60000).then(() => ({ ok: false, error: '超时' }))]);
    waiting.delete(tab.id);
    await setTask(tab.id, null);
    if (r.ok) ok++;
    else if (r.captcha) {
      // 1688 要验证：留着这个标签让你处理，剩下的不再打开
      say(`第 ${i + 1} 个详情页弹出了 1688 验证，已停止补详情（已补 ${ok} 个）。完成验证后可以在详情页点「运营台找货 → 发送本页货源」。`, true);
      return;
    }
    await wait(1000, 2500);
    chrome.tabs.remove(tab.id).catch(() => {});
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
  // 以图搜结果页没带上任务（新标签不是由上传页直接打开的）：认领 3 分钟内上传过主图的任务
  claim: async (msg, tab) => {
    const all = await tasks();
    const hit = Object.entries(all).find(([id, t]) => Number(id) !== tab.id && t.mode === 'image' && t.stage === 'collect' && Date.now() - (t.uploadedAt || 0) < 180000);
    if (!hit) return null;
    await setTask(Number(hit[0]), null);
    await setTask(tab.id, hit[1]);
    return hit[1];
  },
  update: async (msg, tab) => {
    const t = (await tasks())[tab.id];
    if (t) await setTask(tab.id, { ...t, ...msg.patch });
  },
  done: async (msg, tab) => setTask(tab.id, null),
  captcha: async () => chrome.storage.local.set({ captchaAt: Date.now() }),
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
