// 大模型调用层：使用「接入配置」中当前启用的供应商
// 协议：OpenAI 兼容（智谱 GLM / DeepSeek / Kimi / 通义 / 豆包 / OpenAI 等）与 Anthropic（Claude、智谱 Anthropic 兼容端点）
// 内部统一消息格式：{ role: 'user'|'assistant'|'tool', content, toolCalls?, toolCallId? }
const settings = require('../settings');
const { safeFetch } = require('../net');

// 常用供应商预设；models 为上游不提供模型列表时的备选
const PRESETS = [
  { id: 'glm', name: '智谱 GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.7', 'glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash'], website: 'https://open.bigmodel.cn/usercenter/apikeys', tip: '普通 API Key，按量计费' },
  { id: 'glm-coding', name: '智谱 GLM 编码套餐', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', models: ['glm-4.7', 'glm-4.6', 'glm-4.5', 'glm-4.5-air'], website: 'https://open.bigmodel.cn/usercenter/apikeys', tip: 'GLM Coding Plan 套餐额度（和 Codex 等编码工具用的是同一套额度）' },
  { id: 'glm-anthropic', name: '智谱 GLM（Anthropic 协议）', protocol: 'anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic', models: ['glm-4.7', 'glm-4.6', 'glm-4.5-air'], website: 'https://open.bigmodel.cn/usercenter/apikeys', tip: 'Claude Code 等工具使用的端点' },
  { id: 'zai', name: 'Z.AI（智谱国际站）', protocol: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', models: ['glm-4.7', 'glm-4.6', 'glm-4.5-air'], website: 'https://z.ai/manage-apikey/apikey-list' },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], website: 'https://platform.deepseek.com/api_keys' },
  { id: 'kimi', name: 'Kimi（月之暗面）', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2-turbo-preview', 'moonshot-v1-32k'], website: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'qwen', name: '通义千问', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'], website: 'https://bailian.console.aliyun.com/' },
  { id: 'doubao', name: '豆包（火山方舟）', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: [], website: 'https://console.volcengine.com/ark', tip: '模型处填写推理接入点 ID 或模型 ID' },
  { id: 'siliconflow', name: '硅基流动', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'], website: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4.1-mini', 'gpt-4.1'], website: 'https://platform.openai.com/api-keys' },
  { id: 'claude', name: 'Anthropic Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], website: 'https://console.anthropic.com/settings/keys' },
  { id: 'custom', name: '自定义', protocol: 'openai', baseUrl: '', models: [] },
];

const noLLM = () => Object.assign(new Error('还没有接入大模型：请到「接入配置」点「添加模型」，启用一个文本模型'), { status: 400, code: 'NO_LLM' });
const isMock = () => !settings.activeProvider();

// ---------- 出错自动换模型 ----------
// 没指定模型时：首选文本模型 → 其余启用的文本模型（最多再试 3 个）。没额度、Key 失效、超时、上游报错都会换
const MAX_TRIES = 4;
function candidates() {
  const connectors = require('../connectors');
  const pool = connectors.textPool();
  if (!pool.length) throw noLLM();
  return connectors.autoFallback() ? pool.slice(0, MAX_TRIES) : pool.slice(0, 1);
}
async function withFallback(fn, { shouldStop } = {}) {
  const connectors = require('../connectors');
  const tried = [];
  let first;
  for (const cfg of candidates()) {
    try {
      const r = await fn(resolve(cfg));
      if (cfg.ref) connectors.markOk(cfg.ref);
      if (tried.length) console.warn(`[llm] ${tried.map((t) => t.model).join('、')} 出错，已换成 ${cfg.model}`);
      return r && typeof r === 'object' ? Object.assign(r, { model: cfg.model, provider: cfg.name, fellBack: tried }) : r;
    } catch (e) {
      if (e.name === 'AbortError' || shouldStop?.()) throw e;
      if (cfg.ref) connectors.markFail(cfg.ref);
      first = first || e;
      tried.push({ model: cfg.model, provider: cfg.name, error: String(e.message).slice(0, 160) });
    }
  }
  if (tried.length > 1) first.message = `${first.message}（已自动换了 ${tried.length - 1} 个备用模型，也都失败了：${tried.slice(1).map((t) => `${t.model}：${t.error.slice(0, 60)}`).join('；')}）`;
  throw first;
}

const trimSlash = (u) => (u || '').trim().replace(/\/+$/, '');
// Anthropic 协议会自动拼 /v1/messages，用户多填的 /v1 去掉，避免出现 /v1/v1
const anthropicBase = (u) => trimSlash(u || 'https://api.anthropic.com').replace(/\/v1$/, '');

async function readError(res) {
  const text = await res.text().catch(() => '');
  let msg = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    msg = j.error?.message || j.message || j.msg || j.error || msg;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
  } catch {}
  const hint = res.status === 401 ? '（API Key 无效或已过期）' : res.status === 404 ? '（地址或模型名不对，请检查 Base URL 和协议是否匹配）' : res.status === 429 ? '（额度用完或请求太频繁）' : '';
  return new Error(`上游返回 HTTP ${res.status}${hint}：${msg}`);
}

