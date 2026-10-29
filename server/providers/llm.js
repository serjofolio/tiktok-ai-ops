// 大模型适配层：OpenAI 兼容协议（DeepSeek / 通义千问 / 豆包 / OpenAI 等）+ Anthropic Claude + 离线演示模式
// 内部统一消息格式：{ role: 'user'|'assistant'|'tool', content, toolCalls?, toolCallId?, name? }
const settings = require('../settings');

const isMock = () => (settings.get().llm.provider || 'mock') === 'mock';

async function http(url, opts, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || text.slice(0, 300);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

const trimSlash = (u) => (u || '').replace(/\/+$/, '');

// ---------- OpenAI 兼容 ----------
function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length)
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        })),
      });
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function openaiChat(cfg, { system, messages, tools, temperature, json }) {
  const body = {
    model: cfg.model,
    messages: toOpenAIMessages(system, messages),
    temperature: temperature ?? cfg.temperature ?? 0.8,
  };
  if (tools?.length)
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  if (json && !tools?.length) body.response_format = { type: 'json_object' };
  const data = await http(`${trimSlash(cfg.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  const msg = data.choices?.[0]?.message || {};
  return {
    text: msg.content || '',
    toolCalls: (msg.tool_calls || []).map((c) => ({
      id: c.id,
      name: c.function?.name,
      args: safeJSON(c.function?.arguments) || {},
    })),
  };
}

// ---------- Anthropic Claude ----------
function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      // 连续的工具结果合并到同一个 user 消息
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result')
        last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
      out.push({ role: 'assistant', content });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function anthropicChat(cfg, { system, messages, tools, temperature, json }) {
  const body = {
    model: cfg.model,
    max_tokens: 4096,
    temperature: Math.min(1, temperature ?? cfg.temperature ?? 0.8),
    messages: toAnthropicMessages(messages),
  };
  const sys = json ? `${system || ''}\n\n只输出合法的 JSON，不要包含任何其他文字。` : system;
  if (sys) body.system = sys;
  if (tools?.length)
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const data = await http(`${trimSlash(cfg.baseUrl || 'https://api.anthropic.com')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const blocks = data.content || [];
  return {
    text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input })),
  };
}

// ---------- 对外接口 ----------
async function chat(opts, cfgOverride) {
  const cfg = cfgOverride || settings.get().llm;
  if (cfg.provider === 'mock') throw new Error('MOCK_MODE');
  if (!cfg.apiKey) throw new Error('未配置大模型 API Key，请到「系统设置」中填写');
  return cfg.provider === 'anthropic' ? anthropicChat(cfg, opts) : openaiChat(cfg, opts);
}

async function complete(prompt, { system, temperature } = {}) {
  const r = await chat({ system, messages: [{ role: 'user', content: prompt }], temperature });
  return r.text;
}

async function completeJSON(prompt, { system, temperature } = {}) {
  const r = await chat({ system, messages: [{ role: 'user', content: prompt }], temperature, json: true });
  const parsed = safeJSON(r.text);
  if (!parsed) throw new Error('模型返回的内容不是合法 JSON：' + r.text.slice(0, 200));
  return parsed;
}

function safeJSON(s) {
  if (!s) return null;
  if (typeof s === 'object') return s;
  try {
    return JSON.parse(s);
  } catch {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {}
  }
  return null;
}

async function test(cfg) {
  const r = await chat({ messages: [{ role: 'user', content: '用一句话介绍你自己' }], temperature: 0.2 }, cfg);
  return r.text;
}

// ---------- 从上游拉取可用模型列表 ----------
const KIND_PATTERNS = {
  embedding: /embed|bge|m3e|gte-|e5-/i,
  image: /image|seedream|kolors|flux|dall-?e|stable-?diffusion|sdxl|cogview|wanx|imagen|midjourney|recraft/i,
  video: /video|seedance|kling|wan2|wan-|hailuo|veo|sora|runway|minimax-video|cogvideo|vidu|pixverse/i,
};

/**
 * 调用上游 /models 接口获取模型列表，并把与用途匹配的模型排在前面
 * @param {object} cfg 服务商配置（provider/baseUrl/apiKey）
 * @param {'llm'|'embedding'|'image'|'video'} kind 用途
 */
async function listModels(cfg, kind) {
  if (!cfg.apiKey) throw new Error('请先填写 API Key');
  let items;
  if (cfg.provider === 'anthropic') {
    const data = await http(`${trimSlash(cfg.baseUrl || 'https://api.anthropic.com')}/v1/models?limit=1000`, {
      headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    }, 20000);
    items = (data.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id, created: m.created_at }));
  } else {
    const data = await http(`${trimSlash(cfg.baseUrl)}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } }, 20000);
    const list = Array.isArray(data) ? data : data.data || data.models || [];
    items = list.map((m) => (typeof m === 'string' ? { id: m } : { id: m.id || m.name || m.model, name: m.display_name || m.name, owner: m.owned_by, created: m.created }));
  }
  items = items.filter((m) => m.id);
  const others = Object.entries(KIND_PATTERNS).filter(([k]) => k !== kind).map(([, re]) => re);
  for (const m of items) m.match = KIND_PATTERNS[kind] ? KIND_PATTERNS[kind].test(m.id) : !others.some((re) => re.test(m.id));
  items.sort((a, b) => b.match - a.match || a.id.localeCompare(b.id));
  return items;
}

module.exports = { isMock, chat, complete, completeJSON, safeJSON, test, http, trimSlash, listModels };
