// 平台配置：模型服务商、API Key 等，保存在 data/settings.json
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  llm: {
    provider: 'mock', // mock | openai | anthropic
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.8,
  },
  embedding: {
    provider: 'local', // local(BM25) | openai
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'text-embedding-3-small',
  },
  image: {
    provider: 'mock', // mock | openai
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    model: 'doubao-seedream-4-0-250828',
    size: '1024x1792',
  },
  video: {
    provider: 'mock', // mock | ark | generic
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    model: 'doubao-seedance-1-0-pro-250528',
    // generic 模式：自定义 HTTP 异步任务接口
    createPath: '/videos/generations',
    queryPath: '/videos/generations/{id}',
    idField: 'id',
    statusField: 'status',
    urlField: 'video_url',
  },
  store: {
    name: '我的 TikTok 小店',
    market: 'US',
    language: 'English',
  },
};

let current = null;

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) ? merge(base[k] || {}, over[k]) : over[k];
  }
  return out;
}

function get() {
  if (current) return current;
  let saved = {};
  try {
    if (fs.existsSync(FILE)) saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {}
  current = merge(DEFAULTS, saved);
  return current;
}

function update(patch) {
  const prev = get();
  // 前端回传的脱敏 key 不覆盖原值
  for (const section of Object.keys(patch || {})) {
    if (patch[section] && typeof patch[section].apiKey === 'string' && patch[section].apiKey.includes('••')) {
      patch[section].apiKey = prev[section]?.apiKey || '';
    }
  }
  current = merge(prev, patch);
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return current;
}

function mask(key) {
  if (!key) return '';
  return key.length <= 8 ? '••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function publicView() {
  const s = JSON.parse(JSON.stringify(get()));
  for (const k of Object.keys(s)) if (s[k] && 'apiKey' in s[k]) s[k].apiKey = mask(s[k].apiKey);
  return s;
}

module.exports = { get, update, publicView, DEFAULTS };
