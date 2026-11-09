// 测试用的模拟大模型上游：OpenAI 兼容（/v1）与 Anthropic 兼容（/anthropic/v1），支持流式
// 只接受 Bearer sk-test / x-api-key sk-test，用于端到端验证真实调用链路
const http = require('http');

const ANALYSIS = {
  verdict: '可以上',
  why: ['近 7 天销量是近 28 天周均的 2.41 倍，处于加速上升期', '291 位达人带货、出单率 100%，寄样招达人容易复制'],
  audience: '25-40 岁通勤女性，办公室久坐',
  sellingPoints: [{ point: '静音强风', howToShow: '分贝仪对比普通风扇' }],
  competitors: '同类店铺约 30 家，差评集中在续航，主打大电池款做差异化',
  risks: ['锂电池需要运输资质'],
  sourcing: '1688 搜「迷你桌面风扇 静音 USB」，采购价不高于 $3.2',
  testPlan: { inventory: '100 件', creators: '寄样 15 位腰部达人', videos: '自营 5 条', budget: '$300', successMetrics: 'CTR>3%，转化>2%', stopLoss: '7 天 ROI<1 停止' },
  benchmarkAngles: ['办公室闷热场景开场'],
};
const SCRIPT = {
  title: '迷你风扇痛点种草', hook: 'Stop sweating at your desk!', hookAlternatives: ['A', 'B', 'C'], style: '痛点种草', duration: 15, language: 'English',
  scenes: [
    { n: 1, part: 'Hook', time: '0s-3s', duration: 3, shot: '近景', visual: '满头大汗的人', voiceover: 'Stop sweating at your desk!', caption: 'Too hot?', props: '纸巾' },
    { n: 2, part: 'Demo', time: '3s-9s', duration: 6, shot: '特写', visual: '打开风扇', voiceover: 'This tiny fan is silent.', caption: 'Silent', props: '风扇' },
    { n: 3, part: 'CTA', time: '9s-15s', duration: 6, shot: '中景', visual: '指向购物车', voiceover: 'Tap the cart now!', caption: 'Shop now', props: '' },
  ],
  caption: 'Desk must-have', hashtags: ['#tiktokmademebuyit'], cta: 'Tap the cart now!', bgm: '轻快', shootingTips: ['自然光'],
};

const OVERVIEW = {
  summary: '马来西亚手机与数码类目需求集中在手机壳、钢化膜和无线耳机；睡眠耳机、透明防尘钢化膜在加速上升；充电类和充电宝对跨境卖家不开放，不要碰。',
  segments: [{ type: '无线耳机', verdict: '机会', why: '趋势 2.41×，达人出单率 100%' }, { type: '充电宝', verdict: '避开', why: '定邀 + 本地仓' }],
  priceInsight: 'RM18–35 价格带的销售额占比明显高于商品数占比，建议入场价 RM29–35。',
  competition: '品牌卖家占比不高，上架半年内的新品也能进入头部。',
  opportunities: [{ title: '睡眠耳机', what: '侧睡不压耳的超小无线耳机', why: '趋势 2.41×，近 7 天 1,670 件', entryPrice: 'RM29–35', differentiation: '主打侧睡舒适、降噪', sourcing: '睡眠耳机 无线 隐形', refs: [1] }],
  avoid: [{ what: '充电宝、充电器、数据线', why: '东南亚跨境定邀类目，充电宝还要本地仓' }],
  nextSteps: ['在 1688 找 3 家睡眠耳机供应商比价', '寄样 10 位睡眠/ASMR 类达人'],
};
// 逐个研判：按提示词里每个商品的「规则结论」原样给出 AI 结论，便于测试断言
function judge(text) {
  const ids = [...text.matchAll(/"i":(\d+)/g)].map((m) => Number(m[1]));
  const rules = [...text.matchAll(/"规则结论":"([^"]+)"/g)].map((m) => m[1]);
  return { items: ids.map((i, k) => {
    const verdict = ['可以上', '谨慎测试', '不建议上'].includes(rules[k]) ? rules[k] : '谨慎测试';
    return { i, verdict, score: verdict === '可以上' ? 80 : verdict === '谨慎测试' ? 60 : 30, headline: `AI：${verdict}`, reasons: { 需求: '近 7 天销量充足', 趋势: '趋势倍数大于 1', 达人: '出单率高', 竞争: '无品牌垄断', 利润: '成本上限高于 1688 估价', 风险: '无' }, est1688: '¥18–25（估算）', kw1688: '睡眠耳机 无线', profitOk: verdict !== '不建议上', angle: '主打侧睡舒适', nextStep: '寄样 10 位达人' };
  }) };
}

