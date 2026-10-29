// AI 视频脚本：结合商品数据 + 知识库脚本公式，生成结构化分镜脚本
const db = require('../db');
const llm = require('../providers/llm');
const rag = require('./rag');
const products = require('./products');

const STYLES = {
  pain: '痛点种草（PAS 结构）',
  unboxing: '开箱测评',
  compare: '前后对比 Before/After',
  story: '剧情反转',
  tutorial: '教程演示',
  live: '直播切片口播',
};

const MOTIONS = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'zoom-in'];

function mockScript(p, { style, duration, language }) {
  const d = Number(duration) || 20;
  const n = d <= 15 ? 4 : d <= 30 ? 5 : 6;
  const per = Math.round((d / n) * 10) / 10;
  const en = !/中文|chinese/i.test(language || '');
  const name = en ? p.name : p.nameCn;
  const lines = en
    ? [
        [`Wait… you're still doing it the hard way?`, `Stop scrolling! This ${name} changed everything`],
        [`I used to waste so much time every single day.`, `Here's the problem nobody talks about.`],
        [`Then I found the ${name}. Look at this!`, `Just watch how easy this is.`],
        [`It's only $${p.price}, and it actually works.`, `Rated ${p.rating}★ by ${p.reviews.toLocaleString()} buyers.`],
        [`Honestly the best purchase I've made this year.`, `My friends keep asking where I got it.`],
        [`Tap the orange cart before it sells out!`, `Grab yours now — link in the cart below!`],
      ]
    : [
        [`等一下！你还在用老办法吗？`, `别划走！这个${name}真的绝了`],
        [`以前每天都要浪费好多时间`, `这个痛点没人跟你说过`],
        [`直到我发现了${name}，你看！`, `看看这有多简单`],
        [`只要 $${p.price}，而且真的好用`, `${p.reviews.toLocaleString()} 位买家打出 ${p.rating} 分`],
        [`今年买过最值的东西没有之一`, `朋友们都在问我链接`],
        [`赶紧点左下角小黄车，手慢无！`, `链接就在购物车，冲！`],
      ];
  const shots = ['特写钩子', '痛点场景', '产品亮相', '使用演示', '效果展示', '行动号召'];
  const visuals = [
    `人物惊讶表情特写，手持${p.nameCn}快速推近`,
    `展示没有使用产品时的糟糕场景，略显崩溃`,
    `${p.nameCn}在明亮的生活场景中隆重登场，360°展示`,
    `手部特写演示使用过程，突出核心卖点`,
    `使用前后对比分屏，效果一目了然`,
    `产品 + 价格贴纸 + 购物车箭头引导`,
  ];
  const pickIdx = n === 4 ? [0, 2, 4, 5] : n === 5 ? [0, 1, 2, 4, 5] : [0, 1, 2, 3, 4, 5];
  const scenes = pickIdx.map((k, i) => ({
    n: i + 1,
    time: `${(i * per).toFixed(1)}s-${((i + 1) * per).toFixed(1)}s`,
    duration: per,
    shot: shots[k],
    visual: visuals[k],
    voiceover: lines[k][i % 2],
    caption: lines[k][i % 2].split(/[.!?！？。]/)[0].slice(0, 40),
    imagePrompt: `${p.name}, ${['close-up of a surprised young person holding the product', 'messy frustrating everyday scene before using the product', 'hero product shot in a bright modern home', 'hands demonstrating the product in use, macro detail', 'split screen before and after comparison', 'product on clean background with price tag sticker'][k]}, vertical 9:16, TikTok aesthetic, soft natural light, high detail`,
    motion: MOTIONS[i % MOTIONS.length],
  }));
  const tag = p.category.replace(/[^一-龥a-z]/gi, '');
  return {
    title: en ? `${p.name} — ${STYLES[style] || '种草'} ${d}s` : `${p.nameCn}｜${STYLES[style] || '种草'} ${d} 秒`,
    hook: scenes[0].voiceover,
    style: STYLES[style] || style,
    duration: d,
    language: language || 'English',
    scenes,
    hashtags: ['#tiktokmademebuyit', '#tiktokshop', `#${p.name.split(' ')[0].toLowerCase()}`, '#musthave', '#viralproducts', `#${tag}`],
    cta: lines[5][0],
    caption: en
      ? `This ${p.name} is a total game changer 🤯 Only $${p.price}! #tiktokmademebuyit`
      : `这个${p.nameCn}真的太好用了🤯 只要 $${p.price}！`,
    bgm: '轻快电子节拍 / 平台热门 Commercial Music',
  };
}

async function generate({ productId, productName, style = 'pain', duration = 20, language, extra = '', useKb = true }) {
  const lang = language || require('../settings').get().store.language || 'English';
  let p = productId ? products.getScored(productId) : null;
  if (!p && productName) p = products.getScored(productName);
  if (!p) {
    // 允许为不在库中的商品写脚本
    p = { id: null, name: productName || 'Product', nameCn: productName || '商品', category: '其他', price: 19.99, rating: 4.7, reviews: 1000, emoji: '📦' };
  }
  let script;
  if (llm.isMock()) script = mockScript(p, { style, duration, language: lang });
  else {
    const ctx = useKb ? await rag.contextFor(`短视频脚本 钩子 ${STYLES[style] || style} 结构`, 3) : '';
    script = await llm.completeJSON(
      `为 TikTok Shop 商品写一条 ${duration} 秒的带货短视频脚本。
风格：${STYLES[style] || style}
口播语言：${lang}
商品：${JSON.stringify({ name: p.name, nameCn: p.nameCn, category: p.category, price: p.price, rating: p.rating, reviews: p.reviews, analysis: p.analysis?.sellingPoints })}
${extra ? `额外要求：${extra}\n` : ''}${ctx ? `参考知识库：\n${ctx}\n` : ''}
要求：前 3 秒强钩子，每 2-5 秒一个镜头，共 4-6 个镜头；imagePrompt 用英文描述该镜头画面，适合文生图；motion 从 zoom-in/zoom-out/pan-left/pan-right 中选择。
输出 JSON：{"title":"","hook":"","style":"","duration":${duration},"language":"${lang}","scenes":[{"n":1,"time":"0s-3s","duration":3,"shot":"镜头类型","visual":"画面描述(中文)","voiceover":"口播(${lang})","caption":"屏幕大字幕(简短)","imagePrompt":"English prompt","motion":"zoom-in"}],"hashtags":["#"],"cta":"","caption":"发布文案","bgm":"配乐建议"}`,
      { system: '你是 TikTok 爆款带货短视频编剧，擅长高完播率、高转化的脚本。' },
    );
    script.scenes = (script.scenes || []).map((s, i) => ({ n: i + 1, motion: MOTIONS[i % MOTIONS.length], duration: 4, ...s }));
  }
  return db.scripts.insert({ productId: p.id, productName: p.nameCn || p.name, emoji: p.emoji, ...script });
}

module.exports = { generate, STYLES };
