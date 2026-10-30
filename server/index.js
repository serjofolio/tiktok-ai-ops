// TikTok AI 全能运营智能体平台 —— 服务入口
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const db = require('./db');
const settings = require('./settings');
const llm = require('./providers/llm');
const imageProvider = require('./providers/image');
const videoProvider = require('./providers/video');
const products = require('./services/products');
const scripts = require('./services/scripts');
const rag = require('./services/rag');
const agent = require('./services/agent');
const workflow = require('./services/workflow');
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

// 异步路由统一错误处理
const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(`[api] ${req.method} ${req.path}:`, e.message);
    res.status(e.status || 500).json({ error: e.message });
  });
const notFound = (what = '资源') => Object.assign(new Error(`${what}不存在`), { status: 404 });

// ---------- 总览 ----------
app.get('/api/dashboard', h(async (req, res) => {
  const list = products.list();
  const s = settings.get();
  res.json({
    stats: {
      products: list.length,
      hotProducts: list.filter((p) => p.score >= 62).length,
      scripts: db.scripts.count(),
      images: db.images.count(),
      videos: db.videos.count(),
      runs: db.runs.count(),
      docs: db.docs.count(),
      agents: db.agents.count(),
    },
    topProducts: list.slice(0, 6),
    recentRuns: db.runs.all().slice(0, 5).map((r) => ({ id: r.id, name: r.name, status: r.status, createdAt: r.createdAt, productName: r.outputs?.productName, steps: r.steps.map((x) => x.status) })),
    activity: db.activity.all().slice(0, 8),
    categoryStats: products.categories().map((c) => {
      const items = list.filter((p) => p.category === c);
      return { category: c, count: items.length, gmv: items.reduce((a, p) => a + (p.gmv7d || 0), 0) };
    }),
    providers: { llm: s.llm.provider, image: s.image.provider, video: s.video.provider, embedding: s.embedding.provider },
    store: s.store,
  });
}));

// ---------- 选品 ----------
app.get('/api/products', h(async (req, res) => res.json({ items: products.list(req.query), categories: products.categories() })));
app.get('/api/products/:id', h(async (req, res) => {
  const p = products.getScored(req.params.id);
  if (!p) throw notFound('商品');
  res.json(p);
}));
app.post('/api/products', h(async (req, res) => {
  const p = req.body;
  if (!p.name) throw Object.assign(new Error('商品名称必填'), { status: 400 });
  const nums = ['price', 'cost', 'commissionRate', 'sales7d', 'salesGrowth', 'videoCount', 'creatorCount', 'rating', 'reviews', 'competition'];
  for (const k of nums) p[k] = Number(p[k]) || 0;
  p.trend = p.trend || Array.from({ length: 14 }, () => Math.round(p.sales7d / 7));
  p.gmv7d = Math.round(p.sales7d * p.price);
  res.json(db.products.insert({ emoji: '📦', category: '其他', market: 'US', source: 'manual', ...p }));
}));
app.patch('/api/products/:id', h(async (req, res) => res.json(db.products.update(req.params.id, req.body) || {})));
app.delete('/api/products/:id', h(async (req, res) => res.json({ ok: db.products.remove(req.params.id) })));
app.post('/api/products/:id/analyze', h(async (req, res) => res.json(await products.analyze(req.params.id))));
app.post('/api/products/import', upload.single('file'), h(async (req, res) => {
  const text = req.file ? fs.readFileSync(req.file.path, 'utf8') : req.body.csv;
  if (req.file) fs.unlinkSync(req.file.path);
  res.json({ imported: products.importCSV(text || '') });
}));

// ---------- 脚本 ----------
app.get('/api/scripts', h(async (req, res) => res.json({ items: db.scripts.all(), styles: scripts.STYLES })));
app.get('/api/scripts/:id', h(async (req, res) => {
  const s = db.scripts.get(req.params.id);
  if (!s) throw notFound('脚本');
  res.json(s);
}));
app.post('/api/scripts/generate', h(async (req, res) => {
  const s = await scripts.generate(req.body);
  db.activity.insert({ type: 'script', text: `生成脚本：${s.title}` });
  res.json(s);
}));
app.patch('/api/scripts/:id', h(async (req, res) => res.json(db.scripts.update(req.params.id, req.body))));
app.delete('/api/scripts/:id', h(async (req, res) => res.json({ ok: db.scripts.remove(req.params.id) })));

