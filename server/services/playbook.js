// 爆款视频方法论：2026-11 的研究结果。页面展示它，脚本生成和爆款拆解也用它当标准
// 证据分级：official 官方 / data 大样本数据 / paper 论文 / case 公开案例 / sample 本次样本 / exp 从业经验（未验证）
const META = {
  version: '2026-11-05',
  title: 'TikTok 爆款视频方法论',
  method: '这份总结来自四类资料：TikTok 官方的创意和小店规则；第三方的真实投放数据和论文；有公开报道的爆款案例；以及我们自己取的一份样本——从 TikTok 公开发现页读了 564 条视频的文案、屏幕文字、时长和互动数据（剔除无关内容后 550 条，其中带货 266 条、首饰 322 条，有重叠），并逐张看了播放最高的 60 条的封面。',
  limits: [
    '样本只包含已经被 TikTok 选进发现页的视频，看不到失败的视频，所以只能说明「爆款长什么样」，不能证明「这样拍就会爆」。',
    '公开页面看不出一条视频有没有投广告。粉丝很少、播放却很高的视频，有一部分是投放起来的，内容不一定强。',
    '样本里看的是文案、屏幕文字、互动数据和封面，没有逐条看完整视频和听口播。',
    '几个常被引用的数字（如「63% 的高效广告在前 3 秒抓住注意力」）找不到 TikTok 的原始出处，这里没有采用。',
  ],
};

const EVIDENCE = {
  official: { label: '官方', hint: 'TikTok 官方文档或规则' },
  data: { label: '数据', hint: '第三方真实投放或市场数据' },
  paper: { label: '论文', hint: '公开发表或预印本研究，多为相关性' },
  case: { label: '案例', hint: '有公开报道的真实案例' },
  sample: { label: '样本', hint: '本次 550 条公开视频样本，只能说明相关' },
  exp: { label: '经验', hint: '从业经验，未经数据验证，先测再信' },
};

const SUMMARY = [
  { point: '爆款要连过四关：平台愿意推、观众停下来、观众看下去、观众愿意买或转发。', detail: '一条视频卡在哪一关，改法完全不同。开头两秒掉得很厉害是钩子问题，之后平稳下滑是内容问题。', ev: 'data', src: 'pear' },
  { point: '绝大多数人两秒内就走了。', detail: '1,393 条英国 TikTok Shop 视频的中位数：看过 2 秒的 31%，6 秒的 10.4%，看到一半的 4.8%，看完的 1.8%。所以前 2 秒值得花一半的心思。', ev: 'data', src: 'pear' },
  { point: '钩子要筛人，不只是抓人。', detail: '同一份数据里，强钩子的点击率是弱钩子的 3.3 倍，但每千次展示的订单只从 0.53 涨到 0.70，转化率反而从 3.8% 掉到 1.8%。「你绝对想不到」这种纯悬念招来的是看热闹的人。', ev: 'data', src: 'pear' },
  { point: '画面、屏幕字、第一句话要说同一件事。', detail: '强钩子的第一帧有产品、最好有人，屏幕字关声音也看得懂，第一句话摆出问题，三者指向同一个痛点。', ev: 'data', src: 'pear' },
  { point: '小账号也能爆，粉丝数不是门槛。', detail: 'TikTok 明确说粉丝数不是推荐的直接因素。样本里 52% 的带货视频来自粉丝不足 1 万的账号；美区首饰类，1 万到 10 万粉的达人贡献了最多的达人销售额，100 万粉以上几乎没有贡献。', ev: 'official', src: 'newsroom' },
  { point: '让人相信比让人惊讶更值钱。', detail: 'Peter Thomas Roth 那条眼霜视频没有拿钱、没有专业拍摄，靠一位普通用户的真实经历和当场可见的效果，不到一周卖掉半年库存。反过来，美妆博主 Mikayla 被质疑假睫毛造假，1,700 万播放里大多是差评。', ev: 'case', src: 'ptr' },
  { point: '首饰卖的不只是痛点，更是「好看、显贵、不变色」。', detail: '样本里首饰视频最常说的词是叠戴（16%）、平价（12%）、不褪色（11%）、防水（9%）、送礼（9%）。第一眼几乎都是戴在身上、手在动的特写，很少只放产品图。', ev: 'sample', src: 'sample' },
  { point: '一条不够，要批量测开头。', detail: '官方建议每个广告组放 3–5 条有明显差异的素材。最省钱的办法是只重录第一句话，每个版本跑几千次展示，比 2 秒播放率、点击率和订单。', ev: 'official', src: 'ttads' },
  { point: 'AI 生成的视频不能改变商品本身。', detail: 'TikTok Shop 明确禁止用 AI 改变商品的尺寸、颜色、材质、形状、数量，或把静态商品做成动画。场景和人物可以用 AI，商品镜头最好实拍，并且要打开 AI 标识。', ev: 'official', src: 'aigc' },
];

const FUNNEL = [
  { stage: '平台愿意推', goal: '让系统知道这条视频给谁看', what: '推荐看的是互动、文案、声音和标签，权重最高的信号之一是看完一条较长的视频；粉丝数和历史爆款都不是直接因素。', action: ['文案和屏幕字写清商品和人群（如 waterproof gold anklets）', '说真话、原创：别搬运其他平台的素材，别重复发同一条', '商品要和详情页一致'], ev: 'official', src: 'newsroom' },
  { stage: '观众停下来', goal: '前 2 秒留住对的人', what: '官方建议钩子放在前 6 秒内、内容主张放在前 3 秒内；实际数据里 2 秒就已经走了近七成。', action: ['第一帧就出现产品，最好有人', '屏幕字短而大，不挡产品', '第一句话直接摆问题或结果'], ev: 'data', src: 'pear' },
  { stage: '观众看下去', goal: '每隔几秒给一个继续看的理由', what: '2 秒到 6 秒又走掉三分之二。结果、证明和价格不要一次全说完。', action: ['提前埋一个问题，后面才回答', '说到什么就给什么镜头（官方要求）', '近景看细节、远景看全貌，轮流切'], ev: 'official', src: 'seller' },
  { stage: '观众买或转发', goal: '消除顾虑，给一个动作', what: '官方要求讲清功能和带来的好处，用多角度和前后对比来证明。论文发现强情绪（惊叹、愤怒、焦虑）的内容更容易被转发，实用内容也是。', action: ['先证明再报价', '主动回答最大的顾虑（会不会变色、过不过敏）', '结尾说清楚下一步：点购物车，不要引导到站外'], ev: 'official', src: 'seller' },
];

