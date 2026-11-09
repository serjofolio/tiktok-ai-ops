// 商品的爆款视频：粘贴 TikTok 视频链接 → 读公开视频页里的数据（作者、文案、播放 / 点赞 / 评论 / 收藏 / 分享）
// 视频文件按需存到自己的服务器（TikTok 的播放地址几小时就失效），之后可以在页面里播放、保存到电脑、一键送去拆解
// 只读公开的视频页，不登录、不绕验证；TikTok 要求验证或者看不到这条视频时直接告诉用户
const fs = require('fs');
const path = require('path');
const db = require('../db');
const media = require('../media');
const viral = require('./viral');
const settings = require('../settings');
const llm = require('../providers/llm');
const { safeFetch } = require('../net');

const videos = db.collection('tt_videos');
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
// 测试时指向本地模拟服务
const ORIGIN = (process.env.TIKTOK_ORIGIN || 'https://www.tiktok.com').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_LINKS = 20;
// 只请求 TikTok 自己的域名：页面、封面和视频文件
const TT_HOST = /(^|\.)(tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|tiktokv\.us|ibyteimg\.com|byteoversea\.com)$/i;
const allowed = (u) => {
  try {
    const x = new URL(u);
    return TT_HOST.test(x.hostname) || x.origin === new URL(ORIGIN).origin;
  } catch {
    return false;
  }
};

// 从粘贴的文字里找视频链接：完整链接、vm / vt 短链接、tiktok.com/t/ 短链接
function links(text) {
  const s = String(text || '');
  const out = new Map();
  for (const m of s.matchAll(/https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([\w.-]+)\/video\/(\d{8,25})/gi)) out.set(m[2], { id: m[2], user: m[1] });
  for (const m of s.matchAll(/https?:\/\/(?:(?:vm|vt)\.tiktok\.com\/[\w-]+|(?:www\.)?tiktok\.com\/t\/[\w-]+)\/?/gi)) out.set(m[0], { short: m[0] });
  return [...out.values()].slice(0, MAX_LINKS);
}

async function fetchTT(url, { timeoutMs = 30000, headers = {}, redirect } = {}) {
  if (!allowed(url)) throw err('只能读取 TikTok 的链接');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await safeFetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers }, signal: ctrl.signal, redirect });
  } catch (e) {
    if (e.name === 'AbortError') throw err('连不上 TikTok（超时）：服务器所在网络可能访问不了 TikTok', 424);
    throw e.status ? e : err(`连不上 TikTok：${e.message}`, 424);
  } finally {
    clearTimeout(t);
  }
}

// 短链接跳几次才到视频页
async function resolve(link) {
  if (link.id) return link;
  let url = link.short.replace(/^https?:\/\/(?:www\.)?tiktok\.com/i, ORIGIN);
  for (let i = 0; i < 4; i++) {
    const res = await fetchTT(url, { redirect: 'manual' });
    const loc = res.headers.get('location');
    await res.body?.cancel().catch(() => {});
    const m = String(loc || url).match(/@([\w.-]+)\/video\/(\d{8,25})/);
    if (m) return { id: m[2], user: m[1] };
    if (!loc) break;
    url = new URL(loc, url).href;
  }
  throw err(`这个短链接打不开视频：${link.short}`);
}

