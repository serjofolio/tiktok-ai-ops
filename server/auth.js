// 账号体系：注册 / 登录 / 会话 / 管理员
// - 第一个注册的账号自动成为管理员，并认领单用户版本留下的数据和模型配置
// - 其他人注册后只能看到自己的数据；管理员可以关闭注册、停用或删除账号
// - 密码用 scrypt 加盐哈希；会话令牌只在 Cookie（HttpOnly）里，服务器只存它的哈希
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const ctx = require('./ctx');
const settings = require('./settings');

const scrypt = promisify(crypto.scrypt);
const users = db.collection('users', { scoped: false });
const sessions = db.collection('auth_sessions', { scoped: false });

const COOKIE = 'tk_sid';
const SESSION_DAYS = 30;
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: (await scrypt(password, salt, 64)).toString('hex') };
}

async function verifyPassword(user, password) {
  const { hash } = await hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function checkUsername(name) {
  const u = String(name || '').trim();
  if (!/^[\p{L}\p{N}_.-]{2,32}$/u.test(u)) throw err('用户名 2–32 个字符，只能包含中英文、数字和 _ . -');
  return u;
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw err('密码至少 8 位');
  if (pw.length > 128) throw err('密码太长');
  return pw;
}

const findByName = (name) => users.all().find((u) => u.username.toLowerCase() === String(name).trim().toLowerCase());
const publicUser = (u) => u && { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, disabled: !!u.disabled };

// 新账号的初始数据：一个空的「TikTok 官方文档」知识库
function initUserData(user) {
  ctx.run(user, () => {
    if (!db.kbs.all().some((k) => k.official && k.uid === user.id))
      db.kbs.insert({ name: 'TikTok 官方文档', description: '上传从飞书/Lark 导出的 TikTok Shop 官方文档（Word/PDF），Agent 会优先依据这里回答', icon: '', official: true, docCount: 0, chunkCount: 0 });
  });
}

async function createUser({ username, password, role }) {
  const name = checkUsername(username);
  checkPassword(password);
  if (findByName(name)) throw err('用户名已被使用', 409);
  const first = !users.all().some((u) => u.role === 'admin');
  const user = users.insert({ username: name, role: first ? 'admin' : role || 'user', ...(await hashPassword(password)) });
  // 第一个管理员认领单用户版本的数据和配置
  if (user.role === 'admin' && first) {
    db.claimOrphans(user.id);
    settings.claimLegacy(user.id);
  }
  initUserData(user);
  return user;
}

async function register({ username, password }) {
  const hasAdmin = users.all().some((u) => u.role === 'admin');
  if (hasAdmin && !settings.system().allowRegister) throw err('管理员已关闭注册', 403);
  return createUser({ username, password });
}

// ---------- 登录失败限流：同一 IP 15 分钟内失败 10 次即暂时锁定 ----------
const failures = new Map();
const WINDOW = 15 * 60e3;
function throttle(ip) {
  const f = failures.get(ip);
  if (f && f.count >= 10 && Date.now() - f.at < WINDOW) throw err(`尝试次数过多，请 ${Math.ceil((WINDOW - (Date.now() - f.at)) / 60e3)} 分钟后再试`, 429);
}
function fail(ip) {
  const f = failures.get(ip);
  failures.set(ip, f && Date.now() - f.at < WINDOW ? { count: f.count + 1, at: f.at } : { count: 1, at: Date.now() });
}

async function login({ username, password }, ip) {
  throttle(ip);
  const user = findByName(username || '');
  const ok = user && (await verifyPassword(user, String(password || '')));
  if (!ok) {
    fail(ip);
    throw err('用户名或密码错误', 401);
  }
  if (user.disabled) throw err('该账号已被管理员停用', 403);
  failures.delete(ip);
  users.update(user.id, { lastLoginAt: db.now() });
  return user;
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.insert({ id: sha(token), userId: user.id, expiresAt: Date.now() + SESSION_DAYS * 86400e3 });
  return token;
}

function userFromToken(token) {
  if (!token) return null;
  const s = sessions.get(sha(token));
  if (!s) return null;
  if (s.expiresAt < Date.now()) return sessions.remove(s.id), null;
  const u = users.get(s.userId);
  return u && !u.disabled ? u : null;
}

function endSession(token) {
  if (token) sessions.remove(sha(token));
}

function endSessions(userId, exceptToken) {
  const keep = exceptToken ? sha(exceptToken) : null;
  sessions.replaceAll(sessions.all().filter((s) => s.userId !== userId || s.id === keep));
}

async function changePassword(user, oldPassword, newPassword, token) {
  if (!(await verifyPassword(user, String(oldPassword || '')))) throw err('当前密码不正确');
  users.update(user.id, await hashPassword(checkPassword(newPassword)));
  endSessions(user.id, token); // 其他设备上的登录全部失效
}

// ---------- Cookie ----------
function readToken(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}

function setCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const age = token ? SESSION_DAYS * 86400 : 0;
  res.setHeader('Set-Cookie', `${COOKIE}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`);
}

const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');

// ---------- 管理员 ----------
function listUsers() {
  return users.all().map((u) => ({ ...publicUser(u), usage: db.usage(u.id) })).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

async function adminUpdate(admin, id, { disabled, role }) {
  const u = users.get(id);
  if (!u) throw err('用户不存在', 404);
  if (u.id === admin.id) throw err('不能修改自己的状态或角色');
  const patch = {};
  if (disabled !== undefined) patch.disabled = !!disabled;
  if (role !== undefined) {
    if (!['admin', 'user'].includes(role)) throw err('角色只能是 admin 或 user');
    patch.role = role;
  }
  users.update(id, patch);
  if (patch.disabled) endSessions(id);
  return publicUser(users.get(id));
}

async function adminResetPassword(admin, id) {
  const u = users.get(id);
  if (!u) throw err('用户不存在', 404);
  const password = crypto.randomBytes(9).toString('base64url');
  users.update(id, await hashPassword(password));
  endSessions(id);
  return { password };
}

function adminDelete(admin, id) {
  const u = users.get(id);
  if (!u) throw err('用户不存在', 404);
  if (u.id === admin.id) throw err('不能删除自己');
  endSessions(id);
  db.purgeUser(id);
  settings.removeUser(id);
  users.remove(id);
  return { ok: true };
}

// 命令行：创建管理员或重置管理员密码
async function upsertAdmin(username, password) {
  const u = findByName(username);
  if (!u) return createUser({ username, password, role: 'admin' });
  users.update(u.id, { role: 'admin', disabled: false, ...(await hashPassword(checkPassword(password))) });
  endSessions(u.id);
  return users.get(u.id);
}

const hasUsers = () => users.count() > 0;

module.exports = {
  register, login, createSession, userFromToken, endSession, endSessions, changePassword, readToken, setCookie, clientIp, publicUser,
  listUsers, adminUpdate, adminResetPassword, adminDelete, upsertAdmin, hasUsers, initUserData,
};