const WHY = [
  { title: '它替观众说出了一件不好意思说的事', body: '「Your house may stink and you don\'t even know it.」这句话让人担心自己也这样，1,180 万播放。强烈的情绪会驱动分享，低唤起情绪（比如悲伤）反而不会。', ev: 'paper', src: 'berger' },
  { title: '结果当场看得见', body: 'Trinidad Sandoval 在镜头前涂上眼霜，不到三分钟差别肉眼可见。观众不需要相信谁，自己的眼睛就是证据。官方的钩子建议里也有「开头直接展示效果」。', ev: 'case', src: 'ptr' },
  { title: '发布者看起来和观众是一边的', body: '她说自己早上看到镜子会哭，产品是自己去 Sephora 买的，这条没有收钱。样本里最常见的说法也是「我本来不信」「我真的太喜欢了」，不是广告腔。', ev: 'case', src: 'ptr' },
  { title: '意外证明了产品', body: '车辆起火烧毁后，Stanley 杯还在杯架里，冰块也没化，这条视频证明的正是杯子最核心的卖点。品牌总裁两天内拍视频回应，还送了一辆车，又带来一波关注。', ev: 'case', src: 'stanley' },
  { title: '观众想看到结局', body: '盲盒首饰罐单条 4,550 万播放、时长 4 分半：每拿一件都是一次小悬念。这种结构让长视频也能留住人。', ev: 'sample', src: 'sample' },
  { title: '价格和感知价值有反差', body: '「pov: my jewelry costs less than your matcha」和「I\'m tired of everyone asking if I spent a month\'s salary on this」，都是拿日常开销或别人的反应来衬托价值，没有直接喊便宜。', ev: 'sample', src: 'sample' },
  { title: '评论区替它做了信任背书', body: '在 medicube 一款身体护理套装的 28 天数据里，销售额最高的视频是回复评论的形式，前 8 条里占 4 条。把真实买家的疑问放在开头，比自说自话可信。', ev: 'data', src: 'fmcase' },
  { title: '观众能想象自己用上它', body: '马来西亚的一项研究发现，人越能想象自己在用，越可能买。所以戴在身上、放进真实场景，比摆拍有效。', ev: 'paper', src: 'malaymail' },
];

// 钩子库：formula 是公式；examples 里 real 为样本或报道里的真实文案
const HOOKS = [
  { id: 'pain_callout', name: '痛点点名', formula: '[某类人]是不是也[具体的烦恼]？/ 你的[东西]可能已经[坏结果]', frame: '人 + 产品，或问题正在发生的画面', examples: [{ text: 'Your house may stink and you don\'t even know it.', real: true }, { text: 'Tired of earrings that turn your ears green?', real: false }], fit: '有明确烦恼的品：变色、过敏、难清洁', trap: '烦恼要具体，别编造不存在的恐惧', ev: 'data', src: 'pear' },
  { id: 'result_first', name: '结果前置', formula: '第一帧就是最终效果，再倒回去讲怎么做到的', frame: '效果最好的那一刻', examples: [{ text: '开头就是戴好的成套首饰特写，手慢慢转动', real: false }, { text: 'The easiest way to build a dainty jewelry stack', real: true }], fit: '视觉变化明显的品：首饰、美妆、清洁', trap: '效果必须真实，不能加滤镜夸大', ev: 'official', src: 'seller' },
  { id: 'skeptic', name: '我本来不信', formula: '我一直以为[大家在吹牛]，直到[我自己试了]', frame: '本人拿着产品，表情真实', examples: [{ text: 'I always thought the girls were lying! This set is 10/10', real: true }, { text: 'Watch this and you tell me does it work', real: true }], fit: '已有一定热度、大家半信半疑的品', trap: '没用过别这么说，这是虚假证言', ev: 'data', src: 'fmcase' },
  { id: 'comment_reply', name: '回复评论', formula: '回复 @某人：[真实问题] → 当场回答', frame: '评论贴纸 + 本人和产品', examples: [{ text: 'Replying to @Sarah — watch this and you tell me does it work', real: true }, { text: 'Replying to @Girl In The Hat honestly this stuff is MAGIC for the MOMS', real: true }], fit: '已经发过视频、有人问问题的品', trap: '评论要真实，不要自己编', ev: 'data', src: 'fmcase' },
  { id: 'price_shock', name: '价格反差', formula: '[看起来很贵的东西] 只要 [日常小钱]', frame: '产品戴在身上，旁边是对比物', examples: [{ text: 'pov: my jewelry costs less than your matcha', real: true }, { text: 'phone case with stand and lens protectors, AND not even $10', real: true }], fit: '低客单、看着贵的品', trap: '官方禁止含糊的比价；不要说「比某大牌便宜」', ev: 'sample', src: 'sample' },
  { id: 'others_react', name: '别人的反应', formula: '大家都在问我[这个是不是很贵/哪里买的]', frame: '特写产品 + 一句反应', examples: [{ text: 'I\'m tired of everyone asking if I spent a month\'s salary on this', real: true }, { text: 'POV: You don\'t need a new manicure for compliments', real: true }], fit: '靠外观取胜的品：首饰、包、穿搭', trap: '别虚构具体的人和对话', ev: 'sample', src: 'sample' },
  { id: 'pov', name: 'POV 代入', formula: 'POV：你终于不用再[烦恼]了，因为你找到了[产品]', frame: '主观视角，产品在用', examples: [{ text: 'pov your no longer scrubbing baseboards on your hands and knees', real: true }], fit: '不露脸的账号、家居、清洁', trap: '要落到具体动作，不能只喊口号', ev: 'sample', src: 'sample' },
  { id: 'warning', name: '反向提醒', formula: '别[做某事]，除非…… / DO NOT [某事]', frame: '夸张动作或反差画面', examples: [{ text: 'DO NOT show this to your husband!', real: true }], fit: '礼物、冲动消费、家庭场景', trap: '点赞多未必转化，纯噱头要配上真实卖点', ev: 'sample', src: 'sample' },
  { id: 'confession', name: '自白 / 秘密', formula: '我一直没告诉别人[我的秘密]', frame: '近景，像和朋友说话', examples: [{ text: 'I just wanted to share this secret with you', real: true }], fit: '有真实故事的人物账号', trap: '故事必须真实', ev: 'case', src: 'ptr' },
  { id: 'list', name: '数字清单', formula: '[N] 个[今年买过最值的东西]', frame: '第一件产品已经在手上', examples: [{ text: '10 things I\'ve bought this year', real: true }], fit: '合集、新账号起号', trap: '清单类转化要看每一件的挂链', ev: 'sample', src: 'sample' },
  { id: 'howto', name: '最简单的办法', formula: '[想要的结果]最简单的办法', frame: '做之前或做到一半', examples: [{ text: 'The easiest way to make a simple outfit look more put together', real: true }], fit: '教程、搭配、收藏型内容', trap: '要真的给方法，不能只放产品', ev: 'sample', src: 'sample' },
  { id: 'test', name: '当场测试', formula: '我把它[泡水 / 戴着洗澡 / 摔地上]，看看会怎样', frame: '测试正在发生', examples: [{ text: 'Cute and waterproof', real: true }, { text: '开头就把项链放进水杯，屏幕字写「第 30 天」', real: false }], fit: '耐用、防水、不褪色', trap: '要真测；首饰短期测试不能说成永不褪色', ev: 'case', src: 'stanley' },
  { id: 'offer', name: '活动 / 上新', formula: '[产品]今天[降价 / 上新]，[原因]', frame: '产品 + 活动信息', examples: [{ text: 'Pavoi Advent Calendar on sale today', real: true }], fit: '大促节点、有真实优惠', trap: '官方要求写清优惠条件；促销钩子在大促季数据最好，平时会弱', ev: 'data', src: 'motion' },
  { id: 'curiosity', name: '纯悬念（少用）', formula: '你绝对想不到……', frame: '和产品无关的噱头', examples: [{ text: 'You won\'t believe what I found', real: true }], fit: '只想冲播放时偶尔用', trap: '数据显示这类能拿点击，但转化差。带货视频尽量别用', ev: 'data', src: 'pear', avoid: true },
];

