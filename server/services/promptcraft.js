// 写给图片模型和视频模型的提示词规则。批量出片和写脚本共用
// 依据：各家模型官方的提示词指南（主体 + 动作 + 场景 + 镜头 + 光线）、TikTok 官方创意建议（前 3 秒、竖屏、真人感）和 TikTok Shop 的 AI 内容规定
// 规则里没有的数字就是没有出处，不要往里加「据统计」之类的话

// 关键帧：视频的第一帧，也是观众划到时看到的画面
const KEYFRAME_RULES = [
  '开头写用途：Vertical 9:16 photo, the first frame of a TikTok product video, shot on a smartphone, candid UGC look, not a studio ad.',
  '商品写成 "the product from image 1"（有几张参考图就说明都是同一件商品），要求和参考图完全一致：外形、颜色、材质、比例、数量、商品自带的标识都不能改。',
  '商品要清楚：在焦点上、占画面三到五成、不被手或裁切挡住主体。首饰写清戴在哪个部位、离镜头多近。',
  '画面里要有人或手在和商品互动（成年人），手写清楚 natural hands, five fingers；需要露脸时写表情和视线方向。',
  '写一个具体的真实场景和光线（例如 bathroom vanity, morning window light），背景干净不杂乱。只写一个场景。',
  '构图给后期屏幕字留位置：画面上方两成保持干净；商品不要放在底部两成和右侧边缘（会被 TikTok 的按钮和文案挡住）。',
  '结尾写禁止项：no text, no captions, no watermark, no extra products, no logos other than the product\'s own.',
];

// 动作：图生视频时画面已经由关键帧决定，提示词只写「怎么动」
const MOTION_RULES = [
  '只写运动，不要重复描述画面里已有的外观：谁、做什么动作、镜头怎么动、节奏快慢。',
  '一条只做一到两个简单、符合物理的动作：拿起、转动、戴上、靠近镜头、放下。动作越复杂越容易出错。',
  '镜头运动只选一种：handheld slight sway、slow push-in、slow orbit、static。',
  '第 1 秒就要有明显的动作，不要慢热：观众两秒内决定走不走。',
  '商品是刚体：写明 the product keeps exactly the same shape, color and size, no morphing, nothing new appears。不能让商品自己变形、发光、变出东西。',
  '不写任何屏幕文字，屏幕字后期加（模型写字会写错）。',
  '8 秒以上的视频可以一次生成 2–3 个镜头：按时间线写 Shot 1 (0-3s) … Cut to Shot 2 …，每个镜头一个动作，比分开生成再拼接更连贯。',
  '要人说话时把台词原文写进去（The person says: "…"），模型会生成对口型的声音；台词要短，一个镜头一句。',
];

// 文案：屏幕字和口播
const COPY_RULES = [
  '屏幕字不超过 8 个词，关掉声音也能看懂，和第一帧、第一句口播说同一件事。',
  '口播按每秒 2.5 个英文词（或 4 个汉字）估算，说不完就删；第一句就是钩子，不要「大家好」。',
  '只用商品信息里有的事实：不编效果、对比结果、评价、销量、奖项和认证，不提其他品牌。',
  'AI 画面不能拍成测评或使用前后对比来「证明」效果；发布时要打开 AI 生成内容标识。',
];

const brief = () => [
  '【关键帧提示词（英文，给图片模型）】', ...KEYFRAME_RULES.map((r, i) => `${i + 1}. ${r}`),
  '【动作提示词（英文，给视频模型）】', ...MOTION_RULES.map((r, i) => `${i + 1}. ${r}`),
  '【屏幕字和口播】', ...COPY_RULES.map((r, i) => `${i + 1}. ${r}`),
].join('\n');

// 程序固定加在最后的保护语：模型漏写时也有
const KEYFRAME_GUARD = 'The product must look exactly like the reference images: same shape, color, material, proportions and quantity. Natural hands with five fingers. No text, no captions, no watermark, no extra products.';
const MOTION_GUARD = 'The product keeps exactly the same shape, color and size as in the first frame, no morphing, no new objects appear. Realistic physics. No on-screen text, no captions, no watermark.';

module.exports = { KEYFRAME_RULES, MOTION_RULES, COPY_RULES, brief, KEYFRAME_GUARD, MOTION_GUARD };