// 上架包：故意带两个违禁词（Best、100%），测试合规检查
const PACK = {
  titleLocal: 'Fon Telinga Tidur Mini Wireless Bluetooth, Selesa Tidur Mengiring', titleEn: 'Best Mini Sleep Earbuds Wireless, 100% Comfortable for Side Sleepers',
  sellingPoints: ['Tidak sakit telinga bila tidur mengiring', 'Bateri tahan 8 jam'], description: 'Masalah: susah tidur.\nPenyelesaian: fon telinga tidur mini.', keywords: ['sleep earbuds', 'fon telinga tidur'],
  skus: [{ name: 'Black', spec: '黑色' }, { name: 'White', spec: '白色' }], categoryHint: '手机与数码 > 耳机', attributes: { 材质: 'ABS' }, packageList: '耳机 ×2，充电仓 ×1', notes: '需要 SIRIM 认证',
};
// 同款判断：按标题打分（真实模型也是看标题和规格）
const match = (text) => ({ items: [...text.matchAll(/"i":(\d+),"标题":"([^"]*)"/g)].map((m) => {
  const t = m[2];
  const score = /侧睡/.test(t) ? 96 : /睡眠/.test(t) ? 85 : /钢化膜/.test(t) ? 90 : 40;
  return { i: Number(m[1]), match: score, note: score >= 90 ? '外观和规格一致' : score >= 70 ? '同类可替代' : '不是同一类商品' };
}) });

// 爆款拆解（字段和真实模型的返回一致）
const VIRAL_REPORT = {
  summary: '这条视频卖一款金色耳环，用「大家都问我多少钱」开场，真实上身特写证明质感。', keyReason: '别人的反应 + 上身特写，不用自夸就显得贵',
  takeaways: ['第一帧就是耳环上身', '把价格留到后面报', '只说自己真实用过的感受'],
  basics: { product: '金色耳环', category: '首饰', audience: '25-35 岁女性', format: 'ugc', formatName: '真人测评', presenter: '真人出镜', tone: '随意', language: 'English' },
  hook: { type: 'others_react', typeName: '别人的反应', firstFrame: '耳环上身特写', spokenLine: 'Everyone keeps asking me about these', onScreenText: 'Everyone asks', sound: '原声', aligned: '画面和话都在说这副耳环', whyStops: '好奇是什么耳环', whoItFilters: '喜欢首饰的女性', score: 82, improve: '屏幕字可以再短一点' },
  timeline: [{ start: 0, end: 3, part: 'Hook', visual: '耳环上身', camera: '特写', spoken: 'Everyone keeps asking me about these', onScreenText: 'Everyone asks', audio: '原声', purpose: '抓住注意力', retention: '留下悬念：到底是什么', emotion: '好奇' }, { start: 3, end: 12, part: 'CTA', visual: '手指向购物车', camera: '近景', spoken: 'Tap the cart', onScreenText: '', audio: '原声', purpose: '成交', retention: '报价', emotion: '满足' }],
  structure: { formula: '别人的反应 → 上身证明 → 报价 → 行动号召', pacing: '切镜不多，靠讲话推进', productFirstAt: '第 0 秒', priceAt: '第 8 秒', openLoops: ['这是什么耳环 → 第 3 秒揭晓'], payoff: '报价那一刻', rewatch: '无' },
  painAndDesire: { pain: '怕戴着显廉价', agitation: '无', desire: '被人夸', moment: '出门前' },
  sellingPoints: [{ point: '看着贵', how: '自然光特写', proof: '他人反应' }], trust: ['真人上身'],
  conversion: { offer: '无', cta: 'Tap the cart', urgency: '无', objections: ['会不会廉价'], commentBait: '无' },
  emotionCurve: [{ t: '0-3s', emotion: '好奇', intensity: 8 }, { t: '3-12s', emotion: '满足', intensity: 6 }],
  scores: { hook: { score: 82, why: '开头明确' }, retention: { score: 70, why: '中段平' }, proof: { score: 65, why: '只有上身' }, conversion: { score: 72, why: 'CTA 明确' }, shareability: { score: 50, why: '转发理由弱' } },
  reusable: { template: '[别人的反应] → [上身证明] → [价格] → [行动号召]', slots: [{ slot: '[别人的反应]', how: '换成真实评论' }], mustKeep: ['第一帧上身'], canChange: ['场景'] },
  doNotCopy: ['原视频台词和人物'], compliance: ['不要说防过敏'], limits: '只看了抽帧',
};
const PAINS = { audience: '25-35 岁通勤女性', pains: [{ pain: '戴两周就变色', level: '功能', moment: '洗澡时', evidence: '推断', hookSpoken: 'I showered in these for 30 days', hookText: 'Day 30', hookFrame: '耳环泡水特写', proof: '按日期连续拍', caution: '只说实测结果' }, { pain: '想被夸', level: '身份', moment: '聚会', evidence: '推断', hookSpoken: 'Everyone asks where I got these', hookText: 'Everyone asks', hookFrame: '上身特写', proof: '朋友反应', caution: '不要虚构对话' }] };

