// TikTok 跨境电商运营台 —— 服务入口
// 模块：智能选品（FastMoss 数据）→ 视频脚本 → 知识库 → 接入配置 → Agent 聊天
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const db = require('./db');
const ctx = require('./ctx');
const auth = require('./auth');
const settings = require('./settings');
const llm = require('./providers/llm');
const products = require('./services/products');
const scripts = require('./services/scripts');
const rag = require('./services/rag');
const chat = require('./services/chat');
const report = require('./services/report');
const selection = require('./services/selection');
const growth = require('./services/growth');
const fastmoss = require('./services/fastmoss');
const media = require('./media');
const videogen = require('./services/videogen');
const viral = require('./services/viral');
const playbook = require('./services/playbook');
const connectors = require('./connectors');
const sourcing = require('./services/sourcing');
const listing = require('./services/listing');
const pipeline = require('./services/pipeline');
const launch = require('./services/launch');
const sample = require('./services/sample');
const seed = require('./seed');

const app = express();
const upload = multer({ dest: db.UPLOAD_DIR, limits: { fileSize: 30 * 1024 * 1024 } });
// 视频上传：Cloudflare 免费版单次请求上限 100MB
const MAX_VIDEO_MB = 95;
const videoUpload = multer({ dest: db.UPLOAD_DIR, limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 } });
const oneFile = (uploader, field, tooBig) => (req, res, next) => uploader.single(field)(req, res, (e) => {
  if (!e) return next();
  res.status(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? tooBig : e.message });
});
// ALLOWED_HOSTS：只接受指定域名访问（如 Cloudflare 隧道域名），拒绝 IP+端口直连；本机地址始终放行用于健康检查
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
if (ALLOWED_HOSTS.length) {
  const local = ['localhost', '127.0.0.1', '[::1]'];
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (local.includes(host) || ALLOWED_HOSTS.includes(host)) return next();
    res.status(403).type('text/plain').send('Forbidden');
  });
}
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

// 异步路由统一错误处理；上游模型错误返回 424（不用 502：Cloudflare 会把源站 502 的错误说明替换掉）
// 每个请求都在当前用户的上下文里执行，数据读写自动按用户隔离
const h = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => ctx.run(req.user, () => fn(req, res)))
    .catch((e) => {
    console.error(`[api] ${req.method} ${req.path}:`, e.message);
    if (!res.headersSent) res.status(e.status === 502 ? 424 : e.status || (/^(上游|无法连接上游|请求上游)/.test(e.message) ? 424 : 500)).json({ error: e.message, code: e.code });
  });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const notFound = (what = '资源') => Object.assign(new Error(`${what}不存在`), { status: 404 });
const fileName = (f) => Buffer.from(f.originalname, 'latin1').toString('utf8');

// ---------- 账号 ----------
// 跨站提交拦截：带 Origin 的写请求必须来自本站
app.use('/api', (req, res, next) => {
  // 带 API 令牌的请求不依赖 Cookie，没有跨站伪造风险（浏览器插件的 Origin 是 chrome-extension://）
  if (req.method === 'GET' || !req.headers.origin || /^Bearer\s+tk_/.test(req.headers.authorization || '')) return next();
  let host = '';
  try {
    host = new URL(req.headers.origin).host;
  } catch {}
  if (host && host === req.headers.host) return next();
  res.status(403).json({ error: '跨站请求已拦截' });
});
app.use((req, res, next) => {
  req.token = auth.readToken(req);
  req.user = auth.userFromToken(req.token) || auth.userFromApiToken(req.headers.authorization);
  next();
});
const signIn = (req, res, user) => {
  auth.setCookie(req, res, auth.createSession(user));
  res.json({ user: auth.publicUser(user) });
};
// 注册限流：同一 IP 每小时最多 5 个
const regLog = new Map();
app.get('/api/auth/me', h(async (req, res) => res.json({ user: auth.publicUser(req.user), allowRegister: settings.system().allowRegister, firstUser: !auth.hasUsers() })));
app.post('/api/auth/register', h(async (req, res) => {
  const ip = auth.clientIp(req);
  const recent = (regLog.get(ip) || []).filter((t) => Date.now() - t < 3600e3);
  if (recent.length >= 5) throw Object.assign(new Error('注册太频繁，请稍后再试'), { status: 429 });
  const user = await auth.register(req.body || {});
  regLog.set(ip, [...recent, Date.now()]);
  signIn(req, res, user);
}));
app.post('/api/auth/login', h(async (req, res) => signIn(req, res, await auth.login(req.body || {}, auth.clientIp(req)))));
app.post('/api/auth/logout', h(async (req, res) => {
  auth.endSession(req.token); // 只退出当前设备
  auth.setCookie(req, res, '');
  res.json({ ok: true });
}));
// 以下接口都需要登录
app.use('/api', (req, res, next) => (req.user ? next() : res.status(401).json({ error: '请先登录', code: 'auth' })));
app.post('/api/auth/password', h(async (req, res) => {
  await auth.changePassword(req.user, req.body.oldPassword, req.body.newPassword, req.token);
  res.json({ ok: true });
}));