// 风格库：beats 是脚本结构。id 兼容旧脚本（pain / demo / compare / unboxing / story / ugc）
const GROUPS = [
  { id: 'solve', name: '解决问题', hint: '有明确烦恼时' },
  { id: 'show', name: '展示产品', hint: '东西本身好看或好玩' },
  { id: 'person', name: '人和故事', hint: '靠信任和共鸣' },
  { id: 'value', name: '价格活动', hint: '靠划算和紧迫感' },
];

const STYLES = [
  { id: 'pain', group: 'solve', name: '痛点解决', tagline: '把烦恼说透，再给出答案', beats: ['点出具体烦恼', '放大后果或尴尬', '产品登场，当场解决', '证明：实测或买家反馈', '行动号召'], hooks: ['pain_callout', 'pov'], fit: '有明确烦恼的品', example: '「Your house may stink and you don\'t even know it.」', risk: '不要夸大恐惧，不要说医疗功效', forJewelry: true, ev: 'data', src: 'pear' },
  { id: 'comment_reply', group: 'solve', name: '回复评论', tagline: '用真实问题开场', beats: ['评论贴纸：买家的真实问题', '一句话正面回答', '当场演示', '顺带讲第二个卖点', '行动号召'], hooks: ['comment_reply'], fit: '已有视频和评论的品', example: '销售额最高的 medicube 视频就是这种形式', risk: '评论必须真实', forJewelry: true, ev: 'data', src: 'fmcase' },
  { id: 'skeptic', group: 'solve', name: '我本来不信', tagline: '从怀疑到真香', beats: ['承认自己怀疑', '为什么还是试了', '试的过程和结果', '小缺点（可信度）', '结论和行动号召'], hooks: ['skeptic'], fit: '有热度、大家半信半疑的品', example: '「I always thought the girls were lying!」', risk: '必须真的用过', forJewelry: true, ev: 'data', src: 'fmcase' },
  { id: 'compare', group: 'solve', name: '前后对比', tagline: '变化自己会说话', beats: ['使用前的样子', '使用过程', '使用后的结果', '左右或前后对照', '行动号召'], hooks: ['result_first'], fit: '效果看得见的品', example: '官方推荐：先展示过程，再展示结果', risk: '不能用滤镜或 AI 造假，不能承诺瞬间见效', ev: 'official', src: 'seller' },
  { id: 'test', group: 'solve', name: '极限实测', tagline: '把产品折腾一遍给你看', beats: ['说出要测什么', '测试过程', '揭晓结果', '说明测试条件', '行动号召'], hooks: ['test'], fit: '防水、耐用、不褪色', example: 'Stanley 杯的传播靠的就是杯子在极端情况下仍然有效', risk: '短期测试不能说成永久有效', forJewelry: true, ev: 'case', src: 'stanley' },
  { id: 'demo', group: 'show', name: '多角度演示', tagline: '近景看细节，远景看全貌', beats: ['一眼看懂的全貌', '近景讲细节 1', '近景讲细节 2', '实际使用', '行动号召'], hooks: ['result_first', 'test'], fit: '功能或细节多的品', example: '官方示例：包要拍全貌、材质、五金、背法、内部', risk: '说到什么就要拍到什么', forJewelry: true, ev: 'official', src: 'seller' },
  { id: 'silent', group: 'show', name: '无人声演示', tagline: '手、产品、屏幕字就够了', beats: ['产品开始动：最有趣的动作', '第二个动作', '第三个动作或结果', '屏幕字讲清是什么', '屏幕字行动号召'], hooks: ['result_first', 'pov'], fit: '不想露脸、视觉上一看就懂的品', example: '样本里的小工具爆款大多是这种', risk: '必须真实演示，官方不算静态图和幻灯片', ev: 'sample', src: 'sample' },
  { id: 'unboxing', group: 'show', name: '开箱', tagline: '拆的过程就是悬念', beats: ['包裹出现，点明期待', '拆开', '第一反应', '上手或试戴', '值不值和行动号召'], hooks: ['list', 'others_react'], fit: '包装好、礼物属性强的品', example: '样本里开箱和合集占带货视频的 13%', risk: '开场别太长，产品要尽早露出', forJewelry: true, ev: 'sample', src: 'sample' },
  { id: 'asmr', group: 'show', name: '质感特写', tagline: '让人想伸手摸一下', beats: ['微距特写，慢慢转动', '光线下闪动', '戴上身', '搭配一个场景', '屏幕字说清名字和价格'], hooks: ['result_first'], fit: '首饰、美妆、解压类', example: '「The sparkle」这条 150 万播放，文案只提了闪光', risk: '颜色和质感不能靠后期夸大', forJewelry: true, ev: 'sample', src: 'sample' },
  { id: 'styling', group: 'show', name: '一物多搭', tagline: '同一件东西，三种戴法', beats: ['成品造型开场', '第 1 种搭配', '第 2 种搭配', '第 3 种或叠戴', '行动号召'], hooks: ['howto', 'result_first'], fit: '首饰、配饰、服装', example: '样本里 16% 的首饰视频都在讲叠戴', risk: '搭配里出现的其他商品别让人以为包含在内', forJewelry: true, ev: 'sample', src: 'sample' },
  { id: 'tutorial', group: 'show', name: '实用教程', tagline: '先给方法，顺带卖货', beats: ['想要的结果', '步骤 1', '步骤 2', '常见错误', '产品和行动号召'], hooks: ['howto'], fit: '有使用门槛、适合收藏的品', example: '样本里 1 分钟以上的首饰视频收藏率是 20 秒内的 2–3 倍多', risk: '要有真实干货', forJewelry: true, ev: 'sample', src: 'sample' },
  { id: 'ugc', group: 'person', name: '真人测评', tagline: '像朋友一样聊', beats: ['一句真实的评价', '为什么买', '上手展示', '优点和一个小缺点', '买不买的建议'], hooks: ['skeptic', 'confession'], fit: '几乎所有品，尤其客单较高的', example: '官方建议使用真人、粗糙一点的生活感拍摄', risk: '收了钱要标注合作', forJewelry: true, ev: 'official', src: 'ttads' },
  { id: 'grwm', group: 'person', name: '边准备边聊', tagline: '化妆、出门的时候顺便种草', beats: ['正在准备的日常', '提到一个烦恼或要去的场合', '戴上或用上产品', '效果', '自然地提到购物车'], hooks: ['confession', 'others_react'], fit: '美妆、首饰、穿搭', example: '眼霜爆款就是在准备上班时拍的', risk: '别聊太久才露产品', forJewelry: true, ev: 'case', src: 'ptr' },
  { id: 'pov', group: 'person', name: 'POV 场景', tagline: '让观众直接代入', beats: ['POV 文字定场景', '场景里的小烦恼或期待', '产品进入场景', '变化', '行动号召'], hooks: ['pov', 'others_react'], fit: '不想露脸、场景感强的品', example: '「POV: You don\'t need a new manicure for compliments」', risk: '不要只有氛围，要有产品信息', forJewelry: true, ev: 'sample', src: 'sample' },
  { id: 'story', group: 'person', name: '剧情反转', tagline: '看到最后才知道', beats: ['抛出一个冲突', '情况变糟', '反转', '产品是反转的原因', '行动号召'], hooks: ['warning', 'confession'], fit: '有创意和演员的账号', example: '官方建议尝试讲故事、角色扮演、情侣问答', risk: '产品别太晚才出现', ev: 'official', src: 'seller' },
  { id: 'gift', group: 'person', name: '送礼反应', tagline: '拍下对方拆开的那一刻', beats: ['准备礼物的理由', '递给对方', '拆开和真实反应', '戴上', '节日提醒和行动号召'], hooks: ['others_react', 'warning'], fit: '节日、情侣、母亲节', example: '样本里 9% 的首饰视频提到礼物', risk: '反应要真实，别出现未成年人带货', forJewelry: true, ev: 'sample', src: 'sample' },
  { id: 'behind', group: 'person', name: '幕后和创始人', tagline: '让人看到是谁在做', beats: ['一个让人意外的幕后事实', '制作或打包过程', '细节和用心', '感谢买家', '行动号召'], hooks: ['confession', 'howto'], fit: '工厂、小品牌、手作', example: '官方建议分享工厂画面、团队和手写感谢卡', risk: '专利、奖项必须能证明', forJewelry: true, ev: 'official', src: 'seller' },
  { id: 'price', group: 'value', name: '价格反差', tagline: '看起来贵，其实不贵', beats: ['价值感特写', '猜价或日常对比', '报价', '为什么便宜也不差', '行动号召'], hooks: ['price_shock', 'others_react'], fit: '低客单、看着贵的品', example: '「pov: my jewelry costs less than your matcha」', risk: '不要提大牌，不要含糊比价', forJewelry: true, ev: 'sample', src: 'sample' },
  { id: 'list', group: 'value', name: '清单合集', tagline: '一次看好几个', beats: ['清单标题', '第 1 件', '第 2 件', '最好的放最后', '都在购物车'], hooks: ['list'], fit: '店里有多款、起号', example: '「10 things I\'ve bought this year」', risk: '每一件都要真实出现', ev: 'sample', src: 'sample' },
  { id: 'mystery', group: 'value', name: '盲盒和猜价', tagline: '每打开一个都是小悬念', beats: ['抛出盲盒或猜价', '第 1 件和判断', '第 2 件和判断', '最惊喜的一件', '总结值不值和行动号召'], hooks: ['others_react', 'list'], fit: '款式多的首饰、配饰', example: '盲盒首饰罐单条 4,550 万播放', risk: '时长长，要确保每件都有看点', forJewelry: true, ev: 'sample', src: 'sample' },
  { id: 'offer', group: 'value', name: '活动限时', tagline: '给一个现在就买的理由', beats: ['优惠和期限', '产品是什么', '证明它值', '活动条件', '行动号召'], hooks: ['offer'], fit: '大促、满减、上新', example: 'Motion 的数据里促销钩子命中率最高（Meta，且含黑五）', risk: '写清条件；不是真的限时就别说', forJewelry: true, ev: 'data', src: 'motion' },
];