// 批量出片：按分配写每条的画面（模型偶尔会少写一条，程序要能用模板补上）
function studioBriefs(text) {
  const n = Number(text.match(/批量策划 (\d+) 条/)[1]);
  return { briefs: Array.from({ length: n }, (_, i) => ({ n: i + 1, angle: `第 ${i + 1} 种切入`, keyframe: `Vertical 9:16 photo, the first frame of a TikTok product video, a hand holding the product from image 1, angle ${i + 1}`, motion: 'the hand slowly rotates the product toward the camera, handheld slight sway', caption: `Hook ${i + 1}`, voiceover: `Line ${i + 1}`, why: '第一帧就有商品和手' })).slice(0, Math.max(1, n - 1)) };
}
let qcCount = 0;

function answerFor(text) {
  if (/批量策划 \d+ 条/.test(text)) return JSON.stringify(studioBriefs(text));
  // 商品中文名：按行里的商品 ID 返回
  if (/翻译成简短的中文商品名/.test(text)) return JSON.stringify({ names: Object.fromEntries([...text.matchAll(/^(\w+): /gm)].map((m, i) => [m[1], `测试商品${i + 1}`])) });
  if (/改写成给.*提示词/.test(text)) return JSON.stringify({ prompt: 'A young woman in front of a mirror fastens the necklace, fingers gently touch the pendant, slow push-in, morning window light.', note: '改成英文，只保留一个动作和一种镜头运动' });
  if (/挖掘拍视频用的痛点和渴望/.test(text)) return JSON.stringify(PAINS);
  if (/TikTok 带货内容拆解专家/.test(text)) return JSON.stringify(VIRAL_REPORT);
  if (/带货短视频脚本/.test(text)) return JSON.stringify(SCRIPT);
  if (/逐个研判下面/.test(text)) return JSON.stringify(judge(text));
  if (/做市场研判/.test(text)) return JSON.stringify(OVERVIEW);
  if (/提炼成 1688 中文搜索关键词/.test(text)) return JSON.stringify({ kw: '睡眠耳机 无线 隐形' });
  if (/是不是这个 TikTok 商品的同款/.test(text)) return JSON.stringify(match(text));
  if (/生成一份可以直接上架的商品资料/.test(text)) return JSON.stringify(PACK);
  if (/单品深度分析|选品分析/.test(text)) return JSON.stringify(ANALYSIS);
  if (/连接成功/.test(text)) return '连接成功';
  return '根据知识库资料 [1]，前 3 秒要用痛点或结果前置做钩子。';
}

function readBody(req) {
  return new Promise((r) => {
    let b = Buffer.alloc(0);
    req.on('data', (c) => (b = Buffer.concat([b, c])));
    req.on('end', () => {
      if (!b.length) return r({});
      try {
        r(JSON.parse(b.toString()));
      } catch {
        r({ raw: true }); // multipart（语音转写）
      }
    });
  });
}