const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// 读一条视频的公开页面
async function read({ id, user }) {
  const res = await fetchTT(`${ORIGIN}/@${encodeURIComponent(user || '_')}/video/${id}`);
  const cookies = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const html = await res.text();
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw err(/captcha|verify/i.test(html) ? 'TikTok 要求人机验证，过一会儿再试' : `读不到这条视频的数据（HTTP ${res.status}）`, 424);
  let it;
  try {
    const vd = JSON.parse(m[1]).__DEFAULT_SCOPE__?.['webapp.video-detail'];
    if (vd?.statusCode) throw err(`TikTok 返回：这条视频看不到（可能已删除、设为私密，或者在服务器所在地区不可见，代码 ${vd.statusCode}）`, 424);
    it = vd?.itemInfo?.itemStruct;
  } catch (e) {
    if (e.status) throw e;
    throw err('TikTok 页面格式变了，读不出数据', 424);
  }
  if (!it?.id) throw err('TikTok 页面里没有这条视频的数据', 424);
  const s = { ...(it.stats || {}), ...(it.statsV2 || {}) };
  const v = it.video || {};
  return {
    meta: {
      videoId: String(it.id),
      url: `https://www.tiktok.com/@${it.author?.uniqueId || user}/video/${it.id}`,
      author: it.author?.uniqueId || user || '',
      nickname: String(it.author?.nickname || '').slice(0, 80),
      followers: num(it.authorStats?.followerCount),
      desc: String(it.desc || '').slice(0, 600),
      postedAt: Number(it.createTime) ? new Date(Number(it.createTime) * 1000).toISOString() : null,
      duration: num(v.duration),
      width: num(v.width),
      height: num(v.height),
      music: String(it.music?.title || '').slice(0, 80),
      stats: { play: num(s.playCount), like: num(s.diggCount), comment: num(s.commentCount), collect: num(s.collectCount), share: num(s.shareCount) },
    },
    cover: v.originCover || v.cover || '',
    play: v.playAddr || '',
    cookies,
  };
}

