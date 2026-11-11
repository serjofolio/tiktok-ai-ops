// 出站请求统一入口：地址由用户填写的请求（模型接入、连接器、知识库链接、成片下载）都走这里
// 普通用户不能让服务器访问内网：逐跳检查跳转目标，并在建立连接时再查一次解析结果（防 DNS 重绑定）
// 管理员可以访问内网（自建 n8n、本机模型服务）
const dns = require('dns');
const net = require('net');
const { File } = require('buffer');
const { fetch: ufetch, Agent, FormData } = require('undici');
const ctx = require('./ctx');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) blocked.addSubnet(a, p, 'ipv6');

// 把 IPv6 地址展开成 8 组十六进制，用来取出里面内嵌的 IPv4（NAT64 / 6to4）
function hextets(ip) {
  const raw = ip.split('%')[0];
  const dotted = raw.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  const text = dotted ? raw.replace(dotted[0], ((Number(dotted[1]) << 8) | Number(dotted[2])).toString(16) + ':' + ((Number(dotted[3]) << 8) | Number(dotted[4])).toString(16)) : raw;
  const [head, tail] = text.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const fill = text.includes('::') ? Array(8 - a.length - b.length).fill('0') : [];
  return [...a, ...fill, ...b].map((x) => parseInt(x, 16) || 0);
}
const v4From = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (blocked.check(ip.split('%')[0], 'ipv6')) return true; // IPv4 映射地址（::ffff:a.b.c.d）BlockList 会按 IPv4 规则判断
  const h = hextets(ip);
  if (h[0] === 0x64 && h[1] === 0xff9b) return blocked.check(v4From(h[6], h[7]), 'ipv4'); // NAT64
  if (h[0] === 0x2002) return blocked.check(v4From(h[1], h[2]), 'ipv4'); // 6to4
  return false;
}

const allowPrivate = () => ctx.user()?.role === 'admin';

function assertUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw err('地址格式不正确');
  }
  if (!/^https?:$/.test(u.protocol)) throw err('地址只能是 http(s)');
  if (allowPrivate()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host) || isPrivateIp(host)) throw err('不能请求内网地址');
  return u;
}

// 建立连接时检查域名解析结果：地址检查和真正连接之间，域名不能被换成内网 IP
function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (e, addrs) => {
    if (e) return cb(e);
    if (addrs.some((a) => isPrivateIp(a.address))) return cb(Object.assign(new Error('不能请求内网地址'), { code: 'EPRIVATE' }));
    if (options?.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}
const publicAgent = new Agent({ connect: { lookup: guardedLookup } });

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const SECRET_HEADERS = /^(authorization|x-api-key|api-key|cookie)$/i;

// 跟 fetch 用法一样；传 redirect: 'manual' 时把 3xx 原样返回
async function safeFetch(url, opts = {}) {
  const { redirect, ...rest } = opts;
  let init = { ...rest, redirect: 'manual' };
  let current = String(url);
  const dispatcher = allowPrivate() ? undefined : publicAgent;
  for (let hop = 0; hop <= 5; hop++) {
    const u = assertUrl(current);
    let res;
    try {
      res = await ufetch(u.href, dispatcher ? { ...init, dispatcher } : init);
    } catch (e) {
      if (e.cause?.code === 'EPRIVATE') throw err('不能请求内网地址');
      throw e;
    }
    if (redirect === 'manual' || !REDIRECTS.has(res.status)) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    await res.body?.cancel().catch(() => {});
    const next = new URL(location, u);
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && init.method && init.method !== 'GET')) {
      const { body, ...noBody } = init;
      init = { ...noBody, method: 'GET' };
    }
    // 跳到别的站点时不带上密钥
    if (next.origin !== u.origin && init.headers) init = { ...init, headers: Object.fromEntries(Object.entries(init.headers).filter(([k]) => !SECRET_HEADERS.test(k))) };
    current = next.href;
  }
  throw err('地址跳转次数过多', 424);
}

module.exports = { safeFetch, assertUrl, isPrivateIp, FormData, File };
