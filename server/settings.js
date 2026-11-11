// 平台配置，保存在 data/settings.json，每个用户一份（users[uid]），互相不可见：
// - connectors：模型接入（文本、图片、视频等，见 connectors.js）和数据源 / ERP 连接；modelPrefs 每类的首选模型，autoFallback 出错自动换模型
// - providers：旧版的大模型供应商，第一次读到时迁移进 connectors（见 connectors.migrate）
// - dataSources：FastMoss、1688 等数据源接口凭证（申请通过后填写）
// - selection：利润测算的默认参数
// - store：店铺信息
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');
const ctx = require('./ctx');

const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  providers: [],
  activeProviderId: '',
  dataSources: {
    fastmoss: { apiKey: '', apiSecret: '', note: '' },
    ali1688: { appKey: '', appSecret: '', note: '' },
  },
  selection: {
    creatorRate: 10, // 达人佣金 %（商品数据里有佣金比例时以商品为准）
    returnRate: 5, // 退货/售后预留 %
    adRate: 10, // 广告/样品预留 %
    targetMargin: 20, // 净利率达标线 %
    storeMode: 'crossborder', // crossborder 跨境店 | local 本土店
    invited: { charger: false, powerbank: false }, // 已获得的定邀资质
    markets: {}, // 各站点平台费率、每单固定费、人民币汇率的自定义值（默认值见 services/selection.js）
  },
  store: { name: '我的 TikTok 小店', market: 'US', language: 'English' },
  connectors: [], // 数据源与 ERP 连接器（见 connectors.js）
};

// 文件结构：{ system: { allowRegister }, users: { [uid]: 用户配置 }, legacy: 单用户版本的旧配置（等第一个管理员认领） }
let file = null;

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) ? merge(base[k] || {}, over[k]) : over[k];
  }
  return out;
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, FILE);
}

function loadFile() {
  if (file) return file;
  let saved = {};
  try {
    if (fs.existsSync(FILE)) saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {}
  if (saved.users) file = { system: { allowRegister: true }, ...saved };
  else file = { system: { allowRegister: true }, users: {}, ...(Object.keys(saved).length ? { legacy: saved } : {}) };
  return file;
}

function normalize(saved = {}) {
  const cur = merge(DEFAULTS, saved);
  cur.providers = Array.isArray(saved.providers) ? saved.providers : [];
  cur.connectors = Array.isArray(saved.connectors) ? saved.connectors : []; // 不能共用 DEFAULTS 里的数组
  // 旧版单一 llm 配置迁移为一个供应商
  if (saved.llm && saved.llm.provider && saved.llm.provider !== 'mock' && saved.llm.apiKey && !cur.providers.length) {
    const p = { id: newId(), name: '已迁移的配置', protocol: saved.llm.provider === 'anthropic' ? 'anthropic' : 'openai', baseUrl: saved.llm.baseUrl, apiKey: saved.llm.apiKey, model: saved.llm.model, temperature: saved.llm.temperature ?? 0.7 };
    cur.providers.push(p);
    cur.activeProviderId = p.id;
  }
  for (const k of ['llm', 'image', 'video', 'embedding']) delete cur[k];
  return cur;
}

// 当前登录用户的配置；系统任务（无用户）返回默认值
function get() {
  const f = loadFile();
  const u = ctx.user();
  if (!u) return normalize();
  if (!f.users[u.id]) f.users[u.id] = normalize();
  const cfg = f.users[u.id];
  // 旧版「模型供应商」和中转站连接器合并成统一的模型接入（每个账号只做一次）
  if (!cfg.modelsV2) {
    require('./connectors').migrate(cfg);
    cfg.modelsV2 = true;
    save();
  }
  return cfg;
}

function set(value) {
  const u = ctx.user();
  if (!u) throw Object.assign(new Error('请先登录'), { status: 401 });
  loadFile().users[u.id] = value;
  save();
}

// 单用户版本的旧配置（含已接入的模型 Key）交给第一个管理员
function claimLegacy(uid) {
  const f = loadFile();
  if (!f.legacy) return false;
  f.users[uid] = normalize(f.legacy);
  delete f.legacy;
  save();
  return true;
}

function removeUser(uid) {
  delete loadFile().users[uid];
  save();
}

const system = () => loadFile().system;
function setSystem(patch) {
  Object.assign(loadFile().system, patch);
  save();
  return system();
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
  const next = merge(prev, rest);
  next.providers = prev.providers;
  next.activeProviderId = prev.activeProviderId;
  set(next);
  return next;
}

// ---------- 当前文本模型：统一接入里的首选文本模型（出错时 llm.js 会按顺序换备用的） ----------
function activeProvider() {
  if (!ctx.user()) return null;
  return require('./connectors').textPool()[0] || null;
}

function mask(key) {
  if (!key) return '';
  return key.length <= 8 ? '••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

// 给页面看的配置：只有数据源（密钥脱敏）、店铺和利润参数；模型接入的密钥走 connectors.publicList()
function publicView() {
  const all = get();
  const s = JSON.parse(JSON.stringify({ dataSources: all.dataSources, store: all.store, selection: all.selection }));
  for (const src of Object.values(s.dataSources || {})) for (const f of Object.keys(src)) if (/key|secret/i.test(f)) src[f] = mask(src[f]);
  return s;
}

module.exports = { get, update, claimLegacy, removeUser, system, setSystem, publicView, DEFAULTS, activeProvider };
