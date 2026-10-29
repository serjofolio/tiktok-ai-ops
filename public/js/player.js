// 分镜成片播放器：Canvas 渲染图片/视频片段 + Ken Burns 运镜 + 字幕 + 转场，支持导出 WebM
import { icon, toast } from './lib.js';

const W = 540, H = 960;

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function loadVideo(src) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.oncanplay = () => resolve(v);
    v.onerror = () => resolve(null);
    v.src = src;
  });
}

function drawCover(ctx, media, t, motion) {
  const mw = media.videoWidth || media.naturalWidth || W;
  const mh = media.videoHeight || media.naturalHeight || H;
  const base = Math.max(W / mw, H / mh);
  let scale = base, dx = 0;
  const e = t * t * (3 - 2 * t); // smoothstep
  if (motion === 'zoom-in') scale = base * (1 + 0.14 * e);
  else if (motion === 'zoom-out') scale = base * (1.14 - 0.14 * e);
  else if (motion === 'pan-left') (scale = base * 1.12), (dx = (0.5 - e) * W * 0.1);
  else if (motion === 'pan-right') (scale = base * 1.12), (dx = (e - 0.5) * W * 0.1);
  const dw = mw * scale, dh = mh * scale;
  ctx.drawImage(media, (W - dw) / 2 + dx, (H - dh) / 2, dw, dh);
}

