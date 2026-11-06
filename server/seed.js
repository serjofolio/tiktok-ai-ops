// 首次启动与升级时的初始化：内置参考文档、选品方法论、官方文档知识库；清理早期演示数据
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


// 根据 EchoTik 等公开选品研究指南与常见实操整理
const METHOD_DOC = {
  title: 'TikTok Shop 选品方法论（从 FastMoss 数据到测款）',
  text: `# TikTok Shop 选品方法论

## 选品六步
1. 找潜力趋势：先定一个国家站点和一个细分类目、价格带。看近 7 天 / 28 天销量是否在涨、排名是否在升、是否持续卖而不是一次性爆发。不要只看累计销量。
2. 数据工具筛选：在 FastMoss 按国家、类目、价格、时间范围筛出 10–20 个候选品，要求：近期有销量、销售额稳定或增长、有多个达人在带、不止一家店在卖、近期有带货视频、卖点清晰、价格适合冲动消费。
3. 竞品分析：看销量是否集中在一家店或一个达人（集中度太高说明可复制性差）；对比竞品的价格、主图、标题、套装、折扣、物流时效、评价；读差评找改进点；找到自己的差异化切入点（更好的套装、不同人群、更清晰的说明、更快的物流、新的内容角度）。
4. 判断能不能卖：做利润测算，扣除采购、包装、物流、平台佣金、达人佣金、广告、折扣、样品、退货、售后后仍有足够利润；用保守假设，利润只在理想情况下成立的品不要做。淘汰规则：需求下滑、利润薄、差评集中在质量问题、物流难、政策风险高。
5. 生成测试方案：少量备货；找一小批相关达人寄样，同时自营多条不同角度的视频；上线前定好预算、成功标准和止损线；每次只测 1–2 个品，结果才看得清。跟踪商品页浏览、点击率、加购、转化率、单均成本、达人维度销量、退款退货、扣除全部成本后的利润。
6. 带货视频脚本：拆解对标视频的五段结构：钩子（前 3 秒出现什么问题）、痛点、演示、证明、行动号召；看评论里的顾虑，视频里提前回答。

## 硬指标
- 销量在增长：近 7 天环比为正，最好 20% 以上；稳定增长比单次尖峰更可信。
- 利润要够：扣除全部成本后净利率建议不低于 20%；达人佣金一般预留 15%–20%。
- 卖点能可视化：3 秒内能拍出使用前后对比或效果。
- 对标视频足够多：有足够多的带货视频可以拆解，说明内容模式已被验证。
- 自己看到也想买：自己都没有购买冲动的品，很难拍出打动人的内容。

## 饱和信号
大量同款卖家、价格战、所有视频同一个钩子、头部店铺垄断销量、新卖家进入但整体销量下滑、达人佣金要求过高、难以差异化。竞争本身不是问题，没有可行的竞争方式才是问题。

## 说明
第三方工具（FastMoss 等）的销量和 GMV 是估算值，用于比较方向和趋势，不能当作财务数据。`,
};

// 在系统上下文执行（不按用户过滤）
async function run() {
  products.removeDemo();

  // 平台内置参考知识库：所有用户只读共享，只有管理员能修改
  const desc = '平台内置的选品方法、脚本公式、规则摘要，仅供参考';
  let ref = db.kbs.all().find((k) => k.builtin || (!k.uid && k.name === 'TikTok 运营手册'));
  if (!ref) {
    ref = db.kbs.insert({ name: '运营参考（平台内置，非官方）', description: desc, icon: '', builtin: true, shared: true });
    for (const d of DOCS) await rag.addDocument(ref.id, { ...d, source: 'builtin' });
  } else if (!ref.builtin || !ref.shared) {
    db.kbs.update(ref.id, { name: '运营参考（平台内置，非官方）', description: desc, builtin: true, shared: true });
    const mark = (c) => c.replaceAll(c.all().map((x) => (x.kbId === ref.id ? Object.assign(x, { shared: true }) : x)));
    mark(db.docs);
    mark(db.chunks);
  }
  if (!db.docs.all().some((d) => d.title === METHOD_DOC.title)) await rag.addDocument(ref.id, { ...METHOD_DOC, source: 'builtin' });
  const playbookDoc = require('./services/playbook').asDocument();
  if (!db.docs.all().some((d) => d.title === playbookDoc.title)) await rag.addDocument(ref.id, { ...playbookDoc, source: 'builtin' });
  // 每个用户自己的「TikTok 官方文档」知识库在注册时创建（见 auth.initUserData）
}

module.exports = { run };
