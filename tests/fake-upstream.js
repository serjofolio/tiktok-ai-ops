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

function answerFor(text) {
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
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => r(b ? JSON.parse(b) : {}));
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

function start(port = 3902) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/1688/')) return fake1688(req, res, url);
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
    if (req.url === '/v1/chat/completions') {
      const last = body.messages.at(-1).content;
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