// ---------- 管理员：用户管理 ----------
app.use('/api/admin', (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: '只有管理员可以操作' })));
app.get('/api/admin/users', h(async (req, res) => res.json({ items: auth.listUsers(), system: settings.system() })));
app.patch('/api/admin/users/:id', h(async (req, res) => res.json(await auth.adminUpdate(req.user, req.params.id, req.body || {}))));
app.post('/api/admin/users/:id/reset-password', h(async (req, res) => res.json(await auth.adminResetPassword(req.user, req.params.id))));
app.delete('/api/admin/users/:id', h(async (req, res) => res.json(auth.adminDelete(req.user, req.params.id))));
app.put('/api/admin/system', h(async (req, res) => res.json(settings.setSystem({ allowRegister: !!req.body.allowRegister }))));

// ---------- 总览 ----------
app.get('/api/dashboard', h(async (req, res) => {
  const list = products.list();
  const s = settings.get();
  const byStatus = (st) => list.filter((p) => (p.status || 'candidate') === st).length;
  const cats = {};
  for (const p of list) {
    const c = p.category || '未分类';
    cats[c] = cats[c] || { category: c, count: 0, gmv: 0, sales: 0 };
    cats[c].count++;
    cats[c].gmv += p.gmv || (p.sales7d || 0) * (p.price || 0);
    cats[c].sales += p.sales7d || 0;
  }
  const active = settings.activeProvider();
  res.json({
    stats: {
      products: list.length,
      recommended: list.filter((p) => p.evaluation.verdict === '可以上').length,
      testing: byStatus('testing'),
      scripts: db.scripts.count(),
      docs: db.docs.count(),
      chats: chat.chats.count(),
    },
    topProducts: list.filter((p) => p.status !== 'dropped').slice(0, 8),
    categoryStats: Object.values(cats).sort((a, b) => b.gmv - a.gmv).slice(0, 9),
    recentScripts: db.scripts.all().slice(0, 5).map(({ id, title, productName, createdAt }) => ({ id, title, productName, createdAt })),
    activity: db.activity.all().slice(0, 8),
    provider: active ? { name: active.name, model: active.model } : null,
    store: s.store,
  });
}));