const RETENTION = [
  { name: '第一帧不留空', how: '不要有「大家好」「今天给大家介绍」，第一帧就有产品或问题', ev: 'data', src: 'pear' },
  { name: '提前埋问题，后面才回答', how: '「最后那个才是我最喜欢的」「第 30 天它变成这样了」', ev: 'exp' },
  { name: '说什么就拍什么', how: '说两种颜色就要拍两种颜色。官方把这条列为基本要求', ev: 'official', src: 'seller' },
  { name: '近景和远景交替', how: '细节用特写，全貌用远景，手一直在动', ev: 'official', src: 'seller' },
  { name: '屏幕字和口播互补', how: '字幕让静音的人也能看懂；官方给的参考是每秒 5–10 个词，字不要挡产品', ev: 'official', src: 'ttads' },
  { name: '坦白一个小缺点', how: '在说完优点之后提一个无伤大雅的缺点，研究发现这在观众不细想时反而加分；缺点太严重或放在开头则无效', ev: 'paper', src: 'blemish' },
  { name: '把最强的证明放在中后段', how: '开头给结果，中间给过程，最后给最硬的证明，再报价', ev: 'exp' },
  { name: '人声优先', how: '研究发现原创口播比流行音乐更利于点赞和转发（品牌账号样本，相关性）。样本里 72% 的声音是 original sound，不是曲库音乐', ev: 'paper', src: 'estonia' },
  { name: '收藏型内容可以长一点', how: '样本里超过 2 分钟的首饰视频收藏率是 20 秒内的 3 倍多。卖货短、讲方法长', ev: 'sample', src: 'sample' },
  { name: '结尾要有动作', how: '要互动就问具体问题（研究发现这对评论最有效），要成交就直接说点购物车', ev: 'paper', src: 'estonia' },
];

