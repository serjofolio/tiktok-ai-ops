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

function answerFor(text) {
  if (/带货短视频脚本/.test(text)) return JSON.stringify(SCRIPT);
  if (/逐个研判下面/.test(text)) return JSON.stringify(judge(text));
  if (/做市场研判/.test(text)) return JSON.stringify(OVERVIEW);
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

function start(port = 3902) {
  const server = http.createServer(async (req, res) => {
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
