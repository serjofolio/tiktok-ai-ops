// 首次启动时写入演示数据：内置知识库文档、预设智能体
const db = require('./db');
const rag = require('./services/rag');
const products = require('./services/products');

const DOCS = [
  {
    title: 'TikTok 爆款短视频脚本公式',
    text: `# TikTok 爆款短视频脚本公式

## 黄金 3 秒钩子
前 3 秒决定完播率。常用钩子类型：
1. 痛点提问："Still struggling with frizzy hair every morning?"
2. 反常识："Stop buying expensive curling irons!"
3. 结果前置：先展示使用后的惊艳效果，再倒叙过程。
4. 数字冲击："I tried 7 viral gadgets so you don't have to."
5. 情绪共鸣：用表情和语气制造代入感，例如惊讶、崩溃、惊喜。

## 经典结构 PAS（Problem-Agitate-Solution）
- Problem：0-3 秒抛出痛点
- Agitate：3-8 秒放大痛点，展示糟糕场景
- Solution：8-20 秒展示产品如何解决，强调卖点和使用过程
- CTA：最后 3 秒引导下单，"Tap the orange cart before it sells out!"

## 时长建议
带货短视频建议 15-30 秒，信息密度高、节奏快，每 2-3 秒切换一个镜头。完播率高于 30% 才有机会进入更大流量池。

## 字幕与音乐
必须加大字幕，60% 以上用户静音浏览。使用平台热门音乐可以提升推荐权重，但商业账号需使用商用音乐库（Commercial Music Library）。`,
  },
  {
    title: 'TikTok Shop 选品方法论',
    text: `# TikTok Shop 选品方法论

## 选品六维评估模型
1. 增长趋势：近 7 天销量环比增长 >50% 视为上升期，优先切入。
2. 销量基础：已有一定销量证明需求真实存在。
3. 利润空间：扣除采购成本、头程物流、平台佣金（约 6%-8%）、达人佣金（10%-20%）后毛利率建议 >30%。
4. 竞争程度：同款卖家数量和视频数量，竞争度低于 50 为蓝海。
5. 用户口碑：评分 4.5 以上，差评集中点可作为改进与差异化机会。
6. 内容潜力：产品是否"可视化"，能否在 3 秒内展示效果。

## 适合 TikTok 的产品特征
- 价格带 $10-$40，冲动消费
- 有明显的使用前后对比（before/after）
- 新奇、解压、提升生活效率
- 体积小、重量轻、不易损坏，降低物流成本

## 测款流程
先少量备货（50-200 件），通过 3-5 条自营视频 + 10-20 位达人寄样测试，观察 72 小时内的点击率（CTR>3%）和转化率（CVR>2%），数据达标再加大备货和投放。`,
  },
  {
    title: 'TikTok Shop 平台规则与违规风险',
    text: `# TikTok Shop 平台规则与违规风险

## 禁售与限售品类
禁售：武器、毒品、烟草及电子烟、成人用品、仿冒品、活体动物等。
限售（需资质）：保健品、医疗器械、化妆品（部分站点需 FDA 注册或 CPNP）、儿童玩具（需 CPC 认证）、电子产品（需 FCC/CE）。

## 内容违规高发点
- 夸大功效：禁止使用 "cure"、"100% guaranteed"、"permanent" 等绝对化用语。
- 虚假对比：before/after 必须真实，不得过度修图。
- 引流站外：视频与直播中不得引导到其他平台交易。
- 未授权音乐与素材：商业账号使用非授权音乐会被限流。

## 店铺健康分
发货时效、退货率、差评率和违规记录会影响店铺评分，评分过低会限制流量和活动报名。建议 48 小时内发货，退货率控制在 5% 以下。

## 广告合规
Spark Ads 投放的视频需获得达人授权码，广告素材需标注 #ad 或使用品牌合作标签。`,
  },
  {
    title: '达人合作与投放 SOP',
    text: `# 达人合作与投放 SOP

## 达人分层
- 头部达人（100 万粉以上）：品牌曝光，成本高，适合大促。
- 腰部达人（10-100 万粉）：性价比最高，是带货主力。
- 尾部/素人（1-10 万粉）：适合大量铺量、获取 UGC 素材。

## 建联话术要点
自我介绍 + 产品亮点 + 佣金比例（建议 15%-25%）+ 免费寄样 + 参考视频示例。通过 TikTok Shop 联盟（Affiliate）定向邀约可以自动结算佣金。

## 投放策略
1. 自然流测试：先发布 3 条以上不同钩子的视频。
2. 筛选爆款：完播率 >30%、互动率 >5% 的视频加热。
3. Spark Ads 放量：用达人授权码投放，ROI>2 持续加预算，每次增幅不超过 30%。
4. GMV Max：店铺稳定出单后开启自动化投放。`,
  },
  {
    title: 'AI 视频与图片生成提示词指南',
    text: `# AI 视频与图片生成提示词指南

## 商品图提示词结构
主体 + 场景 + 光线 + 构图 + 风格 + 画质。
示例：A heatless curling headband on a marble vanity, soft morning sunlight, close-up product shot, minimalist aesthetic, 8k, commercial photography.

## 竖版带货图建议
- 比例 9:16（1080x1920），主体位于画面中上部，底部留出字幕区域。
- 背景简洁，突出商品，避免文字乱码。
- 生活化场景比纯白底更适合 TikTok 原生风格。

## 图生视频提示词
描述镜头运动 + 主体动作 + 氛围：
"Slow push-in camera, the product rotates gently, soft light sweeps across the surface, cinematic, smooth motion."
常用运镜：推近（push in）、拉远（pull out）、环绕（orbit）、平移（pan）、手持晃动（handheld）。
每段视频 5 秒左右，多段拼接为完整带货视频。`,
  },
];