const LENGTH = {
  title: '多长合适',
  body: '样本里带货视频时长中位数 26 秒（一半在 15–38 秒），60 秒以内各档播放差别不大，10 秒以内略低。Buffer 的数据是越长总播放越高（3 分钟以上平均是 6–10 秒的两倍多），但这是相关性。FastMoss 分析 medicube 的高销量视频，呈现「两头」：15–18 秒的证明型和 60–84 秒的教程型。',
  advice: '卖货先做 15–30 秒，讲方法或盲盒可以做到 1 分钟以上。结果都不够好时，先改开头，不要先改长度。',
  src: ['sample', 'buffer', 'fmcase'],
};

const PAIN = {
  intro: '「抓痛点」不是想一个烦恼写上去。按下面的顺序，从真实信号里找，一个商品找 3–5 个，每个单独拍一条。',
  sources: [
    { name: '差评和评论区', how: '看竞品差评里反复出现的词，那就是买家真正在意的事。FastMoss 的方法也是按「市场反复提到的卖点」排序，不按厂家自夸排序。' },
    { name: '使用的那一刻', how: '写出具体的时间地点：洗澡要不要摘？上班前来不及搭配？' },
    { name: '别人的眼光', how: '人们在意别人怎么看：会不会显得廉价？送礼拿不拿得出手？' },
    { name: '以前的替代品', how: '之前买的东西哪里让人失望：戴两周就变色，耳朵发痒。' },
    { name: '购买前的顾虑', how: '不敢下单的原因：会不会过敏？图片和实物一样吗？' },
  ],
  ladder: [
    { level: '功能', example: '戴几周就变色、把皮肤染绿', use: '实测类视频' },
    { level: '情绪', example: '看着廉价、搭配总差一点、怕戴错场合', use: 'POV、前后对比' },
    { level: '身份', example: '想看起来讲究、想被问「哪里买的」', use: '别人的反应、质感特写' },
  ],
  check: ['说出来，目标人群会不会点头说「对，就是我」？', '能不能在 3 秒内用一个画面表现出来？', '产品真的能解决吗？有没有依据？', '有没有夸大恐惧或涉及医疗？'],
  naming: '把烦恼写成具体症状，不要写成成分或参数。FastMoss 的 medicube 案例里，单靠成分讲解的视频只卖了 $518，直接说出具体问题的视频卖了 $50,685。成分放在证明环节讲。',
  naming_src: 'fmcase',
};

const JEWELRY = {
  intro: '美区 2026 年 9 月的首饰数据（FastMoss 估算，由 Branvas 整理）。先看清你卖的是哪一种首饰，打法不一样。',
  market: [
    { name: '时尚饰品（Costume）', gmv: '$3,329 万，环比 +14.8%', aov: '$12.92', channel: '视频 31.2%，直播 9.7%', advice: '靠短视频。$20 以下占 65% 的销售额，主打好看和不贵。' },
    { name: '首饰及衍生品（Fine）', gmv: '$4,336 万，环比 +39.9%', aov: '$40.64', channel: '视频 13.1%，直播 26.4%', advice: '直播比视频重要。$100 以上的商品只占 13% 却贡献了 47.7% 的销售额，需要更多信任。' },
    { name: '银饰（Fine 下的细分）', gmv: '$679 万，环比 +69%', aov: '$55.21', channel: '视频 5.2%，直播 40.3%', advice: '优先做直播，短视频负责引流。' },
  ],
  creators: '1 万到 10 万粉的达人贡献了最多的达人销售额（Fine 57.7%，Costume 47.6%），100 万粉以上加起来不到 3%。寄样优先找腰部。',
  sold: '时尚饰品里手链手镯销量最高（62.7 万件），其次项链（58.6 万）、耳饰（37.5 万，环比 +9.2%）。',
  pains: [
    { pain: '戴几周就变色', hook: '我戴着洗了 30 天澡，它变成这样了', proof: '按日期连续拍同一件', caution: '只说测试结果，不说永不褪色' },
    { pain: '耳朵痒、皮肤发红', hook: '耳朵敏感的人，买耳环先看这一点', proof: '展示材质说明或检测报告', caution: '没有检测报告不能说防过敏、无镍。研究显示约 11.4% 的人对镍过敏，三成耳环含镍，且和价格无关' },
    { pain: '把皮肤染绿', hook: '戴了一整天，看看手指', proof: '摘下后的皮肤特写', caution: '只拍真实结果' },
    { pain: '看起来廉价', hook: '大家都问我是不是花了一个月工资', proof: '自然光下特写、细节', caution: '不要提大牌和「平替」' },
    { pain: '不知道怎么搭', hook: '普通 T 恤一秒变讲究的办法', proof: '同一身衣服，戴和不戴的对比', caution: '其他配饰不要让人以为包含在内' },
    { pain: '不知道送什么', hook: '男朋友们，这是今年最不会出错的礼物', proof: '包装和对方的真实反应', caution: '节日提醒要真实，不虚构库存' },
  ],
  shots: ['手指捏住吊坠贴近镜头，轻轻转动（样本里最常见的第一帧）', '戴在身上的特写：脖子、耳朵、手腕、脚踝', '自然光或窗边，让金属反光动起来', '手把首饰从袋子或盒子里拿出来', '和日常物品同框看比例：手机、咖啡杯', '同一件的全身或半身：看实际大小', '摘下来后的皮肤和首饰内侧'],
  words: ['叠戴 stack（16%）', '平价 affordable（12%）', '不褪色 tarnish（11%）', '防水 waterproof（9%）', '送礼 gift（9%）', '14K（8%）', '日常 everyday（7%）'],
  brand: '样本里很多爆款说的是 PAVOI、Evry Jewels、Venoco 这类品牌自己的货，它们的品牌和商标别人不能用。跨境卖家要做无品牌同类或自己的品牌。四叶草这类造型容易联想到奢侈品的标志性系列，不要在视频里提那些品牌。',
};