// ---------- 图片 ----------
app.get('/api/images', h(async (req, res) => res.json({ items: db.images.all() })));
app.post('/api/images/generate', h(async (req, res) => {
  const { prompt, style, count = 1, size, referenceImage, title, productId } = req.body;
  if (!prompt) throw Object.assign(new Error('请输入提示词'), { status: 400 });
  const full = style ? `${prompt}, ${style}` : prompt;
  const items = [];
  for (let i = 0; i < Math.min(4, Number(count) || 1); i++) {
    const r = await imageProvider.generate({ prompt: full, size, referenceImage, title: title || prompt.slice(0, 24) });
    items.push(db.images.insert({ url: r.url, prompt: full, provider: r.provider, title: title || prompt.slice(0, 30), productId, source: 'studio' }));
  }
  db.activity.insert({ type: 'image', text: `生成 ${items.length} 张图片` });
  res.json({ items });
}));
app.post('/api/images/upload', upload.single('file'), h(async (req, res) => {
  if (!req.file) throw Object.assign(new Error('未选择文件'), { status: 400 });
  const ext = (path.extname(req.file.originalname) || '.png').toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) throw Object.assign(new Error('仅支持图片文件'), { status: 400 });
  const name = `${db.id('up_')}${ext}`;
  fs.renameSync(req.file.path, path.join(db.MEDIA_DIR, name));
  res.json(db.images.insert({ url: `/media/${name}`, prompt: '', title: req.file.originalname, provider: 'upload', source: 'upload' }));
}));
app.delete('/api/images/:id', h(async (req, res) => res.json({ ok: db.images.remove(req.params.id) })));

// ---------- 视频 ----------
app.get('/api/videos', h(async (req, res) => res.json({ items: db.videos.all() })));
app.get('/api/videos/:id', h(async (req, res) => {
  const v = db.videos.get(req.params.id);
  if (!v) throw notFound('视频');
  res.json(v);
}));
app.post('/api/videos/generate', h(async (req, res) => {
  const { image, prompt, duration, ratio, scenes, title } = req.body;
  if (!image && !scenes?.length) throw Object.assign(new Error('请选择一张图片'), { status: 400 });
  const { record } = videoProvider.generate({ image, prompt: prompt || '', duration, ratio, scenes, title });
  db.activity.insert({ type: 'video', text: `提交视频任务：${record.title}` });
  res.json(record);
}));
app.post('/api/videos/compose', h(async (req, res) => {
  // 用已有图片/片段合成分镜成片（本地播放器渲染）
  const { scenes, title } = req.body;
  if (!scenes?.length) throw Object.assign(new Error('至少需要一个分镜'), { status: 400 });
  const { record } = videoProvider.generate({ scenes, title, prompt: scenes[0].caption, composite: true });
  res.json(record);
}));
app.delete('/api/videos/:id', h(async (req, res) => res.json({ ok: db.videos.remove(req.params.id) })));

