// TikTok 跨境电商运营台 —— 服务入口
// 模块：智能选品（FastMoss 数据）→ 视频脚本 → 知识库 → 接入配置 → Agent 聊天
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const db = require('./db');
const settings = require('./settings');
const llm = require('./providers/llm');
const products = require('./services/products');
const scripts = require('./services/scripts');
const rag = require('./services/rag');
const chat = require('./services/chat');
const seed = require('./seed');

const app = express();
const upload = multer({ dest: db.UPLOAD_DIR, limits: { fileSize: 30 * 1024 * 1024 } });
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

// 异步路由统一错误处理；上游模型错误返回 502，便于前端区分
const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(`[api] ${req.method} ${req.path}:`, e.message);
    if (!res.headersSent) res.status(e.status || (/^(上游|无法连接上游|请求上游)/.test(e.message) ? 502 : 500)).json({ error: e.message, code: e.code });
  });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const notFound = (what = '资源') => Object.assign(new Error(`${what}不存在`), { status: 404 });
const fileName = (f) => Buffer.from(f.originalname, 'latin1').toString('utf8');

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
      recommended: list.filter((p) => p.evaluation.verdict === '推荐测款').length,
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

// ---------- 智能选品 ----------
app.get('/api/products', h(async (req, res) => res.json({ items: products.list(req.query), categories: products.categories(), assumptions: settings.get().selection })));
app.get('/api/products/:id', h(async (req, res) => {
  const p = products.get(req.params.id);
  if (!p) throw notFound('商品');
  res.json(p);
}));
app.post('/api/products', h(async (req, res) => res.json(products.createManual(req.body))));
app.patch('/api/products/:id', h(async (req, res) => res.json(products.patch(req.params.id, req.body))));
app.delete('/api/products/:id', h(async (req, res) => res.json({ ok: db.products.remove(req.params.id) })));
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
  res.json(products.preview(rows));
}));
app.post('/api/products/import/commit', h(async (req, res) => res.json(products.commit(req.body.token, req.body.mapping || {}))));
app.put('/api/selection', h(async (req, res) => {
  const a = {};
  for (const k of ['platformFeeRate', 'creatorRate', 'returnRate', 'adRate', 'targetMargin']) if (req.body[k] !== undefined) a[k] = Math.max(0, Number(req.body[k]) || 0);
  res.json(settings.update({ selection: a }).selection);
}));

// ---------- 视频脚本 ----------
app.get('/api/scripts', h(async (req, res) => res.json({ items: db.scripts.all(), styles: scripts.STYLES })));
app.get('/api/scripts/:id', h(async (req, res) => {
  const s = db.scripts.get(req.params.id);
  if (!s) throw notFound('脚本');
  res.json(s);
}));
app.post('/api/scripts/generate', h(async (req, res) => res.json(await scripts.generate(req.body))));
app.delete('/api/scripts/:id', h(async (req, res) => res.json({ ok: db.scripts.remove(req.params.id) })));

// ---------- 知识库 ----------
app.get('/api/kbs', h(async (req, res) => res.json({ items: db.kbs.all() })));
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
    await chat.reply(req.params.id, req.body || {}, send, ctrl.signal);
  } catch (e) {
    console.error('[chat]', e.message);
    send('error', { error: e.message, code: e.code });
  }
  res.end();
});

// ---------- 静态资源 ----------
app.use('/media', express.static(db.MEDIA_DIR, { maxAge: '7d' }));
// 前端 3D 依赖从本地 node_modules 提供，不依赖外部 CDN
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build'), { maxAge: '30d' }));
// 静态资源按版本号加路径前缀：每次重启（部署）后 URL 都变，浏览器和 Cloudflare 不会再用到旧脚本
const PUBLIC = path.join(__dirname, '..', 'public');
const BUILD = Date.now().toString(36);
app.use('/v/:build', express.static(PUBLIC, { maxAge: '365d', immutable: true }));
app.use(express.static(PUBLIC, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
const indexHtml = () =>
  fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/(href|src)="\/(css|js)\//g, `$1="/v/${BUILD}/$2/`);
app.get(/^\/(?!api|media|vendor|v\/).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('html').send(indexHtml());
});
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

const PORT = Number(process.env.PORT) || 3800;
// HOST=127.0.0.1 时只监听本机，外网无法通过 IP+端口访问（由反向代理/隧道转发）
const HOST = process.env.HOST || undefined;

async function main() {
  await seed.run();
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