const COMPLIANCE = [
  { rule: '商品要和详情页一致', detail: '说到的要拍到，提到两种颜色就要展示两种。', src: 'seller' },
  { rule: '不能虚假或夸大', detail: '不能用未经证实的奖项和认证，不能含糊比价。', src: 'seller' },
  { rule: '不能引流到站外', detail: '不能让人去 TikTok Shop 以外的地方买。', src: 'seller' },
  { rule: '不要遮挡产品', detail: '文字和贴纸不要放在产品上。', src: 'seller' },
  { rule: '不能只有静态画面', detail: '静态图、截图、幻灯片、GIF 动画都不算合格的带货视频，要有动作和口头介绍。', src: 'seller' },
  { rule: '要原创', detail: '不能搬运别的平台或重复发同一条；看到爆款要学结构，自己重拍。背景里能认出的 logo 要遮住。', src: 'sellerUk' },
  { rule: '每天有发布上限', detail: '英国小店页面写明：2026-11-05 起每个账号每天最多 25 条带货视频、50 条带货图文。其他站点以你的后台为准。', src: 'sellerUk' },
  { rule: 'AI 内容要标注', detail: '全部或大量 AI 生成的内容，特别是合成的人脸、声音或数字人，要标注：打开「AI-generated content」开关，或在视频或描述里说明。', src: 'aigc' },
  { rule: 'AI 不能改变商品', detail: '不能改尺寸、颜色、材质、形状、数量、功能，不能加不存在的配件，也不能把静态商品做成动画。违规可能被限流、移除商品链接、扣信用分，严重的永久封禁。', src: 'aigc' },
  { rule: 'AI 不能假装专家或用别人的脸', detail: '不能用 AI 生成的医生、专家背书；不能未经允许使用别人的肖像、声音或商标。', src: 'aigc' },
  { rule: '不能拍未成年人带货', detail: '官方把使用未成年人推广列为低质或禁止行为。', src: 'seller' },
];

const AI_VIDEO = {
  title: '用 AI 模型生成视频时怎么做才安全',
  points: [
    '能用 AI 的：场景、氛围、痛点画面、转场。这些不展示商品细节。',
    '尽量实拍的：商品特写和上身效果。AI 模型很容易把耳环的形状、颜色或数量画错，这正是规则禁止的。',
    '必须做的：发布时打开 AI 标识；生成后逐帧对比真实商品，有差异就不要发。',
    '一个稳妥的做法：用 AI 生成开头和场景，把实拍的商品镜头剪进去。',
    '省钱又不走样：先用商品图生成关键帧（一张几毛钱），对照真实商品挑好，再只把合格的做成视频（一秒几毛到一块）。不要直接让模型凭文字画商品。',
    '不要把白底商品图直接当第一帧做成视频：商品自己动起来就是规则禁止的「把静态商品做成动画」，第一帧也不抓人。先生成有人或手在用它的画面。',
  ],
  src: 'aigc',
};

const CASES = [
  { name: 'Peter Thomas Roth 眼霜', result: '一条视频约 2,300 万播放（后续报道更高），不到一周卖掉约半年的库存，全部零售渠道断货', what: '54 岁的普通用户，账号第 5 条视频。开场「I just wanted to share this secret with you」，讲手术后每天看到镜子都想哭，然后在脸上当场演示，不到三分钟效果可见。她自己在 Sephora 买的，没有收钱。', lesson: ['真实的人和真实的痛苦', '当场看得见的结果', '创始人总结的原因就是故事、用法和快速见效'], src: 'ptr' },
  { name: 'Stanley 杯', result: '原视频数千万播放，820 万点赞，品牌送车的回应再次传播', what: '博主的车被烧毁，杯架里的 Stanley 杯还在，里面还有冰块。品牌总裁两天内用 Stitch 回应，送杯子还送车。', lesson: ['极端场景最能证明核心卖点', '品牌要及时响应评论和热点', '不要摆拍这种事，但可以设计真实的耐用测试'], src: 'stanley' },
  { name: '奢华拖地液（样本）', result: '多个创作者的视频分别达到 2,370 万、1,180 万、500 万播放', what: '把拖地这件小事写成气味和体验：「Your house may stink and you don\'t even know it」「resort in the Bahamas」。大量用「回复评论」开场，屏幕上写明搜索关键词。', lesson: ['卖体验而不是功能', '用评论接力，一条带一条', '屏幕字写清品类和关键词'], src: 'sample' },
  { name: 'medicube 身体护理套装', result: '28 天内 2,003 条投流视频、431 条自然视频，单条最高 $105,152 GMV', what: '销售额靠前的 8 条里 4 条是回复评论；开头多是「我本来不信」或「你自己看有没有用」；有一条文案只有 #boils #cysts 就卖了 $50,685；纯讲成分的只卖了 $518。同一个创作者贡献了投流前 5 中的 3 条。', lesson: ['先分清投流和自然：投流爆款不一定能靠内容复制', '说症状不说成分', '找会拍的人做系列'], src: 'fmcase' },
  { name: '盲盒首饰罐（样本）', result: '单条 4,550 万播放、330 万点赞，时长 276 秒', what: '一个装满首饰的罐子，「花 40 欧值不值」，一件件拿出来评判。', lesson: ['每一件都是小悬念，所以长视频也留得住人', '评判过程本身就有互动'], src: 'sample' },
  { name: 'Mikayla 睫毛膏风波（反面）', result: '1,700 万播放，4 万评论，大多是负面', what: '观众怀疑前后对比里用了假睫毛，加上她以前批评过这种做法，舆论迅速反噬，也波及合作品牌。', lesson: ['前后对比一旦被怀疑，代价远大于收益', '合作要明确标注', '观众比你想的更会看细节'], src: 'mikayla' },
];