// 第三方 1688 数据接口（万邦格式）与 Webhook 接收端
const OFFERS = [
  { num_iid: '880000001', title: '睡眠耳机无线蓝牙隐形侧睡不压耳 迷你入耳式', price: '18.50', pic_url: '', sales: 3200, nick: '深圳声悦电子', location: '广东 深圳' },
  { num_iid: '880000002', title: '隐形睡眠蓝牙耳机 超小 降噪', price: '16.00', pic_url: '', sales: 900, nick: '东莞小耳朵', location: '广东 东莞' },
  { num_iid: '880000003', title: '运动蓝牙耳机 挂耳式', price: '12.00', pic_url: '', sales: 15000, nick: '义乌耳机厂', location: '浙江 金华' },
  { num_iid: '880000004', title: '头戴式蓝牙耳机 折叠', price: '45.00', pic_url: '', sales: 300, nick: '惠州音频', location: '四川 成都' },
];
const DETAIL = { 880000001: { priceRange: [[2, '19.50'], [50, '18.50'], [500, '17.20']], num: 26000, weight: '0.045', skus: { sku: [{}, {}, {}] } }, 880000002: { priceRange: [[2, '16.00']], num: 800, weight: '0.06', skus: { sku: [{}] } } };
const hooks = [];
const videoTasks = new Map();
const sent = { video: [], fastmoss: [] };
const json = (res, data, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
let sampleClip = null;
async function clipBytes() {
  if (sampleClip) return sampleClip;
  const out = require('path').join(require('os').tmpdir(), `tk-fake-clip-${process.pid}.mp4`);
  await new Promise((resolve, reject) => require('child_process').execFile(require('ffmpeg-static'), ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=15:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out], (e) => (e ? reject(e) : resolve())));
  sampleClip = require('fs').readFileSync(out);
  return sampleClip;
}
// 视频模型：第一次查询还在生成，第二次完成
function nextStatus(id) {
  const n = (videoTasks.get(id) || 0) + 1;
  videoTasks.set(id, n);
  return n >= 2;
}
async function fakeVideo(req, res, url, origin) {
  const p = url.pathname;
  if (p === '/video/clip.mp4') {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    return res.end(await clipBytes());
  }
  if (req.headers.authorization !== 'Bearer vk-test') return json(res, { error: { message: 'bad key' } }, 401);
  const clip = `${origin}/video/clip.mp4`;
  // Seedance
  if (p === '/video/ark/contents/generations/tasks' && req.method === 'POST') {
    const body = await readBody(req);
    sent.video.push({ vendor: 'seedance', body });
    return json(res, { id: `ark-${sent.video.length}` });
  }
  if (p.startsWith('/video/ark/contents/generations/tasks/')) {
    const id = p.split('/').pop();
    if (id.startsWith('0000')) return json(res, { error: { message: 'not found' } }, 404);
    if (id.includes('fail')) return json(res, { status: 'failed', error: { message: '内容审核未通过' } });
    return json(res, nextStatus(id) ? { id, status: 'succeeded', content: { video_url: clip } } : { id, status: 'running' });
  }
  // 可灵
  if (/^\/video\/kling\/(text|image)-to-video\//.test(p)) {
    const body = await readBody(req);
    sent.video.push({ vendor: 'kling', path: p, body });
    return json(res, { code: 0, data: { id: `kl-${sent.video.length}`, status: 'submitted' } });
  }
  if (p === '/video/kling/tasks') {
    const id = url.searchParams.get('task_ids');
    return json(res, { code: 0, data: [nextStatus(id) ? { id, status: 'succeeded', outputs: [{ type: 'video', url: clip }] } : { id, status: 'processing' }] });
  }
  // 通义万相
  if (p === '/video/wan/services/aigc/video-generation/video-synthesis') {
    const body = await readBody(req);
    sent.video.push({ vendor: 'wan', async: req.headers['x-dashscope-async'], body });
    return json(res, { output: { task_id: `wan-${sent.video.length}`, task_status: 'PENDING' } });
  }
  if (p.startsWith('/video/wan/tasks/')) {
    const id = p.split('/').pop();
    return json(res, { output: nextStatus(id) ? { task_status: 'SUCCEEDED', video_url: clip } : { task_status: 'RUNNING' } });
  }
  // 海螺
  if (p === '/video/mm/v1/video_generation') {
    const body = await readBody(req);
    sent.video.push({ vendor: 'minimax', body });
    return json(res, { task_id: `mm-${sent.video.length}`, base_resp: { status_code: 0 } });
  }
  if (p === '/video/mm/v1/query/video_generation') {
    const id = url.searchParams.get('task_id');
    return json(res, nextStatus(id) ? { status: 'Success', file_id: '42', base_resp: { status_code: 0 } } : { status: 'Processing', base_resp: { status_code: 0 } });
  }
  if (p === '/video/mm/v1/files/retrieve') return json(res, { file: { download_url: clip }, base_resp: { status_code: 0 } });
  // 自定义接口
  if (p === '/video/custom/submit') {
    const body = await readBody(req);
    sent.video.push({ vendor: 'custom', body });
    return json(res, { data: { task_id: `c-${sent.video.length}` } });
  }
  if (p.startsWith('/video/custom/query/')) {
    const id = p.split('/').pop();
    return json(res, nextStatus(id) ? { state: 'SUCCESS', result: { url: clip } } : { state: 'RUNNING' });
  }
  json(res, { error: { message: 'NOT_FOUND' } }, 404);
}