async function http(url, opts, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, { ...opts, signal: opts?.signal || ctrl.signal });
    if (!res.ok) throw await readError(res);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求上游超时');
    if (e.cause?.code) throw new Error(`无法连接上游（${e.cause.code}），请检查 Base URL`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// 官方 Anthropic 只认 x-api-key；兼容端点（如智谱）同时接受 Bearer
function anthropicHeaders(cfg) {
  const h = { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
  if (!/api\.anthropic\.com/.test(cfg.baseUrl || 'api.anthropic.com')) h.Authorization = `Bearer ${cfg.apiKey}`;
  return h;
}

// ---------- 消息格式转换 ----------
function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length)
      out.push({ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) });
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const content = m.content ? [{ type: 'text', text: m.content }] : [];
      for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
      out.push({ role: 'assistant', content });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

const isGLM = (cfg) => /bigmodel\.cn|z\.ai/i.test(cfg.baseUrl || '');

function buildRequest(cfg, { system, messages, tools, temperature, json, stream, maxTokens, noThinking }) {
  const temp = temperature ?? cfg.temperature ?? 0.7;
  if (cfg.protocol === 'anthropic') {
    const body = { model: cfg.model, max_tokens: maxTokens || 8192, temperature: Math.min(1, temp), messages: toAnthropicMessages(messages) };
    const sys = json ? `${system || ''}\n\n只输出合法的 JSON，不要输出任何其他文字。` : system;
    if (sys) body.system = sys;
    if (tools?.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    if (stream) body.stream = true;
    return { url: `${anthropicBase(cfg.baseUrl)}/v1/messages`, headers: anthropicHeaders(cfg), body };
  }
  const body = { model: cfg.model, messages: toOpenAIMessages(system, messages), temperature: temp };
  if (tools?.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  if (json && !tools?.length) body.response_format = { type: 'json_object' };
  if (stream) body.stream = true;
  if (maxTokens) body.max_tokens = maxTokens;
  if (noThinking && isGLM(cfg)) body.thinking = { type: 'disabled' };
  return { url: `${trimSlash(cfg.baseUrl)}/chat/completions`, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }, body };
}

function resolve(cfgOverride) {
  const cfg = cfgOverride || settings.activeProvider();
  if (!cfg) throw noLLM();
  if (!cfg.apiKey) throw Object.assign(new Error(`供应商「${cfg.name || ''}」没有填写 API Key`), { status: 400 });
  if (!cfg.model) throw Object.assign(new Error(`供应商「${cfg.name || ''}」没有选择模型`), { status: 400 });
  return cfg;
}

// ---------- 非流式 ----------
async function chat(opts, cfgOverride) {
  if (!cfgOverride) return withFallback((cfg) => chatOnce(opts, cfg));
  return chatOnce(opts, cfgOverride);
}
async function chatOnce(opts, cfgOverride) {
  const cfg = resolve(cfgOverride);
  const send = (body) => http(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(body) }, opts.timeoutMs || 180000);
  const req = buildRequest(cfg, opts);
  let data;
  try {
    data = await send(req.body);
  } catch (e) {
    // 部分 OpenAI 兼容服务不支持 response_format，去掉后重试一次
    if ((req.body.response_format || req.body.thinking) && /response_format|json_object|thinking|400/.test(e.message)) {
      delete req.body.response_format;
      delete req.body.thinking;
      data = await send(req.body);
    } else throw e;
  }
  if (cfg.protocol === 'anthropic') {
    const blocks = data.content || [];
    return { text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input })) };
  }
  const msg = data.choices?.[0]?.message || {};
  return { text: msg.content || '', finishReason: data.choices?.[0]?.finish_reason, toolCalls: (msg.tool_calls || []).map((c) => ({ id: c.id, name: c.function?.name, args: safeJSON(c.function?.arguments) || {} })) };
}