const TESTING = {
  intro: '没有人能保证一条视频会爆，能保证的是测得快、改得对。',
  steps: [
    '一个商品先拍 3–5 个不同的角度，不是同一条改几个字。官方也建议素材之间要有明显差异。',
    '选出画面最好的版本，只重录第一句话，每个开头跑几千次展示。',
    '看 2 秒播放率（钩子）→ 6 秒播放率（开头内容）→ 点击率 → 订单数。一定要看到订单，播放高不等于能卖。',
    '开头掉得厉害就改钩子；开头可以但后面平稳下滑就改内容；看到底却不买就改证明、价格和行动号召。',
    '效果好的自然视频再投 Promote 或 GMV Max 放大。新卖家官方建议每周至少发 2 条带货视频，再逐步增加。',
    '把跑赢的开头和结构存下来，下一款商品直接套用。',
  ],
  benchmarks: '参考（不同来源差异很大，只作方向）：Pear Growth 数据里 2 秒留存中位 31%，前四分之一 49%，后四分之一 17%；6 秒播放率 10.4%。先和自己的账号比。',
};

const SAMPLE = {
  summary: '来自 TikTok 公开发现页，取样时间 2026-11-05。不能代表所有视频，只说明进入发现页的视频的特征。',
  table: [
    { name: '全部', n: 550, plays: '7.2 万', dur: '26 秒', small: '48%', share: '0.14%', save: '0.25%' },
    { name: '带货', n: 266, plays: '27 万', dur: '26 秒', small: '52%', share: '0.12%', save: '0.20%' },
    { name: '首饰', n: 322, plays: '4.7 万', dur: '26 秒', small: '44%', share: '0.11%', save: '0.28%' },
  ],
  findings: [
    '播放破百万的 75 条带货视频里，40 条来自粉丝不足 1 万的账号，其中 23 条粉丝不足 3000。这里面有多少是投放起来的看不出来，所以不能说「小号自然就能爆」。',
    '这 75 条里 11 条的文案只有标签：钩子都在视频里，不在文案里。',
    '首饰视频 57% 用了 TikTok 自带的文字贴纸，带货视频 25%（剪辑软件压进画面的字统计不到，实际更高）。15% 的首饰视频（49 条）把一串搜索词写在贴纸里，例如「Gold anklets, Waterproof anklets…」。',
    '看封面：首饰前 30 条几乎都能第一眼看到首饰，20 多条有手在指或捏着产品，约一半露脸，约一半有屏幕字。小工具类大多不露脸，第一帧就是产品在工作或正在拆箱。封面不一定等于第一帧。',
    '超过 1 分钟的首饰视频收藏率明显更高（2 分钟以上 0.84%，20 秒内约 0.24%）。',
  ],
};

const SOURCES = {
  ttads: { name: 'TikTok 广告帮助中心：创意最佳实践', url: 'https://ads.tiktok.com/resources/help/article/creative-best-practices', ev: 'official' },
  seller: { name: 'TikTok Shop 卖家大学：优质带货视频建议', url: 'https://seller-us.tiktok.com/university/essay?knowledge_id=2816204956665642&lang=en', ev: 'official' },
  sellerTips: { name: 'TikTok Shop 卖家大学：带货视频增长技巧', url: 'https://seller-us.tiktok.com/university/course?learning_id=2520930700379950&content_id=2520930699921198&lang=en', ev: 'official' },
  sellerUk: { name: 'TikTok Shop 英国卖家大学：带货视频（发布上限）', url: 'https://seller-uk.tiktok.com/university/essay?knowledge_id=8650213581915936', ev: 'official' },
  aigc: { name: 'TikTok Shop 卖家大学：AI 生成内容规定', url: 'https://seller-us.tiktok.com/university/essay?knowledge_id=491489038501663&lang=en', ev: 'official' },
  newsroom: { name: 'TikTok 官方：推荐系统如何工作', url: 'https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you', ev: 'official' },
  pear: { name: 'Pear Growth：1,393 条 TikTok Shop 视频的钩子数据', url: 'https://www.peargrowth.com/blog/tiktok-shop-video-hooks-hook-rate', ev: 'data' },
  motion: { name: 'Motion 2026 创意基准：钩子排行（Meta 广告，非 TikTok）', url: 'https://motionapp.com/library/research/creative-benchmarks-2026/top-hook-tactics', ev: 'data' },
  fmcase: { name: 'FastMoss 公开案例：把爆款视频变成拍摄 brief', url: 'https://github.com/FastMoss/fastmoss-skills/blob/main/cases/05-content-brief.md', ev: 'data' },
  fmguide: { name: 'FastMoss 公开方法：领先指标与视频拆解', url: 'https://github.com/FastMoss/fastmoss-skills/blob/main/references/fm-video-brief.md', ev: 'exp' },
  branvas: { name: 'Branvas：TikTok Shop 统计（首饰数据来自 FastMoss，2026-09）', url: 'https://branvas.com/blogs/news/tiktok-shop-statistics', ev: 'data' },
  buffer: { name: 'Buffer：TikTok 视频时长研究', url: 'https://buffer.com/resources/best-tiktok-video-length/', ev: 'data' },
  berger: { name: 'Berger & Milkman（2012）What Makes Online Content Viral', url: 'https://faculty.wharton.upenn.edu/wp-content/uploads/2011/11/Virality.pdf', ev: 'paper' },
  estonia: { name: 'arXiv 2606.16053：9,654 条品牌 TikTok 视频的互动模型', url: 'https://arxiv.org/html/2606.16053', ev: 'paper' },
  blemish: { name: 'Ein-Gar, Shiv & Tormala（2012）小缺点的正面效应', url: 'https://businesswire.com/news/home/20110615007296/en/Small-Doses-of-Bad-News-May-be-Good-for-Sales-According-to-Stanford-Graduate-School-of-Business', ev: 'paper' },
  malaymail: { name: 'Malay Mail：短视频为什么让人冲动消费（作者引用马来西亚研究，本文未读到原文）', url: 'https://www.malaymail.com/news/what-you-think/2025/09/03/tiktok-made-me-buy-it-why-short-videos-trigger-instant-shopping-yusniza-kamarulzaman/189868', ev: 'paper' },
  nickel: { name: 'JAAD（2008）旧金山耳环镍含量研究', url: 'https://test01.ku.dk/:obvius/pureproxy/3974268/en/publications/nickel-release-from-earrings-purchased-in-the-united-states-the-s', ev: 'paper' },
  ptr: { name: 'Beauty Independent：Peter Thomas Roth 眼霜爆红始末', url: 'https://www.beautyindependent.com/what-happened-when-peter-thomas-roths-eye-product-went-viral-tiktok/', ev: 'case' },
  stanley: { name: 'Muse by Clios：Stanley 与车祸中幸存的杯子', url: 'https://musebyclios.com/on-brand/tiktok-stanley-come-to-the-rescue-of-a-woman-who-lost-her-car-in-a-fire/', ev: 'case' },
  mikayla: { name: 'Glossy：Mikayla Nogueira 睫毛膏风波', url: 'https://www.glossy.co/beauty/understanding-whats-behind-the-mikayla-nogueira-mascara-controversy/', ev: 'case' },
  sample: { name: '本次样本：TikTok 公开发现页 550 条视频', url: '', ev: 'sample' },
};