// 中转站（new-api 格式）：/v1/models、/v1/images/generations、/v1/videos
async function fakeRelay(req, res, url, origin) {
  if (req.headers.authorization !== 'Bearer sk-relay') return json(res, { error: { message: 'invalid token' } }, 401);
  const p = url.pathname.replace('/relay/v1', '');
  if (p === '/models') return json(res, { object: 'list', data: [{ id: 'doubao-seedance-2.0-fast-720p' }, { id: 'doubao-seedream-5-0' }, { id: 'wan3.0-video' }] });
  if (p === '/images/generations' && req.method === 'POST') {
    const body = await readBody(req);
    sent.image = sent.image || [];
    sent.image.push(body);
    return json(res, { created: 1, data: [{ url: `${origin}/img/product.png` }] });
  }
  if (p === '/videos' && req.method === 'POST') {
    const body = await readBody(req);
    sent.video.push({ vendor: 'relay', body });
    return json(res, { task_id: `rv-${sent.video.length}`, status: 'queued' });
  }
  if (p.startsWith('/videos/')) {
    const id = p.split('/').pop();
    return json(res, nextStatus(id) ? { task_id: id, status: 'completed', video_url: `${origin}/video/clip.mp4` } : { task_id: id, status: 'in_progress' });
  }
  json(res, { error: { message: 'NOT_FOUND' } }, 404);
}

// FastMoss 开放接口（字段按官方文档）
const fmProduct = (i) => ({ product_id: `19000000000000${100 + i}`, title: `Gold Hoop Earrings ${i} for Women`, region: 'US', cover: '', category: { l1: { id: 200, name: '珠宝配饰及衍生品' }, l2: { id: 201, name: '时尚饰品' } }, commission_rate: '15%', creator_order_rate: '40%', price: '$12.00 - 18.00', floor_price: 12, off_shelves: 0, day7_units_sold: 700 - i * 100, day7_gmv: 9000 - i * 1000, day28_units_sold: 1500, total_units_sold: 8000, total_gmv: 100000, creator_count: 60, video_count: 90, product_rating: 4.8, tiktok_url: '', fastmoss_url: '', shop: { name: `Shop ${i}` }, ctime: 1700000000 });
async function fakeFastmoss(req, res, url) {
  if (req.headers.authorization !== 'Bearer fm-test') return json(res, { code: 1002, data: null, message: 'invalid client' });
  const body = await readBody(req);
  sent.fastmoss.push({ path: url.pathname, body });
  const p = url.pathname.replace('/fastmoss', '');
  if (p === '/product/v1/categoryInfo') return json(res, { code: 0, data: [{ c_code: 200, c_name: '珠宝配饰及衍生品', sub: [{ c_code: 201, c_name: '时尚饰品', sub: [] }] }, { c_code: 10, c_name: '家居', sub: [] }] });
  if (p === '/product/v1/search' || p === '/product/v1/rank/topSelling') return json(res, { code: 0, data: { total: 3, list: [fmProduct(1), fmProduct(2), fmProduct(3)] } });
  if (p === '/product/v1/salesTrend') {
    const days = body.filter.days;
    const idx = Number(body.filter.product_id.slice(-1));
    const start = Date.parse('2026-10-16T00:00:00Z');
    return json(res, { code: 0, data: { list: Array.from({ length: days }, (_, i) => ({ dt: new Date(start + i * 86400e3).toISOString().slice(0, 10), units_sold: i < days / 2 ? 5 : 20 * idx, gmv: i < days / 2 ? 60 : 240 * idx })), overview: {} } });
  }
  json(res, { code: 10001, message: 'bad path' });
}