// ---------- 测款作战室 ----------
app.get('/api/launch/board', h(async (req, res) => res.json(launch.board())));
app.get('/api/launch/actions', h(async (req, res) => res.json({ items: launch.actions(/^\d{4}-\d{2}-\d{2}$/.test(req.query.today || '') ? req.query.today : undefined), sample: sample.status() })));
app.get('/api/launch/:id', h(async (req, res) => res.json(launch.get(req.params.id))));
app.post('/api/launch/:id/start', h(async (req, res) => res.json(launch.start(req.params.id))));
app.patch('/api/launch/:id', h(async (req, res) => res.json(launch.configure(req.params.id, req.body || {}))));
app.post('/api/launch/:id/prepare', h(async (req, res) => res.json(launch.prepare(req.params.id, { force: !!req.body?.force }))));
app.post('/api/launch/:id/days', h(async (req, res) => res.json(launch.addDay(req.params.id, req.body || {}))));
app.delete('/api/launch/:id/days/:dayId', h(async (req, res) => res.json(launch.removeDay(req.params.id, req.params.dayId))));
app.get('/api/launch/:id/export', h(async (req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="launch-plan-${req.params.id}.md"`);
  res.send(launch.exportMd(req.params.id));
}));
app.post('/api/sample', h(async (req, res) => res.json(sample.load())));
app.delete('/api/sample', h(async (req, res) => res.json(sample.clear())));

// ---------- 智能选品 ----------
// 列表只带货源和上架包的摘要，详情接口才返回完整数据
const light = ({ sourcing: s, listing: l, reviewsText, analysis, snapshots, daily, pains, ...p }) => ({ ...p, analyzed: !!analysis, sourcing: s ? { count: s.offers?.length || 0, chosen: s.chosen || null, keyword: s.keyword } : null, listing: l ? { status: l.status } : null });
app.get('/api/products', h(async (req, res) => res.json({ items: products.list(req.query).map(light), categories: products.categories(), ...(req.query.facets ? { facets: products.facets(), quota: products.exportQuota(req.query.today) } : {}), assumptions: settings.get().selection, markets: Object.fromEntries(Object.keys(selection.MARKETS).map((k) => [k, selection.marketProfile(k)])) })));
// AI 选品报告：后台生成，前端轮询
app.post('/api/reports', h(async (req, res) => res.json(report.start({ ids: req.body?.ids }))));
app.get('/api/reports/latest', h(async (req, res) => res.json(report.latest() || {})));
app.get('/api/reports/:id', h(async (req, res) => {
  const r = report.get(req.params.id);
  if (!r) throw notFound('报告');
  res.json(r);
}));
// 增长榜：指定时间窗内销量和 GMV 增长最快的商品
app.get('/api/products/growth', h(async (req, res) => res.json(growth.board(req.query))));
app.get('/api/products/:id', h(async (req, res) => {
  const p = products.get(req.params.id);
  if (!p) throw notFound('商品');
  res.json(p);
}));
app.post('/api/products', h(async (req, res) => res.json(products.createManual(req.body))));
app.post('/api/products/bulk', h(async (req, res) => res.json(products.bulk(req.body || {}))));
app.patch('/api/products/:id', h(async (req, res) => res.json(products.patch(req.params.id, req.body))));
app.delete('/api/products/:id', h(async (req, res) => {
  if (!db.products.get(req.params.id)) throw notFound('商品');
  res.json({ ok: db.products.remove(req.params.id) });
}));
app.post('/api/products/:id/analyze', h(async (req, res) => res.json(await products.analyze(req.params.id))));
// 导入：先预览（自动识别列），确认列对应关系后再写入
app.post('/api/products/import/preview', upload.single('file'), h(async (req, res) => {
  let rows;
  if (req.file) {
    try {
      rows = await products.parseFile(fs.readFileSync(req.file.path), fileName(req.file));
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  } else if (req.body.text) rows = products.parseDelimited(String(req.body.text));
  else throw bad('请上传 FastMoss 导出的文件，或粘贴表格内容');
  res.json(products.preview(rows, { fileName: req.file ? fileName(req.file) : '', source: req.file ? 'file' : 'paste' }));
}));
app.post('/api/products/import/commit', h(async (req, res) => res.json(products.commit(req.body.token, req.body.mapping || {}, { dataDate: req.body.dataDate, today: req.body.today }))));
app.put('/api/selection', h(async (req, res) => {
  const b = req.body || {};
  const a = {};
  for (const k of ['creatorRate', 'returnRate', 'adRate', 'targetMargin', 'exportQuota']) if (b[k] !== undefined && b[k] !== '') a[k] = Math.max(0, Number(b[k]) || 0);
  if (['crossborder', 'local'].includes(b.storeMode)) a.storeMode = b.storeMode;
  if (b.invited) a.invited = { charger: !!b.invited.charger, powerbank: !!b.invited.powerbank };
  if (b.markets && typeof b.markets === 'object') {
    a.markets = {};
    for (const [code, v] of Object.entries(b.markets)) {
      if (!selection.MARKETS[code] || !v) continue;
      a.markets[code] = {};
      for (const k of ['platformFeeRate', 'fixedFee', 'cnyRate']) if (v[k] !== undefined && v[k] !== '' && Number.isFinite(Number(v[k]))) a.markets[code][k] = Math.max(0, Number(v[k]));
    }
  }
  res.json(settings.update({ selection: a }).selection);
}));

// ---------- 数据源与 ERP 连接器 ----------
app.get('/api/connectors', h(async (req, res) => res.json({ catalog: connectors.catalog(), items: connectors.publicList() })));
app.post('/api/connectors', h(async (req, res) => res.json(connectors.save(req.body || {}))));
app.put('/api/connectors/:id', h(async (req, res) => {
  const c = connectors.get(req.params.id);
  if (!c) throw notFound('连接器');
  res.json(connectors.save({ ...req.body, id: c.id, vendor: c.vendor }));
}));
app.delete('/api/connectors/:id', h(async (req, res) => {
  connectors.remove(req.params.id);
  res.json({ ok: true });
}));
app.post('/api/connectors/:id/test', h(async (req, res) => res.json(await connectors.test(req.params.id))));
// API 令牌（浏览器插件 / n8n / 影刀）
app.get('/api/tokens', h(async (req, res) => res.json({ items: auth.listApiTokens(req.user) })));
app.post('/api/tokens', h(async (req, res) => res.json(auth.createApiToken(req.user, req.body?.name))));
app.delete('/api/tokens/:id', h(async (req, res) => {
  auth.revokeApiToken(req.user, req.params.id);
  res.json({ ok: true });
}));

// ---------- FastMoss 开放接口：按类目拉数据，不占用导出次数 ----------
app.get('/api/fastmoss/categories', h(async (req, res) => res.json(await fastmoss.categories())));
app.post('/api/fastmoss/pull', h(async (req, res) => res.json(fastmoss.startPull(req.body || {}))));
app.get('/api/fastmoss/jobs/latest', h(async (req, res) => res.json(fastmoss.latest() || {})));

// ---------- 1688 找货 ----------
app.post('/api/products/:id/sourcing/search', h(async (req, res) => res.json(await sourcing.search(req.params.id, { keyword: req.body?.keyword }))));
app.post('/api/products/:id/sourcing/offers', h(async (req, res) => res.json(await sourcing.addOffers(req.params.id, req.body?.offers || [], req.body?.source || '手动添加'))));
app.post('/api/products/:id/sourcing/choose', h(async (req, res) => res.json(sourcing.choose(req.params.id, req.body?.offerId))));
app.get('/api/products/:id/sourcing/links', h(async (req, res) => {
  const p = products.get(req.params.id);
  if (!p) throw notFound('商品');
  const kw = await sourcing.keywordFor(p);
  res.json({ keyword: kw, ...sourcing.links(p, kw), hasApi: connectors.active('sourcing').length > 0 });
}));

// ---------- 上架包与上品 ----------
app.post('/api/products/:id/listing', h(async (req, res) => res.json(await listing.build(req.params.id))));
app.patch('/api/products/:id/listing', h(async (req, res) => res.json(listing.update(req.params.id, req.body || {}))));
app.post('/api/products/:id/listing/push', h(async (req, res) => res.json(await listing.push(req.params.id, req.body?.connectorId))));
app.get('/api/listings/export', h(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  res.setHeader('Content-Disposition', `attachment; filename="listings-${Date.now()}.csv"`);
  res.type('text/csv; charset=utf-8').send(listing.exportCsv(ids.length ? ids : products.list().filter((p) => p.listing).map((p) => p.id)));
}));

// ---------- 自动上品流水线 ----------
// 流水线各环节是否就绪
app.get('/api/pipeline/readiness', h(async (req, res) => {
  const all = db.products.all();
  const last = all.filter((p) => p.batchId).sort((a, b) => String(b.dataAt).localeCompare(String(a.dataAt)))[0];
  const llmP = settings.activeProvider();
  const names = (kind) => connectors.active(kind).map((c) => c.name);
  res.json({
    llm: llmP ? `${llmP.name} · ${llmP.model}` : null,
    products: { count: all.length, lastImport: last?.dataAt || null, batchSize: last ? all.filter((p) => p.batchId === last.batchId).length : 0 },
    fastmoss: names('product'),
    sourcing: names('sourcing'),
    plugin: auth.listApiTokens(req.user).length > 0,
    erp: names('erp'),
  });
}));
app.post('/api/pipeline/runs', h(async (req, res) => res.json(pipeline.start(req.body || {}))));
app.get('/api/pipeline/latest', h(async (req, res) => res.json(pipeline.latest() || {})));
app.get('/api/pipeline/runs/:id', h(async (req, res) => {
  const r = pipeline.get(req.params.id);
  if (!r) throw notFound('流水线');
  res.json(r);
}));
app.post('/api/pipeline/runs/:id/resume', h(async (req, res) => res.json(pipeline.resume(req.params.id))));

// ---------- 浏览器插件 ----------
app.get('/api/ext/me', h(async (req, res) => res.json({ user: auth.publicUser(req.user), hasSourcingApi: connectors.active('sourcing').length > 0 })));
// 待找货的商品：可以上 / 谨慎测试，按评分排序
app.get('/api/ext/products', h(async (req, res) => res.json({ items: products.list({ sort: 'score' }).filter((p) => ['可以上', '谨慎测试'].includes(p.evaluation.verdict) && p.status !== 'dropped').slice(0, 60).map((p) => ({ id: p.id, name: p.name, image: p.image || '', verdict: p.evaluation.verdict, kw: p.kw1688 || p.ai?.kw1688 || '', ceilingCny: p.evaluation.profit?.ceilingCny ?? null, offers: p.sourcing?.offers?.length || 0 })) })));
// 插件自动找货：商品主图 + 1688 搜索词（没有就让 AI 提炼）
app.get('/api/ext/products/:id/task', h(async (req, res) => {
  const p = products.get(req.params.id);
  if (!p) throw notFound('商品');
  res.json({ id: p.id, name: p.name, image: p.image || '', kw: await sourcing.keywordFor(p) });
}));
// 插件识别不到货源时上报页面结构（去掉脚本、样式、图片），用来调整识别规则；只保留最近 30 份
app.post('/api/ext/debug', h(async (req, res) => {
  const b = req.body || {};
  const dir = path.join(db.DATA_DIR, 'ext-debug');
  fs.mkdirSync(dir, { recursive: true });
  const s = (v, n) => String(v ?? '').slice(0, n);
  fs.writeFileSync(path.join(dir, `${Date.now()}-${req.user.id}.json`), JSON.stringify({ at: new Date().toISOString(), user: req.user.username, reason: s(b.reason, 60), url: s(b.url, 2000), title: s(b.title, 300), version: s(b.version, 20), ua: s(b.ua, 300), html: s(b.html, 1000000), scripts: (Array.isArray(b.scripts) ? b.scripts : []).slice(0, 3).map((x) => s(x, 300000)) }));
  const files = fs.readdirSync(dir).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.rmSync(path.join(dir, f), { force: true });
  res.json({ ok: true });
}));
// 插件在 FastMoss 页面发送「当前这一页」的商品：和导入文件走同一套列名识别，不占导出次数
app.post('/api/ext/fastmoss', h(async (req, res) => {
  const b = req.body || {};
  const r = products.importTable({ headers: b.headers, rows: b.rows, source: 'plugin', fileName: String(b.title || '').slice(0, 80) }, { today: b.today });
  db.activity.insert({ type: 'product', text: `插件发送 FastMoss 商品：新增 ${r.created}，更新 ${r.updated}` });
  res.json({ ok: true, created: r.created, updated: r.updated, count: r.ids.length, recognized: r.recognized });
}));
app.post('/api/ext/offers', h(async (req, res) => {
  const s = await sourcing.addOffers(req.body?.productId, req.body?.offers || [], '浏览器插件');
  // 排名靠前、还没补详情的同款货源：插件接着打开详情页补阶梯价 / 库存 / 重量 / 发货地
  const top = s.offers.filter((o) => o.url && (o.match == null || o.match >= 50) && o.unitWeight == null && !o.priceRanges?.length).slice(0, 5).map((o) => o.url);
  res.json({ ok: true, count: s.offers.length, top });
}));

// ---------- 视频脚本 ----------
app.get('/api/playbook', h(async (req, res) => res.json(playbook.full())));
app.get('/api/scripts', h(async (req, res) => res.json({ items: db.scripts.all(), styles: scripts.STYLES })));
app.post('/api/scripts/pains', h(async (req, res) => res.json(await scripts.pains(req.body || {}))));
app.get('/api/scripts/:id', h(async (req, res) => {
  const s = db.scripts.get(req.params.id);
  if (!s) throw notFound('脚本');
  res.json(s);
}));
app.get('/api/scripts/:id/srt', h(async (req, res) => {
  const s = db.scripts.get(req.params.id);
  if (!s) throw notFound('脚本');
  res.setHeader('Content-Disposition', 'attachment; filename="subtitles.srt"');
  res.type('text/plain; charset=utf-8').send(scripts.srt(s));
}));
app.post('/api/scripts/generate', h(async (req, res) => res.json(await scripts.generate(req.body))));
app.delete('/api/scripts/:id', h(async (req, res) => res.json({ ok: db.scripts.remove(req.params.id) })));

// ---------- 爆款视频拆解 ----------
app.get('/api/viral', h(async (req, res) => res.json({ items: viral.list(), capabilities: viral.capabilities(), maxMb: MAX_VIDEO_MB, storage: { usedMb: Math.round(media.used() / 1048576), quotaMb: req.user.role === 'admin' ? null : media.QUOTA_MB } })));
app.post('/api/viral', oneFile(videoUpload, 'video', `视频太大：单个文件最大 ${MAX_VIDEO_MB}MB`), h(async (req, res) => {
  if (!req.file) throw bad('请选择视频文件');
  try {
    res.json(await viral.add(req.file.path, fileName(req.file), req.body || {}));
  } finally {
    fs.rm(req.file.path, { force: true }, () => {});
  }
}));
app.get('/api/viral/:id', h(async (req, res) => {
  const v = viral.get(req.params.id);
  if (!v) throw notFound('记录');
  res.json(v);
}));
app.post('/api/viral/:id/rerun', h(async (req, res) => res.json(viral.rerun(req.params.id))));
app.post('/api/viral/:id/scripts', h(async (req, res) => res.json(await viral.learn(req.params.id, req.body || {}))));
app.delete('/api/viral/:id', h(async (req, res) => res.json({ ok: viral.remove(req.params.id) })));
app.get('/api/viral/:id/frames/:name', h(async (req, res) => {
  const file = viral.framePath(req.params.id, req.params.name);
  if (!file) throw notFound('画面');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type('image/jpeg').sendFile(file, { dotfiles: 'allow' });
}));

// ---------- 视频文件：登录后只能看自己的，支持拖动进度和下载 ----------
app.get('/api/media/:id', h(async (req, res) => {
  const m = media.records.get(req.params.id);
  if (!m) throw notFound('视频');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (req.query.download) {
    const ext = path.extname(m.file) || '.mp4';
    const name = `${m.title || 'video'}${ext}`.replace(/[\\/:*?"<>|\r\n]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="video${ext}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  res.type(m.mime);
  await new Promise((resolve, reject) => res.sendFile(media.absPath(m), { dotfiles: 'allow', headers: { 'Content-Type': m.mime } }, (e) => (e && !res.headersSent ? reject(e) : resolve())));
}));
// 首帧图：生成视频时用自己拍的商品图
app.post('/api/media/image', oneFile(upload, 'image', '图片太大：最大 30MB'), h(async (req, res) => {
  if (!req.file) throw bad('请选择图片');
  try {
    const head = fs.readFileSync(req.file.path).subarray(0, 12);
    const mime = head[0] === 0xff && head[1] === 0xd8 ? 'image/jpeg' : head.toString('latin1', 1, 4) === 'PNG' ? 'image/png' : head.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : '';
    if (!mime) throw bad('只支持 JPG、PNG、WebP 图片');
    if (req.file.size > 10 * 1024 * 1024) throw bad('首帧图不能超过 10MB');
    media.assertQuota(req.file.size);
    const dir = media.newDir('image');
    const abs = path.join(dir, `first-frame.${mime.split('/')[1]}`);
    fs.renameSync(req.file.path, abs);
    res.json(media.register({ abs, kind: 'image', title: fileName(req.file), mime }));
  } finally {
    fs.rm(req.file.path, { force: true }, () => {});
  }
}));

// ---------- 脚本生成视频 ----------
const scriptOf = (id) => {
  const s = db.scripts.get(id);
  if (!s) throw notFound('脚本');
  return s;
};
app.get('/api/video-jobs', h(async (req, res) => res.json({ items: videogen.list(), models: connectors.active('video').map((c) => ({ id: c.id, name: c.name, vendor: c.vendor })), storage: { usedMb: Math.round(media.used() / 1048576), quotaMb: req.user.role === 'admin' ? null : media.QUOTA_MB } })));
// 提交前的规划：几段、一共多少秒
app.post('/api/video-jobs/plan', h(async (req, res) => res.json(videogen.publicPlan(videogen.plan({ script: scriptOf(req.body?.scriptId), connectorId: req.body?.connectorId, mode: req.body?.mode, sceneNs: req.body?.sceneNs })))));
app.post('/api/video-jobs', h(async (req, res) => {
  const script = scriptOf(req.body?.scriptId);
  const body = { ...req.body };
  if (body.imageSource === 'product') body.imageUrl = script.productId ? products.get(script.productId)?.image || '' : '';
  res.json(await videogen.startJob(body, script));
}));
app.get('/api/video-jobs/:id', h(async (req, res) => {
  const j = videogen.getJob(req.params.id);
  if (!j) throw notFound('任务');
  res.json(j);
}));
app.post('/api/video-jobs/:id/retry', h(async (req, res) => res.json(videogen.retry(req.params.id))));
app.delete('/api/video-jobs/:id', h(async (req, res) => res.json({ ok: videogen.removeJob(req.params.id) })));

// ---------- 知识库 ----------
app.get('/api/kbs', h(async (req, res) => res.json({ items: db.kbs.all().map((k) => ({ ...k, readonly: !db.kbs.canEdit(k.id) })) })));
app.post('/api/kbs', h(async (req, res) => {
  if (!req.body.name) throw bad('请输入知识库名称');
  res.json(db.kbs.insert({ name: req.body.name, description: req.body.description || '', icon: '', docCount: 0, chunkCount: 0 }));
}));
app.delete('/api/kbs/:id', h(async (req, res) => res.json({ ok: rag.removeKb(req.params.id) })));
app.get('/api/kbs/:id/docs', h(async (req, res) => res.json({ items: db.docs.find((d) => d.kbId === req.params.id) })));
app.post('/api/kbs/:id/docs', upload.array('files', 20), h(async (req, res) => {
  const out = [];
  if (req.files?.length) {
    for (const f of req.files) {
      const name = fileName(f);
      try {
        const text = await rag.extractText(f.path, name);
        out.push(await rag.addDocument(req.params.id, { title: name.replace(/\.[^.]+$/, ''), text, source: 'upload', fileName: name }));
      } finally {
        fs.unlink(f.path, () => {});
      }
    }
  } else out.push(await rag.addDocument(req.params.id, { title: req.body.title || '未命名文档', text: req.body.text, source: 'manual' }));
  res.json({ items: out });
}));
app.post('/api/kbs/:id/url', h(async (req, res) => res.json(await rag.importUrl(req.params.id, String(req.body.url || '').trim()))));
app.get('/api/docs/:id/chunks', h(async (req, res) => res.json({ items: db.chunks.find((c) => c.docId === req.params.id).map(({ tokens, vector, ...c }) => c).sort((a, b) => a.index - b.index) })));
app.delete('/api/docs/:id', h(async (req, res) => res.json({ ok: rag.removeDocument(req.params.id) })));
app.post('/api/rag/search', h(async (req, res) => res.json({ items: await rag.search(req.body.query || '', { kbIds: req.body.kbIds, topK: req.body.topK || 6 }) })));
app.post('/api/rag/ask', h(async (req, res) => res.json(await rag.ask(req.body.question || '', { kbIds: req.body.kbIds }))));

// ---------- 接入配置（模型供应商，类似 CC Switch） ----------
app.get('/api/providers', h(async (req, res) => {
  const v = settings.publicView();
  res.json({ items: v.providers, activeId: v.activeProviderId, presets: llm.PRESETS, dataSources: v.dataSources, store: v.store, selection: v.selection });
}));
app.post('/api/providers', h(async (req, res) => res.json(settings.saveProvider(req.body))));
app.put('/api/providers/:id', h(async (req, res) => res.json(settings.saveProvider({ ...req.body, id: req.params.id }))));
app.delete('/api/providers/:id', h(async (req, res) => {
  settings.removeProvider(req.params.id);
  res.json({ ok: true });
}));
app.post('/api/providers/:id/activate', h(async (req, res) => {
  settings.activate(req.params.id);
  res.json({ ok: true });
}));
app.post('/api/providers/:id/test', h(async (req, res) => {
  const p = settings.getProvider(req.params.id);
  if (!p) throw notFound('供应商');
  res.json(await llm.test(p));
}));
// 获取模型列表：可携带表单里尚未保存的地址/Key（Key 留空或脱敏时使用已保存的）
app.post('/api/providers/models', h(async (req, res) => {
  const saved = req.body.id ? settings.getProvider(req.body.id) : null;
  const cfg = { ...(saved || {}), ...req.body };
  if (!req.body.apiKey || String(req.body.apiKey).includes('••')) cfg.apiKey = saved?.apiKey || '';
  res.json(await llm.listModels(cfg));
}));
app.put('/api/settings', h(async (req, res) => {
  const { dataSources, store } = req.body || {};
  settings.update({ dataSources, store });
  res.json(settings.publicView());
}));

// ---------- Agent 聊天 ----------
app.get('/api/chats', h(async (req, res) => res.json({ items: chat.list() })));
app.post('/api/chats', h(async (req, res) => res.json(chat.create())));
app.get('/api/chats/:id', h(async (req, res) => {
  const c = chat.chats.get(req.params.id);
  if (!c) throw notFound('会话');
  res.json(c);
}));
app.delete('/api/chats/:id', h(async (req, res) => res.json({ ok: chat.chats.remove(req.params.id) })));
// 流式回答（Server-Sent Events）；客户端断开即停止生成
app.post('/api/chats/:id/stream', async (req, res) => {
  const ctrl = new AbortController();
  res.on('close', () => !res.writableEnded && ctrl.abort());
  const send = (event, data) => {
    if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    await ctx.run(req.user, () => chat.reply(req.params.id, req.body || {}, send, ctrl.signal));
  } catch (e) {
    console.error('[chat]', e.message);
    send('error', { error: e.message, code: e.code });
  }
  res.end();
});

// ---------- 浏览器插件下载：打包 extension/ 目录，并预填当前运营台地址 ----------
app.get('/extension.zip', async (req, res) => {
  try {
    const JSZip = require('jszip');
    const dir = path.join(__dirname, '..', 'extension');
    // 文件直接放在压缩包根目录：Windows「全部解压缩」得到的 tiktok-ops-helper 文件夹里就是 manifest.json，不会多套一层
    const zip = new JSZip();
    const folder = zip;
    for (const f of fs.readdirSync(dir)) folder.file(f, fs.readFileSync(path.join(dir, f)));
    const origin = `${String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0]}://${req.headers.host}`;
    folder.file('config.js', `self.DEFAULT_SERVER = ${JSON.stringify(origin)};\n`);
    res.setHeader('Content-Disposition', 'attachment; filename="tiktok-ops-helper.zip"');
    // 不让浏览器和 Cloudflare 缓存：.zip 默认会被 CDN 缓存 4 小时，更新插件后用户会下到旧版
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/zip').send(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  } catch (e) {
    res.status(500).type('text/plain').send('插件打包失败：' + e.message);
  }
});

