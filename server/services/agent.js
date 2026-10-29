// 智能体：基于 Function Calling 的工具调用循环；支持内置智能体和外部智能体（OpenAI 兼容端点，如 Dify / Coze / FastGPT）
const db = require('../db');
const llm = require('../providers/llm');
const products = require('./products');
const rag = require('./rag');
const scripts = require('./scripts');
const workflow = require('./workflow');
const imageProvider = require('../providers/image');
const videoProvider = require('../providers/video');

// ---------- 工具定义（同时通过 /api/tools 暴露给外部 Agent 平台调用）----------
const TOOLS = {
  search_products: {
    title: '搜索商品库',
    description: '按关键词、品类、排序方式搜索选品库，返回评分最高的商品列表',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '关键词，可为空' },
        category: { type: 'string', description: `品类，可选：${'美妆个护/家居生活/厨房好物/3C数码/汽车用品/服饰配件/宠物用品/母婴用品/运动户外'}` },
        sort: { type: 'string', enum: ['score', 'growth', 'sales', 'margin', 'competition'] },
        limit: { type: 'number', description: '返回数量，默认 5' },
      },
    },
    run: async ({ q, category, sort, limit = 5 }) =>
      products.list({ q, category, sort }).slice(0, limit).map((p) => ({
        id: p.id, name: p.name, nameCn: p.nameCn, category: p.category, price: p.price, sales7d: p.sales7d,
        salesGrowth: p.salesGrowth, margin: p.margin, competition: p.competition, score: p.score, grade: p.grade,
      })),
  },
  analyze_product: {
    title: '商品选品分析',
    description: '对指定商品做深度选品分析：卖点、人群、内容角度、风险、定价',
    parameters: { type: 'object', properties: { productId: { type: 'string', description: '商品 ID 或名称' } }, required: ['productId'] },
    run: async ({ productId }) => {
      const p = products.getScored(productId);
      if (!p) return { error: '未找到商品' };
      return { product: p.nameCn, score: p.score, ...(await products.analyze(p.id)) };
    },
  },
  search_knowledge: {
    title: '检索知识库',
    description: '检索内部 RAG 知识库（运营手册、平台规则、脚本公式、SOP 等）',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: async ({ query }, ctx) =>
      (await rag.search(query, { kbIds: ctx?.kbIds, topK: 4 })).map((h) => ({ doc: h.docTitle, content: h.content, score: Math.round(h.score * 100) / 100 })),
  },
  write_script: {
    title: '生成视频脚本',
    description: '为商品生成 TikTok 带货短视频分镜脚本',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: '商品 ID 或名称' },
        style: { type: 'string', enum: Object.keys(scripts.STYLES) },
        duration: { type: 'number', description: '时长（秒）' },
        language: { type: 'string', description: '口播语言，如 English / 中文' },
      },
      required: ['productId'],
    },
    run: async (a) => {
      const s = await scripts.generate({ productId: a.productId, productName: a.productId, style: a.style, duration: a.duration, language: a.language });
      return { scriptId: s.id, title: s.title, hook: s.hook, scenes: s.scenes.map((x) => ({ n: x.n, time: x.time, shot: x.shot, voiceover: x.voiceover, caption: x.caption })), hashtags: s.hashtags, cta: s.cta };
    },
  },
  generate_image: {
    title: '文生图',
    description: '根据英文提示词生成一张 9:16 商品营销图片',
    parameters: { type: 'object', properties: { prompt: { type: 'string' }, title: { type: 'string', description: '图片标题' } }, required: ['prompt'] },
    run: async ({ prompt, title }) => {
      const r = await imageProvider.generate({ prompt, title });
      const img = db.images.insert({ url: r.url, prompt, provider: r.provider, title: title || prompt.slice(0, 30), source: 'agent' });
      return { imageId: img.id, url: img.url };
    },
  },
  generate_video: {
    title: '图生视频',
    description: '用一张图片 + 运动描述生成短视频片段（异步任务，返回视频 ID）',
    parameters: { type: 'object', properties: { imageUrl: { type: 'string' }, prompt: { type: 'string' } }, required: ['imageUrl', 'prompt'] },
    run: async ({ imageUrl, prompt }) => {
      const { record } = videoProvider.generate({ image: imageUrl, prompt, duration: 5 });
      return { videoId: record.id, status: record.status, tip: '可在「视频工坊」查看进度' };
    },
  },
  run_workflow: {
    title: '一键工作流',
    description: '启动 选品→脚本→生图→视频→素材包 的端到端工作流',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string', description: '商品 ID，不填则自动选择评分最高的商品' }, category: { type: 'string' }, style: { type: 'string', enum: Object.keys(scripts.STYLES) } },
    },
    run: async (a) => {
      const p = a.productId ? products.getScored(a.productId) : null;
      const r = workflow.start({ productId: p?.id, category: a.category, style: a.style });
      return { runId: r.id, status: r.status, tip: '可在「工作流」页面查看实时进度' };
    },
  },
};