function fake1688(req, res, url) {
  const q = url.searchParams;
  res.writeHead(q.get('key') === 'k1688' && q.get('secret') === 's1688' ? 200 : 403, { 'Content-Type': 'application/json' });
  if (q.get('key') !== 'k1688') return res.end(JSON.stringify({ error: 'key 错误', error_code: '4013' }));
  if (url.pathname.startsWith('/1688/item_search_img')) return res.end(JSON.stringify({ items: { item: OFFERS.slice(0, 2) }, error: '', error_code: '0000' }));
  if (url.pathname.startsWith('/1688/item_search')) return res.end(JSON.stringify({ items: { item: OFFERS }, error: '', error_code: '0000' }));
  if (url.pathname.startsWith('/1688/item_get')) {
    const id = q.get('num_iid');
    const base = OFFERS.find((o) => o.num_iid === id) || {};
    return res.end(JSON.stringify({ item: { ...base, ...(DETAIL[id] || {}) }, error: '', error_code: '0000' }));
  }
  res.end('{}');
}

// TikTok 公开视频页：数据在 __UNIVERSAL_DATA_FOR_REHYDRATION__ 里；视频文件要带页面给的 cookie 才能取
const ttHits = { page: 0 };
async function fakeTiktok(req, res, url, origin) {
  const p = url.pathname.replace('/tiktok', '');
  if (/^\/t\/ZTshort\/?$/.test(p)) {
    res.writeHead(302, { Location: `${origin}/tiktok/@shorty/video/7300000000000000003` });
    return res.end();
  }
  const cdn = p.match(/^\/cdn\/(\d+)\.mp4$/);
  if (cdn) {
    if (!/tt_chain_token=ok/.test(req.headers.cookie || '') || req.headers.referer !== 'https://www.tiktok.com/') return json(res, { error: 'forbidden' }, 403);
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    return res.end(await clipBytes());
  }
  const m = p.match(/^\/@([\w.-]+)\/video\/(\d+)$/);
  if (!m) return json(res, { error: 'not found' }, 404);
  ttHits.page++;
  const [, user, id] = m;
  const gone = id.endsWith('9');
  const like = 2940 + ttHits.page;
  const item = { id, desc: `Crushed ice sparkle #925silver #${user}`, createTime: '1793278800', author: { uniqueId: user, nickname: user.toUpperCase() }, authorStats: { followerCount: 12800 },
    stats: { diggCount: like, shareCount: 273, commentCount: 15, playCount: 344500, collectCount: '813' }, statsV2: { diggCount: String(like), shareCount: '273', commentCount: '15', playCount: '344500', collectCount: '813' },
    video: { duration: 9, width: 360, height: 640, cover: `${origin}/img/product.png`, playAddr: `${origin}/tiktok/cdn/${id}.mp4` }, music: { title: 'original sound' } };
  const data = { __DEFAULT_SCOPE__: { 'webapp.video-detail': gone ? { statusCode: 10204, statusMsg: 'item doesn\'t exist' } : { statusCode: 0, itemInfo: { itemStruct: item } } } };
  res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': ['tt_chain_token=ok; Path=/', 'ttwid=x; Path=/'] });
  res.end(`<!doctype html><html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></body></html>`);
}

