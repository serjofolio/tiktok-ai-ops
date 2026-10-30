// 平台配置，保存在 data/settings.json：
// - providers：大模型供应商列表（类似 CC Switch，可添加/编辑/删除/一键启用）
// - dataSources：FastMoss、1688 等数据源接口凭证（申请通过后填写）
// - selection：利润测算的默认参数
// - store：店铺信息
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');

const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  providers: [],
  activeProviderId: '',
  dataSources: {
    fastmoss: { apiKey: '', apiSecret: '', note: '' },
    ali1688: { appKey: '', appSecret: '', note: '' },
  },
  selection: {
    platformFeeRate: 8, // TikTok Shop 平台佣金 %
    creatorRate: 15, // 达人佣金 %（商品数据里有佣金率时以商品为准）
    returnRate: 5, // 退货/售后预留 %
    adRate: 10, // 广告/样品预留 %
    targetMargin: 20, // 净利率达标线 %
  },
  store: { name: '我的 TikTok 小店', market: 'US', language: 'English' },
};

let current = null;

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) ? merge(base[k] || {}, over[k]) : over[k];
  }
  return out;
}

function save() {
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
}

function get() {
  if (current) return current;
  let saved = {};
  try {
    if (fs.existsSync(FILE)) saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {}
  current = merge(DEFAULTS, saved);
  current.providers = Array.isArray(saved.providers) ? saved.providers : [];
  // 旧版单一 llm 配置迁移为一个供应商
  if (saved.llm && saved.llm.provider && saved.llm.provider !== 'mock' && saved.llm.apiKey && !current.providers.length) {
    const p = { id: newId(), name: '已迁移的配置', protocol: saved.llm.provider === 'anthropic' ? 'anthropic' : 'openai', baseUrl: saved.llm.baseUrl, apiKey: saved.llm.apiKey, model: saved.llm.model, temperature: saved.llm.temperature ?? 0.7 };
    current.providers.push(p);
    current.activeProviderId = p.id;
  }
  delete current.llm;
  delete current.image;
  delete current.video;
  delete current.embedding;
  return current;
}

const newId = () => 'pv_' + crypto.randomBytes(5).toString('hex');

function update(patch) {
  const prev = get();
  for (const section of ['dataSources']) {
    // 脱敏值回传时保留原值
    for (const [k, v] of Object.entries(patch?.[section] || {})) {
      for (const f of Object.keys(v || {})) if (typeof v[f] === 'string' && v[f].includes('••')) v[f] = prev[section]?.[k]?.[f] || '';
    }
  }
  const { providers, activeProviderId, ...rest } = patch || {};
  current = merge(prev, rest);
  current.providers = prev.providers;
  current.activeProviderId = prev.activeProviderId;
  save();
  return current;
}

// ---------- 供应商 ----------
function activeProvider() {
  const s = get();
  return s.providers.find((p) => p.id === s.activeProviderId) || null;
}

function saveProvider(input) {
  const s = get();
  const fields = ['name', 'protocol', 'baseUrl', 'apiKey', 'model', 'temperature', 'presetId', 'website'];
  const clean = {};
  for (const f of fields) if (input[f] !== undefined) clean[f] = typeof input[f] === 'string' ? input[f].trim() : input[f];
  if (!clean.name && !input.id) throw Object.assign(new Error('请填写名称'), { status: 400 });
  if (clean.protocol && !['openai', 'anthropic'].includes(clean.protocol)) throw Object.assign(new Error('协议只能是 openai 或 anthropic'), { status: 400 });
  let p = input.id && s.providers.find((x) => x.id === input.id);
  if (p) {
    if (typeof clean.apiKey === 'string' && (clean.apiKey === '' || clean.apiKey.includes('••'))) delete clean.apiKey;
    Object.assign(p, clean, { updatedAt: new Date().toISOString() });
  } else {
    if (!clean.baseUrl) throw Object.assign(new Error('请填写 Base URL'), { status: 400 });
    p = { id: newId(), protocol: 'openai', temperature: 0.7, createdAt: new Date().toISOString(), ...clean };
    s.providers.push(p);
    if (!s.activeProviderId) s.activeProviderId = p.id; // 第一个添加的自动启用
  }
  save();
  return p;
}

function removeProvider(id) {
  const s = get();
  s.providers = s.providers.filter((p) => p.id !== id);
  if (s.activeProviderId === id) s.activeProviderId = s.providers[0]?.id || '';
  save();
}

function activate(id) {
  const s = get();
  if (!s.providers.some((p) => p.id === id)) throw Object.assign(new Error('供应商不存在'), { status: 404 });
  s.activeProviderId = id;
  save();
}

function getProvider(id) {
  return get().providers.find((p) => p.id === id) || null;
}

function mask(key) {
  if (!key) return '';
  return key.length <= 8 ? '••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function publicView() {
  const s = JSON.parse(JSON.stringify(get()));
  s.providers = s.providers.map((p) => ({ ...p, apiKey: mask(p.apiKey), hasKey: !!p.apiKey }));
  for (const src of Object.values(s.dataSources)) for (const f of Object.keys(src)) if (/key|secret/i.test(f)) src[f] = mask(src[f]);
  return s;
}

module.exports = { get, update, publicView, DEFAULTS, activeProvider, saveProvider, removeProvider, activate, getProvider };
