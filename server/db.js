// 轻量 JSON 文件存储：无需安装数据库，Windows / macOS / Linux 开箱即用
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ctx = require('./ctx');

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

const forbidden = () => Object.assign(new Error('没有权限修改这条数据'), { status: 403 });
const SCOPED = new Set();

/**
 * 集合封装。scoped 集合的每条记录带 uid（所属用户）：
 * - 登录用户只能看到自己的记录，以及 shared（平台内置、所有人可读）的记录；
 * - shared 记录只有管理员能改；
 * - 没有请求上下文时（启动初始化、命令行）不做过滤。
 */
function collection(name, { scoped = true } = {}) {
  if (scoped) SCOPED.add(name);
  const scope = () => (scoped ? ctx.store() : undefined);
  const visible = (x, s) => !s || (s.user && x.uid === s.user.id) || !!x.shared;
  const editable = (x, s) => !s || (s.user && x.uid === s.user.id) || (!!x.shared && s.user?.role === 'admin');
  const all = () => {
    const s = scope();
    return s ? load(name).filter((x) => visible(x, s)) : load(name);
  };
  const get = (key) => {
    const s = scope();
    return load(name).find((x) => x.id === key && visible(x, s));
  };
  const own = (key) => {
    const item = get(key);
    if (item && !editable(item, scope())) throw forbidden();
    return item;
  };
  return {
    all,
    get,
    find: (fn) => all().filter(fn),
    canEdit: (key) => {
      const item = get(key);
      return !!item && editable(item, scope());
    },
    insert(doc) {
      const s = scope();
      if (s && !s.user) throw Object.assign(new Error('请先登录'), { status: 401 });
      const item = { id: id(name.slice(0, 2) + '_'), createdAt: now(), ...(s ? { uid: s.user.id } : {}), ...doc };
      load(name).unshift(item);
      save(name);
      return item;
    },
    update(key, patch) {
      const item = own(key);
      if (!item) return null;
      Object.assign(item, typeof patch === 'function' ? patch(item) : patch, { updatedAt: now() });
      save(name);
      return item;
    },
    remove(key) {
      if (!own(key)) return false;
      const list = load(name);
      list.splice(list.findIndex((x) => x.id === key), 1);
      save(name);
      return true;
    },
    // 用户上下文中只替换自己能看到的那部分，其他用户的数据原样保留
    replaceAll(items) {
      const s = scope();
      if (s) {
        const keep = new Set(items.map((x) => x.id));
        const dropped = load(name).filter((x) => visible(x, s) && !keep.has(x.id));
        if (dropped.some((x) => !editable(x, s))) throw forbidden();
        items = [...load(name).filter((x) => !visible(x, s)), ...items];
      }
      cache.set(name, items);
      save(name);
    },
    count: () => all().length,
  };
}

// 删除某个用户的全部数据
function purgeUser(uid) {
  for (const name of SCOPED) {
    const list = load(name);
    const rest = list.filter((x) => x.uid !== uid || x.shared);
    if (rest.length !== list.length) cache.set(name, rest), save(name);
  }
}

// 早期单用户版本留下的无主数据，归到第一个管理员名下
function claimOrphans(uid) {
  let n = 0;
  for (const name of SCOPED) {
    for (const x of load(name)) if (!x.uid && !x.shared) (x.uid = uid), n++;
    save(name);
  }
  return n;
}

// 每个用户的数据量（管理员查看用户列表用）
function usage(uid) {
  const out = {};
  for (const name of SCOPED) out[name] = load(name).filter((x) => x.uid === uid && !x.shared).length;
  return out;
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
  purgeUser,
  claimOrphans,
  usage,
  products: collection('products'),
  scripts: collection('scripts'),
  kbs: collection('knowledge_bases'),
  docs: collection('documents'),
  chunks: collection('chunks'),
  activity: collection('activity'),
};