const AGENTS = [
  {
    name: '运营总监 Max',
    avatar: '🧠',
    role: '全能运营智能体',
    description: '统筹选品、脚本、素材生成和知识库检索，可调用全部工具完成端到端任务。',
    systemPrompt:
      '你是一名经验丰富的 TikTok Shop 跨境电商运营总监。你可以调用工具：搜索商品库、分析商品、检索知识库、写视频脚本、生成图片、生成视频、启动工作流。回答要结构清晰、可执行，给出明确的下一步行动。',
    tools: ['search_products', 'analyze_product', 'search_knowledge', 'write_script', 'generate_image', 'generate_video', 'run_workflow'],
    kbIds: [],
    type: 'builtin',
  },
  {
    name: '选品分析师 Luna',
    avatar: '🔎',
    role: '数据选品专家',
    description: '擅长从商品库中挖掘高增长、低竞争的潜力爆品，并输出选品报告。',
    systemPrompt: '你是 TikTok Shop 选品分析师，擅长用数据说话。优先调用 search_products 和 analyze_product 工具，并结合知识库中的选品方法论给出结论。',
    tools: ['search_products', 'analyze_product', 'search_knowledge'],
    kbIds: [],
    type: 'builtin',
  },
  {
    name: '爆款编剧 Leo',
    avatar: '🎬',
    role: '短视频脚本编剧',
    description: '精通 TikTok 黄金 3 秒钩子和 PAS 结构，快速产出高转化带货脚本。',
    systemPrompt: '你是 TikTok 爆款短视频编剧。写脚本前先检索知识库中的脚本公式，然后调用 write_script 生成结构化脚本，必要时生成分镜图片。',
    tools: ['search_knowledge', 'search_products', 'write_script', 'generate_image'],
    kbIds: [],
    type: 'builtin',
  },
];

async function run() {
  products.seedProducts();
  if (!db.kbs.count()) {
    const kb = db.kbs.insert({ name: 'TikTok 运营手册', description: '内置的脚本公式、选品方法论、平台规则与投放 SOP', icon: '📚' });
    for (const d of DOCS) await rag.addDocument(kb.id, { ...d, source: 'builtin' });
  }
  if (!db.agents.count()) {
    const kbIds = db.kbs.all().map((k) => k.id);
    for (const a of [...AGENTS].reverse()) db.agents.insert({ ...a, kbIds });
  }
}

module.exports = { run };