function wrapText(ctx, text, maxW) {
  const words = /[一-龥]/.test(text) ? [...text] : text.split(' ');
  const sep = /[一-龥]/.test(text) ? '' : ' ';
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + sep + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function drawCaption(ctx, text, t) {
  if (!text) return;
  const a = Math.min(1, t * 6);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = '800 38px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  const lines = wrapText(ctx, text, W - 80);
  const lh = 50;
  const y0 = H * 0.72 - ((lines.length - 1) * lh) / 2 + (1 - a) * 20;
  lines.forEach((l, i) => {
    const y = y0 + i * lh;
    const w = ctx.measureText(l).width + 28;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath();
    ctx.roundRect((W - w) / 2, y - 36, w, 48, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(l, W / 2, y);
  });
  ctx.restore();
}

function drawChrome(ctx, title, progress) {
  // 顶部进度条 + 右侧 TikTok 风格互动栏，便于预览实际观感
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.fillRect(20, 18, W - 40, 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(20, 18, (W - 40) * progress, 4);
  const g = ctx.createLinearGradient(0, H - 220, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 220, W, 220);
  ctx.fillStyle = '#fff';
  ctx.font = '700 22px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('@yourshop', 24, H - 92);
  ctx.font = '400 18px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText((title || '').slice(0, 32), 24, H - 62);
  ctx.fillStyle = '#FE2C55';
  ctx.beginPath();
  ctx.roundRect(24, H - 46, 150, 30, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 15px "Segoe UI", sans-serif';
  ctx.fillText('🛒  Shop now', 38, H - 26);
  ['♥', '💬', '↗'].forEach((s, i) => {
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '32px "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s, W - 42, H * 0.5 + i * 76);
  });
}

export async function mountPlayer(container, video, { autoplay = false } = {}) {
  // 真实视频文件直接用 <video>
  if (video.kind === 'file' && video.url) {
    container.innerHTML = `<div class="player"><video src="${video.url}" controls playsinline ${autoplay ? 'autoplay' : ''} class="player-video"></video>
      <div class="player-bar"><a class="btn sm" href="${video.url}" download>${icon('download', 16)}下载 MP4</a></div></div>`;
    return () => {};
  }
  const scenes = video.storyboard || [];
  container.innerHTML = `<div class="player">
    <div class="player-stage"><canvas width="${W}" height="${H}"></canvas><div class="player-loading"><span class="spinner"></span>加载素材…</div></div>
    <div class="player-bar">
      <button class="btn sm" data-act="play">${icon('play', 16)}播放</button>
      <span class="player-time">0.0s / 0.0s</span>
      <button class="btn sm ghost" data-act="export" title="录制为 WebM 视频文件">${icon('download', 16)}导出视频</button>
    </div></div>`;
  const canvas = container.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const timeEl = container.querySelector('.player-time');
  const playBtn = container.querySelector('[data-act=play]');
  const media = await Promise.all(scenes.map((s) => (s.video ? loadVideo(s.video).then((v) => v || loadImage(s.image)) : loadImage(s.image))));
  container.querySelector('.player-loading')?.remove();
  const durs = scenes.map((s) => Math.max(1, Number(s.duration) || 4));
  const total = durs.reduce((a, b) => a + b, 0);
  let raf = 0, playing = false, start = 0, offset = 0, dead = false, lastIdx = -1;

  function frame(time) {
    let t = Math.min(time, total - 0.0001), idx = 0;
    while (idx < durs.length - 1 && t >= durs[idx]) t -= durs[idx++];
    const local = t / durs[idx];
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const m = media[idx];
    if (m instanceof HTMLVideoElement && idx !== lastIdx) {
      m.currentTime = 0;
      if (playing) m.play().catch(() => {});
    }
    lastIdx = idx;
    if (m) drawCover(ctx, m, local, m instanceof HTMLVideoElement ? 'none' : scenes[idx].motion);
    // 转场：片段开头 0.3s 淡入
    const fade = Math.min(1, t / 0.3);
    if (fade < 1 && idx > 0) {
      ctx.fillStyle = `rgba(0,0,0,${1 - fade})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawCaption(ctx, scenes[idx].caption, local);
    drawChrome(ctx, video.title, time / total);
    timeEl.textContent = `${time.toFixed(1)}s / ${total.toFixed(1)}s`;
  }

  function loop(now) {
    if (dead) return;
    const t = offset + (now - start) / 1000;
    if (t >= total) {
      frame(total);
      stop(true);
      return;
    }
    frame(t);
    raf = requestAnimationFrame(loop);
  }
  function play() {
    if (playing) return;
    playing = true;
    start = performance.now();
    playBtn.innerHTML = `${icon('pause', 16)}暂停`;
    raf = requestAnimationFrame(loop);
  }
  function stop(ended) {
    playing = false;
    cancelAnimationFrame(raf);
    offset = ended ? 0 : offset + (performance.now() - start) / 1000;
    media.forEach((m) => m instanceof HTMLVideoElement && m.pause());
    playBtn.innerHTML = `${icon('play', 16)}播放`;
    container.dispatchEvent(new CustomEvent('ended'));
  }
  playBtn.onclick = () => (playing ? stop() : play());
  container.querySelector('[data-act=export]').onclick = async (e) => {
    const btn = e.currentTarget;
    if (!canvas.captureStream || !window.MediaRecorder) return toast('当前浏览器不支持录制，请使用 Chrome / Edge', 'error');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>录制中…';
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 5e6 });
    const parts = [];
    rec.ondataavailable = (ev) => ev.data.size && parts.push(ev.data);
    rec.onstop = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }));
      a.download = `${(video.title || 'video').replace(/[\\/:*?"<>|]/g, '_')}.webm`;
      a.click();
      btn.disabled = false;
      btn.innerHTML = `${icon('download', 16)}导出视频`;
      toast('视频已导出', 'success');
    };
    if (playing) stop();
    offset = 0;
    rec.start();
    container.addEventListener('ended', () => rec.state === 'recording' && rec.stop(), { once: true });
    play();
  };
  frame(0);
  if (autoplay) play();
  return () => {
    dead = true;
    cancelAnimationFrame(raf);
  };
}

// 静态缩略图（取第一个分镜）
export function thumb(video) {
  const src = video.storyboard?.[0]?.image || video.image;
  return src ? `<img src="${src}" alt="" loading="lazy">` : `<div class="thumb-ph">${icon('video', 28)}</div>`;
}
