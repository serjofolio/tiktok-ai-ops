// 轻量 JSON 文件存储：无需安装数据库，Windows / macOS / Linux 开箱即用
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
for (const d of [DATA_DIR, MEDIA_DIR, UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });

const cache = new Map();
const timers = new Map();

function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function load(name, fallback = []) {
  if (cache.has(name)) return cache.get(name);
  let value = fallback;
  try {
    if (fs.existsSync(file(name))) value = JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (e) {
    console.warn(`[db] ${name}.json 读取失败，使用默认值:`, e.message);
  }
  cache.set(name, value);
  return value;
}

// 合并短时间内的多次写入，写临时文件再重命名，避免写坏
function save(name) {
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => flush(name), 50));
}

function flush(name) {
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache.get(name), null, 2));
  fs.renameSync(tmp, file(name));
}

function flushAll() {
  for (const [name, t] of timers) {
    clearTimeout(t);
    flush(name);
  }
  timers.clear();
}
process.on('exit', flushAll);

const id = (prefix = '') => prefix + crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

// 简单集合封装
function collection(name) {
  return {
    all: () => load(name),
    get: (key) => load(name).find((x) => x.id === key),
    find: (fn) => load(name).filter(fn),
    insert(doc) {
      const item = { id: id(name.slice(0, 2) + '_'), createdAt: now(), ...doc };
      load(name).unshift(item);
      save(name);
      return item;
    },
    update(key, patch) {
      const item = load(name).find((x) => x.id === key);
      if (!item) return null;
      Object.assign(item, typeof patch === 'function' ? patch(item) : patch, { updatedAt: now() });
      save(name);
      return item;
    },
    remove(key) {
      const list = load(name);
      const i = list.findIndex((x) => x.id === key);
      if (i >= 0) list.splice(i, 1);
      save(name);
      return i >= 0;
    },
    replaceAll(items) {
      cache.set(name, items);
      save(name);
    },
    count: () => load(name).length,
  };
}

module.exports = {
  DATA_DIR,
  MEDIA_DIR,
  UPLOAD_DIR,
  load,
  save,
  flushAll,
  id,
  now,
  collection,
  products: collection('products'),
  scripts: collection('scripts'),
  images: collection('images'),
  videos: collection('videos'),
  kbs: collection('knowledge_bases'),
  docs: collection('documents'),
  chunks: collection('chunks'),
  agents: collection('agents'),
  sessions: collection('agent_sessions'),
  runs: collection('workflow_runs'),
  activity: collection('activity'),
};