// 首饰优先推荐的风格（按样本里的常见程度和可执行性排序）
const JEWELRY_PICKS = ['styling', 'test', 'price', 'asmr', 'ugc', 'pov', 'grwm', 'gift'];

const full = () => ({ meta: META, evidence: EVIDENCE, summary: SUMMARY, funnel: FUNNEL, why: WHY, hooks: HOOKS, groups: GROUPS, styles: STYLES, jewelryPicks: JEWELRY_PICKS, retention: RETENTION, length: LENGTH, pain: PAIN, jewelry: JEWELRY, compliance: COMPLIANCE, aiVideo: AI_VIDEO, cases: CASES, testing: TESTING, sample: SAMPLE, sources: SOURCES });

const style = (id) => STYLES.find((s) => s.id === id);
const hook = (id) => HOOKS.find((h) => h.id === id);

// 给模型看的方法论摘要（控制长度：只放决定质量的规则）
function brief({ styleId, hookId, jewelry } = {}) {
  const st = style(styleId);
  const hk = hook(hookId);
  const hooks = (hk ? [hk] : (st?.hooks || []).map(hook).filter(Boolean)).map((h) => `${h.name}（${h.id}）：${h.formula}；真实例子：${h.examples.map((e) => e.text).join(' / ')}；注意：${h.trap}`);
  return [
    '【爆款规则，来自 TikTok 官方文档和真实投放数据】',
    '1. 大多数人 2 秒内离开。第一帧要有产品（最好有人），屏幕字关声音也能看懂，第一句话摆出问题或结果，三者说同一件事。不要有「大家好」「今天介绍」。',
    '2. 钩子要筛选出想买的人。不要用与产品无关的纯悬念（如「你绝对想不到」），这类能拿点击，转化差。',
    '3. 内容主张放在前 3 秒。结构：钩子 → 独特卖点 → 明确行动号召。',
    '4. 说到什么就拍到什么；近景看细节，远景看全貌；要有真人或手在动，不要静态图。',
    '5. 用具体症状和场景说话，不要先讲成分和参数；成分放在证明环节。',
    '6. 先证明再报价。可以坦白一个无伤大雅的小缺点（放在优点之后），增加可信度。',
    '7. 屏幕字短、不挡产品；可以把品类关键词写进屏幕字和文案，方便搜索。',
    '8. 风格要像真人随手拍，不要广告腔。',
    '9. 合规：不能夸大或编造效果、奖项和认证；不能提其他品牌或「平替」；不能引导到站外购买；优惠要写清条件；不能拍未成年人；不要编造真实评论和用户经历——需要真实素材的地方写成 [占位：请填真实评论]。',
    st ? `【这条的风格】${st.name}：${st.tagline}。结构：${st.beats.join(' → ')}。风险：${st.risk}。` : '',
    hooks.length ? `【可用的钩子】\n${hooks.join('\n')}` : '',
    jewelry ? `【首饰专用】第一帧用手捏着或戴在身上的特写，让金属反光动起来；和日常物品同框看比例。常见卖点：叠戴、平价、不褪色、防水、送礼。「防过敏、无镍、925、18K、防水、不褪色」必须有依据，只能说实测结果。不要提任何奢侈品牌。` : '',
  ].filter(Boolean).join('\n');
}

// 写进内置知识库的版本：Agent 和脚本生成可以引用
function asDocument() {
  const lines = [`# ${META.title}（${META.version} 研究）`, META.method, '', '## 核心结论'];
  for (const s of SUMMARY) lines.push(`- ${s.point}${s.detail}`);
  lines.push('', '## 钩子库');
  for (const h of HOOKS) lines.push(`- ${h.name}：${h.formula}。例：${h.examples.map((e) => e.text).join('；')}。适合：${h.fit}。注意：${h.trap}`);
  lines.push('', '## 风格库');
  for (const s of STYLES) lines.push(`- ${s.name}：${s.tagline}。结构：${s.beats.join(' → ')}。适合：${s.fit}。风险：${s.risk}`);
  lines.push('', '## 痛点挖掘', PAIN.intro, ...PAIN.sources.map((x) => `- ${x.name}：${x.how}`));
  lines.push('', '## 首饰', JEWELRY.intro, ...JEWELRY.market.map((m) => `- ${m.name}：GMV ${m.gmv}，均价 ${m.aov}，${m.channel}。${m.advice}`), JEWELRY.creators, ...JEWELRY.pains.map((p) => `- ${p.pain}：钩子「${p.hook}」，证明：${p.proof}，注意：${p.caution}`));
  lines.push('', '## 合规', ...COMPLIANCE.map((c) => `- ${c.rule}：${c.detail}`), '', '## 怎么测试', ...TESTING.steps.map((s) => `- ${s}`));
  return { title: `${META.title}（${META.version}）`, text: lines.join('\n') };
}

module.exports = { full, brief, style, hook, STYLES, HOOKS, GROUPS, asDocument, META };
