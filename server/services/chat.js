// Agent 聊天：普通 AI 对话 + 可选知识库检索增强（回答附引用来源），流式输出
const db = require('../db');
const llm = require('../providers/llm');
const rag = require('./rag');
const settings = require('../settings');

const chats = db.collection('chats');

const SYSTEM = `你是 TikTok Shop 跨境电商运营助手，服务于正在做 TikTok 美区/东南亚市场的卖家。
擅长：选品与竞品分析、FastMoss 等数据工具的使用、1688 供应链、利润测算、达人建联、短视频脚本、直播、广告投放、平台规则与合规。
回答要求：用中文，直接给可执行的结论和步骤；涉及平台规则时以知识库中的官方文档为准，知识库没有覆盖的要说明「以官方最新规则为准」；不确定的数据不要编造。`;

function list() {
  return chats.all().map(({ messages, ...c }) => ({ ...c, count: messages.length, preview: messages.at(-1)?.content?.slice(0, 60) || '' }));
}

function create() {
  return chats.insert({ title: '新对话', messages: [] });
}

/**
 * 流式回复：通过 send(event, data) 推送 SSE 事件
 * 事件：meta（模型、引用）→ think（思考过程，可选）→ delta（正文增量）→ done / error
 */
async function reply(id, { message, useKb = true }, send, signal) {
  const chat = chats.get(id);
  if (!chat) throw Object.assign(new Error('会话不存在'), { status: 404 });
  const text = String(message || '').trim();
  if (!text) throw Object.assign(new Error('请输入问题'), { status: 400 });
  const provider = settings.activeProvider();
  if (!provider) throw llm.noLLM();

  chat.messages.push({ role: 'user', content: text, at: db.now() });
  if (chat.title === '新对话') chat.title = text.slice(0, 28);

  let citations = [];
  let system = SYSTEM;
  if (useKb) {
    const hits = await rag.search(text, { topK: 5 });
    citations = hits.map((h, i) => ({ n: i + 1, docTitle: h.docTitle, content: h.content.slice(0, 600), score: Math.round(h.score * 100) / 100 }));
    if (hits.length)
      system += `\n\n以下是从内部知识库检索到的资料，回答时优先依据这些资料，并在相关句子后用 [编号] 标注来源：\n${hits.map((h, i) => `[${i + 1}] 《${h.docTitle}》\n${h.content}`).join('\n\n')}`;
  }
  send('meta', { model: provider.model, provider: provider.name, citations });

  const history = chat.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  let think = '';
  let out = '';
  try {
    const r = await llm.stream({ system, messages: history, maxTokens: 4096 }, (d) => {
      if (d.think) (think += d.think), send('think', { text: d.think });
      if (d.text) (out += d.text), send('delta', { text: d.text });
    }, { signal });
    out = r.text || out;
    // 首选模型出错、换成了备用模型：记下实际回答的模型
    if (r.model && r.model !== provider.model) Object.assign(provider, { model: r.model, name: r.provider || provider.name });
  } catch (e) {
    chats.update(id, { messages: chat.messages, title: chat.title }); // 保留用户的问题
    throw e;
  }
  const stopped = signal?.aborted;
  chat.messages.push({ role: 'assistant', content: out || (stopped ? '（已停止生成）' : ''), think, citations, model: provider.model, provider: provider.name, stopped, at: db.now() });
  chats.update(id, { messages: chat.messages, title: chat.title });
  send('done', { stopped });
}

module.exports = { chats, list, create, reply };