function start(port = 3902) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/1688/')) return fake1688(req, res, url);
    if (url.pathname.startsWith('/video/')) return fakeVideo(req, res, url, `http://127.0.0.1:${server.address().port}`);
    if (url.pathname.startsWith('/fastmoss/')) return fakeFastmoss(req, res, url);
    if (url.pathname === '/sent') return json(res, sent);
    if (url.pathname.startsWith('/tiktok/')) return fakeTiktok(req, res, url, `http://127.0.0.1:${server.address().port}`);
    if (url.pathname.startsWith('/relay/')) return fakeRelay(req, res, url, `http://127.0.0.1:${server.address().port}`);
    // new-api 中转站公开的价格表（不需要密钥）
    if (url.pathname === '/api/pricing') return json(res, { success: true, group_ratio: { default: 1, Doubao: 1 }, data: [{ model_name: 'doubao-seedance-2.0-fast-720p', quota_type: 0, model_price: 0, description: 'Seedance 2.0 Fast 720p | 带视频特惠约 ¥0.396/秒，不带视频约 ¥0.672/秒(5s约¥3.36)', enable_groups: ['auto', 'Doubao'], supported_endpoint_types: ['openai-video'], billing_unit: 'usage' }, { model_name: 'doubao-seedream-5-0', quota_type: 1, model_price: 0.288, enable_groups: ['Doubao'], supported_endpoint_types: ['image-generation'], billing_unit: 'call' }, { model_name: 'wan3.0-video', quota_type: 1, model_price: 0.252, resolution_prices: { '480p': 0.252, '720p': 0.504 }, enable_groups: ['Wan'], supported_endpoint_types: ['openai-video'], billing_unit: 'second' }] });
    if (url.pathname === '/api/status') return json(res, { data: { quota_display_type: 'CNY', usd_exchange_rate: 1 } });
    // 看不见图片的文字模型：收到图片也不报错，只会胡说
    if (url.pathname === '/blind/v1/chat/completions') {
      await readBody(req);
      return json(res, { choices: [{ message: { role: 'assistant', content: '这张图片是一幅美丽的风景画，有绿色的山。' } }] });
    }
    if (url.pathname === '/redirect-internal') {
      res.writeHead(302, { location: '/webhook/last' });
      return res.end();
    }
    // 商品主图（插件以图搜测试用）
    if (url.pathname === '/img/product.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(require('fs').readFileSync(require('path').join(__dirname, '..', 'extension', 'icon128.png')));
    }
    if (url.pathname === '/webhook' && req.method === 'POST') {
      hooks.unshift({ body: await readBody(req), signature: req.headers['x-tk-signature'] || '' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, message: '已收到', id: 'job-' + hooks.length }));
    }
    if (url.pathname === '/webhook/last') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ count: hooks.length, last: hooks[0] || null }));
    }
    const auth = req.headers.authorization === 'Bearer sk-test' || req.headers['x-api-key'] === 'sk-test';
    if (!auth) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    }
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'glm-test' }, { id: 'glm-test-air' }] }));
    }
    if (req.url === '/v1/audio/transcriptions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ text: 'Everyone keeps asking me about these earrings. Tap the cart.' }));
    }
    if (req.url === '/v1/chat/completions') {
      const raw = body.messages.at(-1).content;
      const imaged = Array.isArray(raw);
      const last = imaged ? raw.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : raw;
      if (imaged) {
        const n = [...last.matchAll(/(\d+(?:\.\d+)?)s/g)].map((m) => Number(m[1]));
        // 质检：每 3 张有 1 张判定商品不像
        if (/真实商品照片/.test(last)) {
          qcCount++;
          const bad = qcCount % 3 === 0;
          const reply = JSON.stringify(bad ? { sameProduct: 52, stopPower: 70, problems: ['颜色不对'], verdict: 'fail' } : { sameProduct: 86 + (qcCount % 5), stopPower: 78, problems: [], verdict: 'pass' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }));
        }
        const reply = /左半边和右半边/.test(last) ? '红色，蓝色' : /开头 3 秒/.test(last) ? JSON.stringify({ firstFrame: '耳环上身特写', person: true, face: false, product: true, productWhat: '金色耳环', onScreenText: 'Everyone asks', motion: '手指捏住耳环', camera: '特写' }) : JSON.stringify({ frames: n.map((t) => ({ t, shot: '特写', person: true, product: true, visual: '手捏住耳环转动', text: '' })) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }));
      }
      const text = answerFor(String(last));
      if (!body.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先检索知识库。' } }] })}\n\n`);
      for (const piece of text.match(/.{1,6}/gs)) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 15));
      }
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    if (req.url === '/anthropic/v1/messages') {
      const last = body.messages.at(-1).content;
      const text = answerFor(String(last));
      if (!body.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const piece of text.match(/.{1,6}/gs)) res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: piece } })}\n\n`);
      res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
      return res.end();
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'NOT_FOUND' } }));
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || 3902).then(() => console.log('fake upstream on', process.argv[2] || 3902));