// ---------- 流式：onDelta({ text?, think? })，返回完整文本 ----------
// 还没输出任何内容就出错时换下一个模型；已经输出了一部分就不换了（避免前后两个模型的话拼在一起）
async function stream(opts, onDelta, { signal, cfg: cfgOverride } = {}) {
  if (cfgOverride) return streamOnce(opts, onDelta, { signal, cfg: cfgOverride });
  let started = false;
  const emit = (d) => {
    started = true;
    onDelta(d);
  };
  return withFallback((cfg) => streamOnce(opts, emit, { signal, cfg }), { shouldStop: () => started || signal?.aborted });
}
async function streamOnce(opts, onDelta, { signal, cfg: cfgOverride } = {}) {
  const cfg = resolve(cfgOverride);
  const req = buildRequest(cfg, { ...opts, stream: true });
  let res;
  try {
    res = await safeFetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
  } catch (e) {
    if (e.name === 'AbortError') return { text: '', think: '', aborted: true };
    if (e.status) throw e;
    throw new Error(`无法连接上游（${e.cause?.code || e.message}），请检查 Base URL`);
  }
  if (!res.ok) throw await readError(res);
  const ctype = res.headers.get('content-type') || '';
  // 上游忽略了 stream 参数、直接返回 JSON 的情况
  if (!ctype.includes('event-stream')) {
    const data = JSON.parse(await res.text());
    const text = cfg.protocol === 'anthropic' ? (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') : data.choices?.[0]?.message?.content || '';
    onDelta({ text });
    return { text, think: '' };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', think = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let j;
        try {
          j = JSON.parse(payload);
        } catch {
          continue;
        }
        if (j.error) throw new Error(`上游错误：${j.error.message || JSON.stringify(j.error)}`);
        let dt = '', dk = '';
        if (cfg.protocol === 'anthropic') {
          if (j.type === 'content_block_delta') dt = j.delta?.text || '', (dk = j.delta?.thinking || '');
        } else {
          const d = j.choices?.[0]?.delta || {};
          dt = d.content || '';
          dk = d.reasoning_content || d.reasoning || '';
        }
        if (dt) text += dt;
        if (dk) think += dk;
        if (dt || dk) onDelta({ text: dt, think: dk });
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return { text, think, aborted: true };
    throw e;
  }
  return { text, think };
}

async function complete(prompt, { system, temperature } = {}) {
  return (await chat({ system, messages: [{ role: 'user', content: prompt }], temperature })).text;
}

// 带图片的消息：OpenAI 兼容用 image_url，Anthropic 用 base64 块；智谱的 base64 不带 data: 前缀
function imageMessage(cfg, text, images) {
  if (cfg.protocol === 'anthropic') return { role: 'user', content: [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } })), { type: 'text', text }] };
  return { role: 'user', content: [...images.map((i) => ({ type: 'image_url', image_url: { url: isGLM(cfg) ? i.b64 : `data:${i.mime};base64,${i.b64}` } })), { type: 'text', text }] };
}

// 返回的不是合法 JSON 也算出错：没指定模型时换下一个
async function completeJSON(prompt, { system, temperature, maxTokens, timeoutMs, noThinking, cfg, messages } = {}) {
  const once = async (c) => {
    const r = await chatOnce({ system, messages: messages || [{ role: 'user', content: prompt }], temperature: temperature ?? 0.4, json: true, maxTokens, timeoutMs, noThinking }, c);
    const parsed = safeJSON(r.text);
    if (!parsed) throw new Error('模型返回的内容不是合法 JSON，请重试或换一个模型：' + r.text.slice(0, 160));
    return parsed;
  };
  if (cfg) return once(cfg);
  const out = await withFallback(async (c) => ({ v: await once(c) }));
  return out.v;
}

function safeJSON(s) {
  if (!s) return null;
  if (typeof s === 'object') return s;
  const tries = [s, s.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)];
  for (const t of tries) {
    if (!t) continue;
    try {
      return JSON.parse(t);
    } catch {}
  }
  return null;
}

// ---------- 模型列表：优先从上游获取，失败时返回预设列表 ----------
async function listModels(cfg) {
  const preset = PRESETS.find((p) => p.id === cfg.presetId) || PRESETS.find((p) => trimSlash(p.baseUrl) === trimSlash(cfg.baseUrl));
  const fallback = (preset?.models || []).map((id) => ({ id, source: 'preset' }));
  if (!cfg.apiKey) return { models: fallback, source: 'preset', error: '未填写 API Key，显示预设模型' };
  try {
    let items;
    if (cfg.protocol === 'anthropic') {
      const data = await http(`${anthropicBase(cfg.baseUrl)}/v1/models?limit=1000`, { headers: anthropicHeaders(cfg) }, 20000);
      items = (data.data || []).map((m) => ({ id: m.id, name: m.display_name }));
    } else {
      const data = await http(`${trimSlash(cfg.baseUrl)}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } }, 20000);
      const list = Array.isArray(data) ? data : data.data || data.models || [];
      items = list.map((m) => (typeof m === 'string' ? { id: m } : { id: m.id || m.name || m.model, name: m.display_name }));
    }
    items = items.filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id));
    if (items.length) return { models: items, source: 'upstream' };
    return { models: fallback, source: 'preset', error: '上游没有返回模型列表，显示预设模型' };
  } catch (e) {
    return { models: fallback, source: 'preset', error: `上游不支持获取模型列表（${e.message.slice(0, 80)}），显示预设模型` };
  }
}

// 测试连接：给足 token，避免会先思考的模型（如 GLM-5 系列）在思考阶段就用完额度
async function test(cfg) {
  const t0 = Date.now();
  const r = await chat({ messages: [{ role: 'user', content: '请只回复：连接成功' }], temperature: 0.1, maxTokens: 1024 }, resolve(cfg));
  const text = r.text.trim();
  return { text: text ? text.slice(0, 80) : '连接成功（模型只返回了思考内容）', ms: Date.now() - t0 };
}

module.exports = { PRESETS, isMock, noLLM, chat, stream, complete, completeJSON, imageMessage, safeJSON, test, http, trimSlash, listModels };
