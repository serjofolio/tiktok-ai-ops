// 带货视频脚本：基于选品库中的商品、选品分析结论和对标视频，生成可直接开拍的分镜脚本
const db = require('../db');
const llm = require('../providers/llm');
const rag = require('./rag');
const products = require('./products');
const settings = require('../settings');

const STYLES = {
  pain: '痛点种草（问题 → 放大 → 解决）',
  demo: '产品演示（功能逐个展示）',
  compare: '前后对比 Before/After',
  unboxing: '开箱测评',
  story: '剧情反转',
  ugc: '真人口播 UGC 测评',
};

async function generate({ productId, style = 'pain', duration = 20, language, benchmark = '', extra = '', useKb = true }) {
  const p = productId ? products.get(productId) : null;
  if (!p) throw Object.assign(new Error('请先在选品库选择一个商品'), { status: 400 });
  const lang = language || settings.get().store.language || 'English';
  const a = p.analysis || {};
  const ctx = useKb ? await rag.contextFor(`TikTok 带货短视频脚本 前3秒钩子 ${STYLES[style] || style}`, 3) : '';
  const product = {
    名称: p.name, 类目: p.category, 售价美元: p.price, 近7天销量: p.sales7d, 销量环比: p.growth, 带货视频数: p.videoCount, 评分: p.rating,
    选品结论: a.verdict, 目标人群: a.audience, 卖点及拍法: a.sellingPoints, 建议对标角度: a.benchmarkAngles, 人工备注: p.judgement?.notes,
  };
  const script = await llm.completeJSON(
    `为下面这个 TikTok Shop 商品写一条 ${duration} 秒的带货短视频脚本。

风格：${STYLES[style] || style}
口播与字幕语言：${lang}
商品信息（来自 FastMoss 数据和选品分析）：${JSON.stringify(product)}
${benchmark ? `对标视频参考（用户提供的爆款视频文案/拆解，学习结构但不要照抄）：\n${benchmark}\n` : ''}${extra ? `额外要求：${extra}\n` : ''}${ctx ? `参考知识库：\n${ctx}\n` : ''}
要求：
1. 按「钩子 Hook → 痛点 Problem → 演示 Demo → 证明 Proof → 行动号召 CTA」组织，前 3 秒必须是强钩子；
2. 4–7 个镜头，每个镜头 2–5 秒，时间加起来等于 ${duration} 秒；
3. 每个镜头写清楚拍什么、怎么拍（景别、动作、道具），新手照着就能拍；
4. 不使用绝对化/医疗功效用语（如 cure、100% guaranteed），符合 TikTok 广告规范；
5. 另外给出 3 个不同角度的备选钩子，用于测款时做 A/B 测试。

只输出 JSON：
{"title":"脚本标题(中文)","hook":"开场钩子(${lang})","hookAlternatives":["备选钩子1","备选钩子2","备选钩子3"],"style":"${STYLES[style] || style}","duration":${duration},"language":"${lang}",
"scenes":[{"n":1,"part":"Hook|Problem|Demo|Proof|CTA","time":"0s-3s","duration":3,"shot":"景别/机位","visual":"画面与动作(中文，具体可执行)","voiceover":"口播(${lang})","caption":"屏幕大字幕(${lang}，简短)","props":"道具/准备"}],
"caption":"发布文案(${lang})","hashtags":["#tag"],"cta":"结尾行动号召(${lang})","bgm":"配乐建议","shootingTips":["拍摄注意事项(中文)"]}`,
    { system: '你是 TikTok 爆款带货短视频编剧，擅长高完播率、高转化的脚本。只输出 JSON。', temperature: 0.8 },
  );
  if (!Array.isArray(script.scenes) || !script.scenes.length || !script.hook) throw Object.assign(new Error('模型返回的脚本缺少分镜或钩子，请重试或换一个模型'), { status: 502 });
  script.scenes = script.scenes.map((s, i) => ({ n: i + 1, duration: 4, ...s }));
  const saved = db.scripts.insert({ productId: p.id, productName: p.name, benchmark, ...script });
  db.activity.insert({ type: 'script', text: `生成脚本：${p.name}` });
  return saved;
}

module.exports = { generate, STYLES };