// 封面存到自己服务器：TikTok 的封面地址会过期，国内网络也打不开
async function saveCover(url, title) {
  if (!url || !allowed(url)) return null;
  try {
    const res = await fetchTT(url, { timeoutMs: 20000, headers: { Referer: 'https://www.tiktok.com/' } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = buf.length < 3 * 1024 * 1024 && media.imageMime(buf);
    if (!mime) return null;
    const dir = media.newDir('cover');
    const abs = path.join(dir, `cover.${mime.split('/')[1].replace('jpeg', 'jpg')}`);
    fs.writeFileSync(abs, buf);
    return media.register({ abs, kind: 'cover', title, mime }).id;
  } catch {
    return null;
  }
}

const pub = (x) => x;
function list(productId) {
  return videos.all().filter((x) => (productId ? x.productId === productId : true)).sort((a, b) => (b.stats?.like ?? -1) - (a.stats?.like ?? -1)).map(pub);
}
const get = (id) => videos.get(id);

// 粘贴链接加进商品的爆款视频；已经有的更新数据
async function addLinks(productId, text) {
  const found = links(text);
  if (!found.length) throw err('没找到 TikTok 视频链接。链接长这样：https://www.tiktok.com/@用户名/video/一串数字，也可以是 vm.tiktok.com 开头的短链接');
  let added = 0, updated = 0;
  const errors = [];
  for (const l of found) {
    try {
      const ref = await resolve(l);
      const r = await read(ref);
      const exist = videos.all().find((x) => x.productId === productId && x.videoId === r.meta.videoId);
      if (exist) {
        videos.update(exist.id, { ...r.meta, prevStats: exist.stats, fetchedAt: db.now() });
        updated++;
      } else {
        const coverId = await saveCover(r.cover, `@${r.meta.author}`);
        videos.insert({ productId, ...r.meta, coverId, fetchedAt: db.now(), dl: 'idle' });
        added++;
      }
    } catch (e) {
      errors.push({ link: l.short || `https://www.tiktok.com/@${l.user}/video/${l.id}`, error: e.message });
    }
  }
  return { added, updated, errors, items: list(productId) };
}

async function refresh(id) {
  const x = videos.get(id);
  if (!x) throw err('找不到这条视频', 404);
  const r = await read({ id: x.videoId, user: x.author });
  return videos.update(id, { ...r.meta, prevStats: x.stats, fetchedAt: db.now(), coverId: x.coverId || (await saveCover(r.cover, `@${r.meta.author}`)) });
}

// 把视频存到服务器（后台进行）；then = 'analyze' 时存好后自动送去拆解
const running = new Set();
function download(id, { then } = {}) {
  const x = videos.get(id);
  if (!x) throw err('找不到这条视频', 404);
  if (then === 'analyze' && !settings.activeProvider()) throw llm.noLLM();
  if (x.mediaId && media.records.get(x.mediaId)) {
    if (then === 'analyze') return analyze(id);
    return x;
  }
  if (running.has(id)) return videos.update(id, then ? { then } : {});
  running.add(id);
  const doc = videos.update(id, { dl: 'running', dlError: '', then: then || x.then || '' });
  (async () => {
    try {
      const r = await read({ id: x.videoId, user: x.author });
      if (!r.play || !allowed(r.play)) throw err('这条视频没有可以下载的播放地址（可能是图文或直播回放）', 424);
      const dir = media.newDir('tiktok');
      const abs = path.join(dir, 'video.mp4');
      await media.download(r.play, abs, { headers: { 'User-Agent': UA, Referer: 'https://www.tiktok.com/', ...(r.cookies ? { Cookie: r.cookies } : {}) }, timeoutMs: 15 * 60 * 1000 });
      const m = media.register({ abs, kind: 'tiktok', title: `@${x.author} ${x.desc}`.slice(0, 80), mime: 'video/mp4', meta: { duration: r.meta.duration } });
      const cur = videos.update(id, { ...r.meta, dl: 'done', mediaId: m.id, fetchedAt: db.now() });
      if (cur.then === 'analyze') await analyze(id);
    } catch (e) {
      videos.update(id, { dl: 'failed', dlError: e.message, then: '' });
    } finally {
      running.delete(id);
    }
  })();
  return doc;
}

// 送去爆款拆解：复制一份视频给拆解用，播放、点赞这些数据一起带过去
async function analyze(id) {
  const x = videos.get(id);
  if (!x) throw err('找不到这条视频', 404);
  if (x.viralId && viral.get(x.viralId)) return x;
  const m = x.mediaId && media.records.get(x.mediaId);
  if (!m) return download(id, { then: 'analyze' });
  const tmp = path.join(media.newDir('tmp'), 'source.mp4');
  fs.copyFileSync(media.absPath(m), tmp);
  const s = x.stats || {};
  try {
    const doc = await viral.add(tmp, `@${x.author}`, {
      title: `@${x.author} ${x.desc}`.slice(0, 80), url: x.url, views: s.play ?? undefined, likes: s.like ?? undefined, comments: s.comment ?? undefined, shares: s.share ?? undefined,
      notes: [`收藏 ${s.collect ?? '—'}`, x.followers != null ? `作者粉丝 ${x.followers}` : '', x.postedAt ? `发布于 ${x.postedAt.slice(0, 10)}` : '', x.desc ? `文案：${x.desc}` : ''].filter(Boolean).join('；'),
    });
    return videos.update(id, { viralId: doc.id, then: '' });
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

// 爆款拆解页直接贴链接：不挂在商品下面
async function analyzeLink(text) {
  if (!settings.activeProvider()) throw llm.noLLM();
  const [l] = links(text);
  if (!l) throw err('没找到 TikTok 视频链接');
  const ref = await resolve(l);
  const r = await read(ref);
  const exist = videos.all().find((x) => !x.productId && x.videoId === r.meta.videoId);
  const doc = exist ? videos.update(exist.id, { ...r.meta, fetchedAt: db.now() }) : videos.insert({ productId: '', ...r.meta, coverId: await saveCover(r.cover, `@${r.meta.author}`), fetchedAt: db.now(), dl: 'idle' });
  return download(doc.id, { then: 'analyze' });
}

function remove(id) {
  const x = videos.get(id);
  if (!x) return false;
  for (const mid of [x.mediaId, x.coverId]) if (mid) media.remove(mid);
  return videos.remove(id);
}

// 服务重启时，没下完的标成失败，可以重新点
function recover() {
  for (const x of videos.all()) if (x.dl === 'running') videos.update(x.id, { dl: 'failed', dlError: '服务重启，下载中断了，请重新点下载', then: '' });
}

module.exports = { links, read, list, get, addLinks, refresh, download, analyze, analyzeLink, remove, recover };