function toolSchemas(names) {
  return (names || Object.keys(TOOLS)).filter((n) => TOOLS[n]).map((n) => ({ name: n, description: TOOLS[n].description, parameters: TOOLS[n].parameters }));
}

async function callTool(name, args, ctx) {
  const t = TOOLS[name];
  if (!t) return { error: `未知工具 ${name}` };
  try {
    return await t.run(args || {}, ctx);
  } catch (e) {
    return { error: e.message };
  }
}

// ---------- 离线演示：基于意图的规则规划器 ----------
async function mockAgent(agent, text, push) {
  const allowed = new Set(agent.tools || []);
  const t = text.toLowerCase();
  const plan = [];
  const cat = ['美妆', '家居', '厨房', '3C', '数码', '汽车', '服饰', '宠物', '母婴', '运动'].find((c) => text.includes(c));
  const category = cat ? products.categories().find((c) => c.includes(cat)) : undefined;
  if (/选品|推荐|爆品|商品|潜力|蓝海|trend|product/.test(t)) plan.push(['search_products', { category, sort: /增长|趋势/.test(text) ? 'growth' : 'score', limit: 5 }]);
  if (/规则|违规|政策|方法|sop|怎么|如何|技巧|公式|达人|投放/.test(t)) plan.push(['search_knowledge', { query: text }]);
  if (/分析/.test(t)) plan.push(['analyze_product', { productId: '__top__' }]);
  if (/脚本|文案|script/.test(t)) plan.push(['write_script', { productId: '__top__', style: /开箱/.test(text) ? 'unboxing' : /对比/.test(text) ? 'compare' : 'pain', duration: 20 }]);
  if (/图|海报|image/.test(t)) plan.push(['generate_image', { prompt: '__top__', title: '' }]);
  if (/工作流|一键|全流程|workflow/.test(t)) plan.push(['run_workflow', { category }]);
  const steps = plan.filter(([n]) => allowed.has(n));
  let top = null;
  const results = [];
  for (const [name, rawArgs] of steps) {
    const args = { ...rawArgs };
    if (!top && args.productId === '__top__') top = products.list({ category })[0];
    if (args.productId === '__top__') args.productId = top.id;
    if (args.prompt === '__top__') {
      top = top || products.list({ category })[0];
      args.prompt = `${top.name}, hero product shot in a bright modern home, vertical 9:16, TikTok aesthetic`;
      args.title = top.nameCn;
    }
    const call = { id: db.id('call_'), name, args };
    push({ role: 'assistant', content: '', toolCalls: [call] });
    const result = await callTool(name, args, { kbIds: agent.kbIds });
    if (name === 'search_products' && Array.isArray(result) && result[0]) top = top || products.getScored(result[0].id);
    push({ role: 'tool', toolCallId: call.id, name, content: JSON.stringify(result) });
    results.push([name, result]);
  }
  return summarize(agent, text, results);
}

