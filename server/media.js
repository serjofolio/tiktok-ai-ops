// 视频文件：存储、配额、ffmpeg 处理。上传的视频来自外部用户，交给 ffmpeg 之前先核对文件头，并只放行本地文件和常见视频格式
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const db = require('./db');
const ctx = require('./ctx');
const { safeFetch } = require('./net');

const records = db.collection('media');
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// 普通用户的存储上限（管理员不限）。网站开放注册，防止磁盘被占满
const QUOTA_MB = Number(process.env.MEDIA_QUOTA_MB) || 2048;
const MAX_DOWNLOAD = 800 * 1024 * 1024;

function ffmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch {}
  return 'ffmpeg';
}

const SAFE_INPUT = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,flv,image2,jpeg_pipe,mjpeg'];

function run(args, { timeoutMs = 240000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin(), ['-nostdin', '-hide_banner', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 2e6) stderr = stderr.slice(-1e6);
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? err('服务器上没有 ffmpeg，处理不了视频（部署脚本会自动安装；本地运行请执行 npm install）', 500) : e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

// 按文件头判断格式，不看扩展名和浏览器声明的类型
function sniff(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(16);
  fs.readSync(fd, b, 0, 16, 0);
  fs.closeSync(fd);
  const at4 = b.toString('latin1', 4, 8);
  if (['ftyp', 'moov', 'mdat', 'free', 'wide'].includes(at4)) return { ext: 'mp4', mime: 'video/mp4' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', mime: 'video/webm' };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 11) === 'AVI') return { ext: 'avi', mime: 'video/x-msvideo' };
  if (b.toString('latin1', 0, 3) === 'FLV') return { ext: 'flv', mime: 'video/x-flv' };
  return null;
}

async function probe(file) {
  const { stderr } = await run([...SAFE_INPUT, '-i', file], { timeoutMs: 60000 });
  const d = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const v = stderr.match(/Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*/);
  if (!d || !v) return null;
  const fps = v[0].match(/([\d.]+)\s*fps/);
  return {
    duration: Math.round((Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 100) / 100,
    width: Number(v[1]),
    height: Number(v[2]),
    fps: fps ? Number(fps[1]) : null,
    hasAudio: /Stream #[^\n]*Audio:/.test(stderr),
  };
}

// 镜头切换时间点（秒）：ffmpeg 的场景检测，是真实测量，不靠模型猜
async function sceneCuts(file, threshold = 0.3) {
  const { stderr } = await run([...SAFE_INPUT, '-i', file, '-threads', '1', '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], { timeoutMs: 180000 });
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
}

// 按固定间隔抽帧；start/duration 限定范围。返回文件名列表（已按时间排序）
async function frames(file, dir, { prefix, interval, start = 0, duration, width = 360 }) {
  const args = [...SAFE_INPUT];
  if (start) args.push('-ss', String(start));
  args.push('-i', file, '-threads', '1');
  if (duration) args.push('-t', String(duration));
  args.push('-an', '-vf', `fps=1/${interval},scale=${width}:-2`, '-q:v', '5', path.join(dir, `${prefix}-%03d.jpg`));
  const { code, stderr } = await run(args);
  if (code !== 0) throw err(`抽帧失败：${stderr.slice(-200)}`, 500);
  return fs.readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`)).sort();
}

// 把若干帧拼成一张图：一次请求只传一张，兼容只收单图的视觉模型，也省 token
async function contactSheet(dir, files, out, { cols = 4 } = {}) {
  const rows = Math.ceil(files.length / cols);
  const list = path.join(dir, `${path.basename(out)}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${path.join(dir, f).replace(/'/g, "'\\''")}'`).join('\n'));
  const { code, stderr } = await run(['-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `tile=${cols}x${rows}:padding=4:color=white`, '-frames:v', '1', '-q:v', '4', out]);
  fs.rmSync(list, { force: true });
  if (code !== 0) throw err(`拼图失败：${stderr.slice(-200)}`, 500);
  return out;
}

// 抽音轨：单声道 16k，语音转写够用，文件小
async function extractAudio(file, out, { start, duration } = {}) {
  const args = [...SAFE_INPUT];
  if (start) args.push('-ss', String(start));
  args.push('-i', file);
  if (duration) args.push('-t', String(duration));
  args.push('-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out);
  const { code, stderr } = await run(args);
  if (code !== 0) throw err(`抽取音频失败：${stderr.slice(-200)}`, 500);
  return out;
}

// 统一尺寸、帧率和音轨，裁到目标时长：不同片段才能无缝合并
async function normalizeClip(src, out, { width, height, duration, hasAudio }) {
  const args = [...SAFE_INPUT, '-i', src];
  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  if (duration) args.push('-t', String(duration));
  args.push('-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k');
  if (!hasAudio) args.push('-shortest');
  args.push(out);
  const { code, stderr } = await run(args, { timeoutMs: 600000 });
  if (code !== 0) throw err(`处理片段失败：${stderr.slice(-300)}`, 500);
  return out;
}

async function concat(files, out) {
  const list = `${out}.txt`;
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const { code, stderr } = await run(['-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { timeoutMs: 300000 });
  fs.rmSync(list, { force: true });
  if (code !== 0) throw err(`合并视频失败：${stderr.slice(-300)}`, 500);
  return out;
}

// ---------- 存储 ----------
function userDir(uid = ctx.user()?.id) {
  if (!uid) throw err('请先登录', 401);
  const dir = path.join(db.MEDIA_DIR, String(uid).replace(/[^\w-]/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function newDir(name) {
  const dir = path.join(userDir(), `${name}-${crypto.randomBytes(5).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const used = () => records.all().reduce((sum, m) => sum + (m.size || 0), 0);
function assertQuota(extra = 0) {
  if (ctx.user()?.role === 'admin') return;
  if (used() + extra > QUOTA_MB * 1024 * 1024) throw err(`存储空间已用完（上限 ${QUOTA_MB} MB）：先删除一些视频再继续`, 413);
}

// 登记一个已经放好的文件。abs 必须在媒体目录内
function register({ abs, kind, title, mime, meta }) {
  const rel = path.relative(db.MEDIA_DIR, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw err('文件路径不合法', 500);
  return records.insert({ kind, title: String(title || '').slice(0, 120), file: rel, mime, size: fs.statSync(abs).size, ...meta });
}
const absPath = (m) => path.join(db.MEDIA_DIR, m.file);

function remove(id) {
  const m = records.get(id);
  if (!m) return false;
  if (!records.remove(id)) return false;
  fs.rmSync(absPath(m), { force: true });
  return true;
}

// 删除用户时一起删掉他的文件
function purgeUserFiles(uid) {
  fs.rmSync(path.join(db.MEDIA_DIR, String(uid).replace(/[^\w-]/g, '')), { recursive: true, force: true });
}

// 下载上游生成好的视频：大多数厂商的链接只保留 24 小时，必须马上存下来
async function download(url, dest, { headers, timeoutMs = 600000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw err(`下载视频失败：HTTP ${res.status}`, 424);
    const size = Number(res.headers.get('content-length') || 0);
    if (size > MAX_DOWNLOAD) throw err('视频文件太大', 413);
    assertQuota(size);
    let total = 0;
    const counter = async function* (source) {
      for await (const chunk of source) {
        total += chunk.length;
        if (total > MAX_DOWNLOAD) throw err('视频文件太大', 413);
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(dest));
    if (!sniff(dest)) throw err('下载到的不是视频文件', 424);
    return dest;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { records, run, sniff, probe, sceneCuts, frames, contactSheet, extractAudio, normalizeClip, concat, userDir, newDir, used, assertQuota, register, absPath, remove, purgeUserFiles, download, QUOTA_MB };