// ---------- 知识库 RAG ----------
app.get('/api/kbs', h(async (req, res) => res.json({ items: db.kbs.all() })));
app.post('/api/kbs', h(async (req, res) => {
  if (!req.body.name) throw Object.assign(new Error('请输入知识库名称'), { status: 400 });
  res.json(db.kbs.insert({ name: req.body.name, description: req.body.description || '', icon: req.body.icon || '📁', docCount: 0, chunkCount: 0 }));
}));
app.delete('/api/kbs/:id', h(async (req, res) => res.json({ ok: rag.removeKb(req.params.id) })));
app.get('/api/kbs/:id/docs', h(async (req, res) => res.json({ items: db.docs.find((d) => d.kbId === req.params.id) })));
app.post('/api/kbs/:id/docs', upload.array('files', 20), h(async (req, res) => {
  const out = [];
  if (req.files?.length) {
    for (const f of req.files) {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
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
app.get('/api/docs/:id/chunks', h(async (req, res) => res.json({ items: db.chunks.find((c) => c.docId === req.params.id).map(({ tokens, vector, ...c }) => c).sort((a, b) => a.index - b.index) })));
app.delete('/api/docs/:id', h(async (req, res) => res.json({ ok: rag.removeDocument(req.params.id) })));
app.post('/api/rag/search', h(async (req, res) => res.json({ items: await rag.search(req.body.query || '', { kbIds: req.body.kbIds, topK: req.body.topK || 6 }) })));
app.post('/api/rag/ask', h(async (req, res) => res.json(await rag.ask(req.body.question || '', { kbIds: req.body.kbIds }))));

// ---------- 智能体 ----------
const publicAgent = ({ apiKey, ...a }) => ({ ...a, hasKey: !!apiKey });
app.get('/api/agents', h(async (req, res) => res.json({ items: db.agents.all().map(publicAgent), tools: Object.entries(agent.TOOLS).map(([name, t]) => ({ name, title: t.title, description: t.description })) })));
app.post('/api/agents', h(async (req, res) => {
  const a = req.body;
  if (!a.name) throw Object.assign(new Error('请输入智能体名称'), { status: 400 });
  res.json(publicAgent(db.agents.insert({ avatar: '🤖', role: '自定义智能体', tools: [], kbIds: [], type: 'builtin', ...a })));
}));
app.patch('/api/agents/:id', h(async (req, res) => {
  const patch = { ...req.body };
  if (!patch.apiKey) delete patch.apiKey;
  res.json(publicAgent(db.agents.update(req.params.id, patch)));
}));
app.delete('/api/agents/:id', h(async (req, res) => res.json({ ok: db.agents.remove(req.params.id) })));
app.get('/api/agents/:id/sessions', h(async (req, res) => res.json({ items: db.sessions.find((s) => s.agentId === req.params.id).map(({ messages, ...s }) => ({ ...s, count: messages.length })) })));
app.post('/api/agents/:id/sessions', h(async (req, res) => res.json(db.sessions.insert({ agentId: req.params.id, title: '新对话', messages: [] }))));
app.get('/api/sessions/:id', h(async (req, res) => {
  const s = db.sessions.get(req.params.id);
  if (!s) throw notFound('会话');
  res.json(s);
}));
app.delete('/api/sessions/:id', h(async (req, res) => res.json({ ok: db.sessions.remove(req.params.id) })));
app.post('/api/sessions/:id/chat', h(async (req, res) => res.json({ messages: await agent.chat(req.params.id, req.body.message || '') })));

// 开放工具接口：供 Dify / Coze / n8n / 其他 Agent 框架以 HTTP 工具方式接入
app.get('/api/tools', h(async (req, res) => res.json({ tools: agent.toolSchemas() })));
app.post('/api/tools/:name', h(async (req, res) => res.json({ result: await agent.callTool(req.params.name, req.body) })));

// ---------- 工作流 ----------
app.get('/api/workflows', h(async (req, res) => res.json({ items: db.runs.all(), steps: workflow.STEPS, styles: scripts.STYLES })));
app.post('/api/workflows', h(async (req, res) => res.json(workflow.start(req.body))));
app.post('/api/workflows/batch', h(async (req, res) => {
  const ids = (req.body.productIds || []).slice(0, 10);
  res.json({ items: ids.map((productId) => workflow.start({ ...req.body.options, productId })) });
}));
app.get('/api/workflows/:id', h(async (req, res) => {
  const d = workflow.detail(req.params.id);
  if (!d) throw notFound('工作流');
  res.json(d);
}));
app.delete('/api/workflows/:id', h(async (req, res) => res.json({ ok: db.runs.remove(req.params.id) })));

// ---------- 设置 ----------
app.get('/api/settings', h(async (req, res) => res.json(settings.publicView())));
app.put('/api/settings', h(async (req, res) => {
  settings.update(req.body);
  res.json(settings.publicView());
}));
// 从上游服务商自动获取模型列表；body 可携带表单中尚未保存的 baseUrl/apiKey（脱敏 key 回退到已保存值）
app.post('/api/settings/models/:kind', h(async (req, res) => {
  const kind = req.params.kind;
  const saved = settings.get()[kind];
  if (!saved) throw Object.assign(new Error('未知类型'), { status: 400 });
  const body = req.body || {};
  const cfg = { ...saved, ...body };
  if (!body.apiKey || String(body.apiKey).includes('••')) cfg.apiKey = saved.apiKey;
  if (['mock', 'local'].includes(cfg.provider)) return res.json({ models: [] });
  if (cfg.provider === 'ark' || cfg.provider === 'generic') cfg.provider = 'openai';
  try {
    res.json({ models: await llm.listModels(cfg, kind) });
  } catch (e) {
    throw Object.assign(new Error(`上游返回错误：${e.message}`), { status: 502 });
  }
}));

app.post('/api/settings/test/:kind', h(async (req, res) => {
  const kind = req.params.kind;
  const t0 = Date.now();
  if (kind === 'llm') {
    const text = await llm.test(settings.get().llm);
    return res.json({ ok: true, message: text, ms: Date.now() - t0 });
  }
  if (kind === 'image') {
    const r = await imageProvider.generate({ prompt: 'a cute shopping bag icon, minimal, pastel', size: '1024x1024', title: '连接测试' });
    return res.json({ ok: true, message: '图片生成成功', url: r.url, ms: Date.now() - t0 });
  }
  if (kind === 'embedding') {
    const v = await rag.search('测试', { topK: 1 });
    return res.json({ ok: true, message: `检索正常（${settings.get().embedding.provider}）`, hits: v.length, ms: Date.now() - t0 });
  }
  res.status(400).json({ error: '未知测试类型' });
}));

// ---------- 静态资源 ----------
app.use('/media', express.static(db.MEDIA_DIR, { maxAge: '7d' }));
// 前端 3D 依赖从本地 node_modules 提供，不依赖外部 CDN
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build'), { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get(/^\/(?!api|media).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

const PORT = Number(process.env.PORT) || 3800;
// HOST=127.0.0.1 时只监听本机，外网无法通过 IP+端口访问（由反向代理/隧道转发）
const HOST = process.env.HOST || undefined;

async function main() {
  await seed.run();
  workflow.recover();
  const server = app.listen(PORT, HOST, () => {
    const url = `http://${HOST && HOST !== '0.0.0.0' ? HOST : 'localhost'}:${PORT}`;
    console.log(`\n  ✨ TikTok AI 运营智能体平台已启动：${url}\n  数据目录：${db.DATA_DIR}\n`);
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