// ---------- 静态资源 ----------
// 前端 3D 依赖从本地 node_modules 提供，不依赖外部 CDN
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build'), { maxAge: '30d' }));
// 静态资源按版本号加路径前缀：每次重启（部署）后 URL 都变，浏览器和 Cloudflare 不会再用到旧脚本
const PUBLIC = path.join(__dirname, '..', 'public');
const BUILD = Date.now().toString(36);
app.use('/v/:build', express.static(PUBLIC, { maxAge: '365d', immutable: true }));
app.use(express.static(PUBLIC, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
const indexHtml = () =>
  fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/(href|src)="\/(css|js)\//g, `$1="/v/${BUILD}/$2/`);
app.get(/^\/(?!api|vendor|v\/|extension\.zip).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(indexHtml());
});
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

const PORT = Number(process.env.PORT) || 3800;
// HOST=127.0.0.1 时只监听本机，外网无法通过 IP+端口访问（由反向代理/隧道转发）
const HOST = process.env.HOST || undefined;

async function main() {
  await seed.run();
  report.recover();
  pipeline.recover();
  launch.recover();
  fastmoss.recover();
  viral.recover();
  videogen.recover(auth.userById);
  const server = app.listen(PORT, HOST, () => {
    const url = `http://${HOST && HOST !== '0.0.0.0' ? HOST : 'localhost'}:${PORT}`;
    console.log(`\n  TikTok 运营台已启动：${url}\n  数据目录：${db.DATA_DIR}\n`);
    if (process.argv.includes('--open')) {
      const { exec } = require('child_process');
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
      exec(cmd, () => {});
    }
  });
  const stop = () => {
    db.flushAll();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) main();
module.exports = { app, main };