function summarize(agent, text, results) {
  if (!results.length)
    return `你好，我是 ${agent.name}（${agent.role}）。我可以帮你：\n\n- 🔎 **选品**：例如「推荐 5 个宠物类潜力爆品」\n- 📊 **分析**：例如「分析一下评分最高的美妆商品」\n- 🎬 **写脚本**：例如「给厨房类爆品写一个开箱脚本」\n- 🖼️ **生成图片**：例如「为最火的家居商品生成一张海报图」\n- 📚 **知识问答**：例如「TikTok 有哪些违规风险？」\n- ⚡ **一键工作流**：例如「启动一键全流程」\n\n> 当前为离线演示模式，配置大模型后可自由对话。`;
  const parts = [];
  for (const [name, r] of results) {
    if (r?.error) parts.push(`⚠️ ${TOOLS[name].title}失败：${r.error}`);
    else if (name === 'search_products')
      parts.push(`### 🔎 潜力商品 Top ${r.length}\n\n| 商品 | 品类 | 价格 | 7日销量 | 增长 | 评分 |\n|---|---|---|---|---|---|\n${r.map((p) => `| ${p.nameCn} | ${p.category} | $${p.price} | ${p.sales7d.toLocaleString()} | ${p.salesGrowth}% | **${p.score}** ${p.grade} |`).join('\n')}`);
    else if (name === 'analyze_product')
      parts.push(`### 📊 选品分析：${r.product}（${r.verdict}）\n\n${r.summary}\n\n**核心卖点**\n${r.sellingPoints.map((s) => `- ${s}`).join('\n')}\n\n**建议动作**\n${r.actions.map((s) => `- ${s}`).join('\n')}`);
    else if (name === 'search_knowledge')
      parts.push(`### 📚 知识库要点\n\n${r.slice(0, 3).map((h) => `- **《${h.doc}》** ${h.content.replace(/\n+/g, ' ').slice(0, 140)}…`).join('\n') || '未检索到相关内容'}`);
    else if (name === 'write_script')
      parts.push(`### 🎬 脚本：${r.title}\n\n**钩子：** ${r.hook}\n\n${r.scenes.map((s) => `${s.n}. \`${s.time}\` **${s.shot}** — ${s.voiceover}`).join('\n')}\n\n${r.hashtags.join(' ')}\n\n> 完整脚本已保存到「脚本工坊」`);
    else if (name === 'generate_image') parts.push(`### 🖼️ 图片已生成\n\n![image](${r.url})`);
    else if (name === 'generate_video') parts.push(`### 🎞️ 视频任务已提交（${r.videoId}），${r.tip}`);
    else if (name === 'run_workflow') parts.push(`### ⚡ 工作流已启动\n\n运行 ID：\`${r.runId}\`，${r.tip}`);
  }
  return parts.join('\n\n---\n\n');
}

// ---------- 外部智能体 ----------
async function externalAgent(agent, history) {
  const cfg = { provider: 'openai', baseUrl: agent.endpoint, apiKey: agent.apiKey, model: agent.model || 'default', temperature: 0.7 };
  const r = await llm.chat({ system: agent.systemPrompt, messages: history.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content)).map((m) => ({ role: m.role, content: m.content })) }, cfg);
  return r.text;
}

// ---------- 对话 ----------
async function chat(sessionId, text) {
  const session = db.sessions.get(sessionId);
  if (!session) throw new Error('会话不存在');
  const agent = db.agents.get(session.agentId);
  if (!agent) throw new Error('智能体不存在');
  const messages = session.messages;
  const before = messages.length;
  const push = (m) => messages.push({ ...m, at: db.now() });
  push({ role: 'user', content: text });
  if (!session.title || session.title === '新对话') session.title = text.slice(0, 24);

  let reply;
  if (agent.type === 'external') reply = await externalAgent(agent, messages);
  else if (llm.isMock()) reply = await mockAgent(agent, text, push);
  else {
    const kbNote = agent.kbIds?.length ? '回答运营规则、方法论类问题前，先调用 search_knowledge 检索内部知识库。' : '';
    const system = `${agent.systemPrompt}\n${kbNote}\n当前日期：${new Date().toISOString().slice(0, 10)}。使用中文 Markdown 回复。`;
    const tools = toolSchemas(agent.tools);
    for (let i = 0; i < 8; i++) {
      const history = messages.slice(-30).map(({ role, content, toolCalls, toolCallId, name }) => ({ role, content, toolCalls, toolCallId, name }));
      while (history[0]?.role === 'tool') history.shift();
      const r = await llm.chat({ system, messages: history, tools });
      if (!r.toolCalls.length) {
        reply = r.text;
        break;
      }
      push({ role: 'assistant', content: r.text, toolCalls: r.toolCalls });
      for (const c of r.toolCalls) {
        const result = await callTool(c.name, c.args, { kbIds: agent.kbIds });
        push({ role: 'tool', toolCallId: c.id, name: c.name, content: JSON.stringify(result).slice(0, 12000) });
      }
    }
    reply = reply || '（已达到最大工具调用轮数）';
  }
  push({ role: 'assistant', content: reply });
  db.sessions.update(sessionId, { messages, title: session.title });
  return messages.slice(before);
}

module.exports = { TOOLS, toolSchemas, callTool, chat };
