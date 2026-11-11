// 数据源与 ERP 连接器：FastMoss（选品数据）→ 1688（找货）→ ERP（上品）
// 每个厂商一个适配器，统一成同样的输入输出；没有官方接口的环节用浏览器插件或通用 Webhook 兜底
// status：ready 可直接使用 / beta 已按公开资料实现、拿到接口文档后需核对 / pending 等待厂商开放接口
const crypto = require('crypto');
const settings = require('./settings');
const { safeFetch } = require('./net');

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

const VENDORS = {
  // ---------- 统一接入：一个地址 + 一个 Key，下面的文本、看图、图片、视频、语音模型自动分好类，各自开关 ----------
  hub: {
    kind: 'hub', name: '模型接入（中转站 / OpenAI 兼容 / Anthropic）', status: 'ready', relay: true,
    desc: '填一次地址和 Key，读出全部模型并按名字自动分成文本、看图、图片、视频、语音；每个模型单独开关。写脚本、出图、出视频都从这里取，出错时自动换下一个启用的同类模型。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', ''], ['protocol', '协议', 'openai', ['openai', 'anthropic']], ['presetId', '预设', ''], ['endpoint', '视频提交路径', '/videos', ['/videos', '/video/generations']], ['resolution', '视频清晰度（模型名里已带清晰度时不用管）', '720p', ['480p', '720p', '1080p']], ['durations', '视频单段时长范围（秒）', '4-15'], ['size', '图片竖屏尺寸', '1024x1536'], ['temperature', '文本模型温度（0–1，越低越稳）', '0.7']],
  },
  // ---------- 选品数据 ----------
  fastmoss: {
    kind: 'product', name: 'FastMoss 开放接口', status: 'beta', link: 'https://developers.fastmoss.com/api/overview',
    desc: '官方接口：按类目和站点拉取商品，还能拿到每天的销量和 GMV，不占用每周的导出次数。到 FastMoss 开发者平台注册、在控制台创建密钥（可申请试用额度），按调用次数计费（官网写每次 $0.01 起，空结果不收费，以控制台账单为准）。没开通时：导出 Excel 拖进「智能选品」，或用浏览器插件发送当前页。',
    fields: [['apiKey', 'API 密钥（控制台的 client_secret）', true]],
    options: [['baseUrl', '接口地址', 'https://openapi.fastmoss.com']],
  },
  // ---------- 找货 ----------
  ali1688: {
    kind: 'sourcing', name: '1688 开放平台（官方）', status: 'beta', link: 'https://open.1688.com/',
    desc: '官方接口：关键词搜货、以图搜货、商品详情（阶梯价、库存、发货地、重量、SKU）。需要企业认证并申请跨境/分销相关权限；接口名可按开放平台里实际开通的填写。',
    fields: [['appKey', 'AppKey', true], ['appSecret', 'AppSecret', true], ['accessToken', 'Access Token（授权后获得）', true]],
    options: [['keywordApi', '关键词搜货接口', 'com.alibaba.fenxiao.crossborder:product.search.keywordQuery-1'], ['imageApi', '以图搜货接口', 'com.alibaba.fenxiao.crossborder:product.search.imageQuery-1'], ['detailApi', '商品详情接口', 'com.alibaba.fenxiao.crossborder:product.search.queryProductDetail-1']],
  },
  onebound1688: {
    kind: 'sourcing', name: '1688 数据接口（第三方聚合）', status: 'ready', link: 'https://open.onebound.cn/',
    desc: '官方 API 申请不下来时的替代方案：万邦等数据服务商提供 item_search（关键词）/ item_search_img（以图搜）/ item_get（详情）接口，个人可开通、按调用量付费。',
    fields: [['key', 'Key', true], ['secret', 'Secret', true]],
    options: [['baseUrl', '接口地址', 'https://api-gw.onebound.cn/1688']],
  },
  plugin: {
    kind: 'sourcing', name: '浏览器插件采集（无需 API）', status: 'ready', builtin: true,
    desc: '安装「运营台助手」插件后，选好商品，插件自动到 1688 关键词搜 / 以图搜、采集货源并补全详情；也可以在任意 1688 搜索结果或详情页手动发送。用的是你自己登录的浏览器，不需要任何 API。',
    fields: [],
  },
  // ---------- ERP / 上品 ----------
  miaoshou: {
    kind: 'erp', name: '妙手 ERP 开放平台', status: 'beta', link: 'https://erp.91miaoshou.com/open_platform.html',
    desc: '把选定的 1688 货源采集进妙手采集箱，再一键发布到 TikTok 店铺。签名方式按妙手公开说明（AppKey + HMAC-SHA256）实现，审核通过拿到接口文档后核对接口路径。',
    fields: [['appKey', 'AppKey', true], ['appSecret', 'AppSecret', true]],
    options: [['baseUrl', '接口地址', 'https://openapi.91miaoshou.com'], ['collectPath', '采集接口路径', '/open/v1/collect/url'], ['publishPath', '发布接口路径', '/open/v1/product/publish'], ['shopId', 'TikTok 店铺 ID（妙手里授权的店铺）', '']],
  },
  dianxiaomi: { kind: 'erp', name: '店小秘', status: 'pending', link: 'https://www.dianxiaomi.com/', desc: '暂未查到公开的开放平台文档。可先用「通用 Webhook」对接 RPA（影刀等）完成上品。', fields: [['appKey', 'AppKey', true], ['appSecret', 'AppSecret', true]] },
  mabang: { kind: 'erp', name: '马帮 ERP', status: 'pending', link: 'https://www.mabangerp.com/', desc: '接口开通后按文档接入；在此之前可用「通用 Webhook」。', fields: [['appKey', 'AppKey', true], ['appSecret', 'AppSecret', true]] },
  mangguo: { kind: 'erp', name: '芒果店长', status: 'pending', link: 'https://www.mangoerp.com/', desc: '接口开通后按文档接入；在此之前可用「通用 Webhook」。', fields: [['appKey', 'AppKey', true], ['appSecret', 'AppSecret', true]] },
  tongtu: { kind: 'erp', name: '通途 ERP', status: 'pending', link: 'https://www.tongtool.com/', desc: '接口开通后按文档接入；在此之前可用「通用 Webhook」。', fields: [['appKey', 'AppKey', true], ['appSecret', 'AppSecret', true]] },
  lingxing: { kind: 'erp', name: '领星 ERP', status: 'pending', link: 'https://www.lingxing.com/', desc: '接口开通后按文档接入；在此之前可用「通用 Webhook」。', fields: [['appId', 'AppId', true], ['appSecret', 'AppSecret', true]] },
  jijia: { kind: 'erp', name: '积加 ERP', status: 'pending', link: 'https://www.gerpgo.com/', desc: '接口开通后按文档接入；在此之前可用「通用 Webhook」。', fields: [['appId', 'AppId', true], ['appSecret', 'AppSecret', true]] },
  webhook: {
    kind: 'erp', name: '通用 Webhook（n8n / 影刀 / 自研 ERP）', status: 'ready',
    desc: '上品时把「上架包」（标题、描述、卖点、SKU、定价、1688 货源链接）以 JSON POST 到你的地址，由 n8n、影刀 RPA 或自研系统完成后续操作。请求头带 X-TK-Signature（HMAC-SHA256）。',
    fields: [['url', '接收地址（URL）', false], ['secret', '签名密钥（可选）', true]],
  },
  // ---------- 视频模型：从脚本直接生成视频（适配器见 services/videogen.js） ----------
  seedance: {
    kind: 'video', name: 'Seedance（字节 · 火山方舟）', status: 'beta', link: 'https://console.volcengine.com/ark',
    desc: '火山方舟控制台开通 Seedance 后创建 API Key。支持竖屏、首帧图、同步配音；模型也可以填推理接入点 ID。每个任务 4–15 秒（1.0 系列 2–12 秒）。',
    fields: [['apiKey', 'API Key', true]],
    keyUrl: 'https://console.volcengine.com/ark/region:cn-beijing/apiKey', refs: 9,
    options: [['baseUrl', '接口地址', 'https://ark.cn-beijing.volces.com/api/v3'], ['model', '模型', 'doubao-seedance-2-0-260128', ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-1-0-pro-250528']], ['resolution', '清晰度', '720p', ['480p', '720p', '1080p']], ['durations', '单段时长范围（秒）', '4-15']],
    models: [{ label: 'Seedance 2.0', id: 'doubao-seedance-2-0-260128', price: 1, note: '720p 约 46 元/百万 token 折算' }, { label: 'Seedance 2.0 Fast', id: 'doubao-seedance-2-0-fast-260128', price: '' }, { label: 'Seedance 1.0 Pro', id: 'doubao-seedance-1-0-pro-250528', price: '' }],
  },
  kling: {
    kind: 'video', name: '可灵 Kling', status: 'beta', link: 'https://kling.ai/document-api/api/get-started/authentication',
    desc: '可灵开放平台创建 API Key。支持竖屏、首帧图、多镜头一次生成（最多 6 个镜头）。服务器在中国境外用默认地址。',
    fields: [['apiKey', 'API Key', true]],
    keyUrl: 'https://app.klingai.com/global/dev/api-key',
    options: [['baseUrl', '接口地址', 'https://api-singapore.klingai.com'], ['model', '模型', 'kling-3.0', ['kling-3.0']], ['resolution', '清晰度', '720p', ['720p', '1080p']], ['durations', '单段时长范围（秒）', '3-15']],
    models: [{ label: '可灵 3.0', id: 'kling-3.0', price: 0.6, note: '官网 720p 无声 $0.084/秒折算' }],
  },
  wan: {
    kind: 'video', name: '通义万相 Wan（阿里云百炼）', status: 'beta', link: 'https://bailian.console.aliyun.com/',
    desc: '阿里云百炼开通后创建 API Key。地址、模型和 Key 要在同一个地域；控制台给的是工作空间专属地址时，把接口地址换成它（到 /api/v1 为止）。',
    fields: [['apiKey', 'API Key', true]],
    keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    options: [['baseUrl', '接口地址', 'https://dashscope.aliyuncs.com/api/v1'], ['model', '文生视频模型', 'wan2.7-t2v', ['wan2.7-t2v']], ['imageModel', '图生视频模型（用首帧图时）', 'wan2.7-i2v', ['wan2.7-i2v']], ['resolution', '清晰度', '720P', ['720P', '1080P']], ['durations', '单段时长范围（秒）', '2-15']],
    models: [{ label: '万相 2.7', id: 'wan2.7-t2v', price: 0.6, note: '官网北京地域 720P 0.6 元/秒' }],
  },
  minimax: {
    kind: 'video', name: '海螺 Hailuo（MiniMax）', status: 'beta', link: 'https://platform.minimax.io/docs/api-reference/video-generation-intro',
    desc: 'MiniMax 开放平台创建 API Key。每段只能 6 秒或 10 秒。注意：文生视频接口没有画面比例参数，要竖屏请给一张竖版首帧图。',
    fields: [['apiKey', 'API Key', true]],
    keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    options: [['baseUrl', '接口地址', 'https://api.minimax.io'], ['model', '模型', 'MiniMax-Hailuo-2.3', ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02']], ['resolution', '清晰度', '768P', ['768P', '1080P']], ['durations', '单段可选时长（秒）', '6,10']],
  },
  videonewapi: {
    kind: 'video', name: '中转站（new-api 格式）', status: 'beta', relay: true, recommend: '大多数中转站选这个',
    desc: '大多数中转站都是 new-api 搭的（后台有「令牌」「模型广场」「分组」的就是）。只填中转站地址和 Key，模型点「获取模型列表」读取，单价点「读取价格」。Seedance、可灵、MiniMax 等都走这一个。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', ''], ['model', '模型', ''], ['endpoint', '提交路径', '/videos', ['/videos', '/video/generations']], ['resolution', '清晰度（模型名里已带清晰度时不用管）', '720p', ['480p', '720p', '1080p']], ['durations', '单段时长范围（秒）', '4-15']],
  },
  videocustom: {
    kind: 'video', name: '自定义视频接口（格式特殊的接口）', status: 'ready',
    desc: '只给不是 new-api 格式的接口用，要自己写提交地址、请求体模板和结果字段路径。一般的中转站请在「添加模型」里选「中转站」。异步「提交任务 → 查询任务」形式的接口都能接。模板里可用 {{prompt}} {{model}} {{duration}} {{ratio}} {{image}} {{audio}}；路径用点号写，例如 data.task_id。',
    fields: [['apiKey', 'API Key', true]],
    options: [['submitUrl', '提交地址（POST）', ''], ['submitBody', '请求体模板（JSON）', '{"model":"{{model}}","prompt":"{{prompt}}","duration":{{duration}},"aspect_ratio":"{{ratio}}"}'], ['taskIdPath', '任务 ID 字段路径', 'id'], ['queryUrl', '查询地址（GET，用 {{id}} 表示任务 ID）', ''], ['statusPath', '状态字段路径', 'status'], ['doneValues', '成功的状态值（逗号分隔）', 'succeeded,success,completed,done'], ['failValues', '失败的状态值（逗号分隔）', 'failed,fail,error,cancelled,canceled,expired'], ['videoUrlPath', '视频地址字段路径', 'video_url'], ['errorPath', '错误信息字段路径（可选）', 'error.message'], ['authHeader', '鉴权头（用 {{key}} 表示密钥）', 'Authorization: Bearer {{key}}'], ['model', '模型', ''], ['durations', '单段时长范围（秒）', '5-10']],
  },
  // ---------- 生成图片：批量出片先出关键帧（services/imagegen.js） ----------
  seedream: {
    kind: 'image', name: 'Seedream（字节 · 火山方舟）', status: 'beta', link: 'https://console.volcengine.com/ark', keyUrl: 'https://console.volcengine.com/ark/region:cn-beijing/apiKey', refs: 10,
    desc: '按商品图生成关键帧：最多传 10 张参考图，商品外形最稳。Key 和 Seedance 是同一个。按张收费，一张关键帧比一秒视频便宜得多。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', 'https://ark.cn-beijing.volces.com/api/v3'], ['model', '模型', 'doubao-seedream-4-5-251128'], ['size', '竖屏尺寸', '1440x2560']],
    models: [{ label: 'Seedream 4.5', id: 'doubao-seedream-4-5-251128', price: 0.29, note: '按海外价 $0.04/张折算' }],
  },
  imageopenai: {
    kind: 'image', name: '中转站 / OpenAI 兼容图片接口', status: 'beta', relay: true, recommend: '中转站的 Seedream、gpt-image 选这个', refs: 6,
    desc: '/images/generations 接口，参考图放在 image 字段（中转站的 Seedream、gpt-image 等多数这样转发）。接口地址填到 /v1 为止。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', ''], ['model', '模型', ''], ['size', '竖屏尺寸', '1024x1536']],
  },
  imagechat: {
    kind: 'image', name: '中转站 · 对话接口出图（Gemini 图片模型等）', status: 'beta', relay: true, refs: 6,
    desc: '用 /chat/completions 出图的模型：把参考图和要求发过去，从回复里取图片（支持 images 字段、图片链接和 base64）。接口地址填到 /v1 为止。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', ''], ['model', '模型', '']],
  },
  // ---------- 看画面的模型：拆解爆款视频用（services/understand.js） ----------
  visionglm: {
    kind: 'vision', name: '智谱 GLM 视觉模型', status: 'ready', link: 'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    desc: '拆解爆款视频时看画面、读字幕。GLM-4.6V-Flash 官方标明免费，先用它就行。Key 和智谱大模型是同一个。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', 'https://open.bigmodel.cn/api/paas/v4'], ['model', '模型', 'glm-4.6v-flash', ['glm-4.6v-flash', 'glm-4.6v-flashx', 'glm-4.6v']]],
  },
  visionopenai: {
    kind: 'vision', name: 'OpenAI 兼容的视觉模型（通义 / 豆包 / OpenAI 等）', status: 'ready',
    desc: '任何支持 image_url 的 OpenAI 兼容模型，例如通义的 qwen-vl 系列、豆包视觉模型、gpt-4.1。保存后点「测试」会真的发一张图，确认模型看得见。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', 'https://dashscope.aliyuncs.com/compatible-mode/v1'], ['model', '模型', 'qwen-vl-max']],
  },
  visionclaude: {
    kind: 'vision', name: 'Anthropic Claude', status: 'ready',
    desc: 'Claude 系列模型都能看图。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', 'https://api.anthropic.com'], ['model', '模型', 'claude-sonnet-5-5', ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']]],
  },
  // ---------- 语音转写：拆解爆款视频时把口播转成文字 ----------
  asrsiliconflow: {
    kind: 'asr', name: '硅基流动语音转写', status: 'ready', link: 'https://docs.siliconflow.cn/docs/api/audio-transcriptions-post', keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    desc: '接口是 /audio/transcriptions，单个文件 1 小时、50MB 以内。Key 和硅基流动大模型是同一个。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', 'https://api.siliconflow.cn/v1'], ['model', '模型', 'FunAudioLLM/SenseVoiceSmall', ['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR']]],
  },
  asrglm: {
    kind: 'asr', name: '智谱语音转写', status: 'ready', link: 'https://docs.bigmodel.cn/',
    desc: '模型 glm-asr-2512。接口单次只收 30 秒内的音频，系统会自动切段再拼起来。Key 和智谱大模型是同一个。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', 'https://open.bigmodel.cn/api/paas/v4'], ['model', '模型', 'glm-asr-2512'], ['chunkSeconds', '每段秒数', '28']],
  },
  asropenai: {
    kind: 'asr', name: 'OpenAI 兼容语音转写（Whisper / Groq 等）', status: 'ready',
    desc: '任何 /audio/transcriptions 接口。例如 OpenAI 的 whisper-1，或 Groq（接口地址 https://api.groq.com/openai/v1，模型 whisper-large-v3-turbo）。',
    fields: [['apiKey', 'API Key', true]],
    options: [['baseUrl', '接口地址', 'https://api.openai.com/v1'], ['model', '模型', 'whisper-1']],
  },
};

// ---------- 存储（每个用户自己的配置，放在 settings 里） ----------
const list = () => settings.get().connectors || [];

// 中转站地址只填了域名时补上 /v1：new-api 一类中转站的接口都在 /v1 下
function relayBase(u) {
  const s = String(u || '').trim().replace(/\/+$/, '');
  try {
    const x = new URL(s);
    return x.pathname === '/' || x.pathname === '' ? `${x.origin}/v1` : s;
  } catch {
    return s;
  }
}

function save(input) {
  const s = settings.get();
  const v = VENDORS[input.vendor];
  if (!v) throw err('不支持的连接器类型');
  s.connectors = s.connectors || [];
  let c = input.id && s.connectors.find((x) => x.id === input.id);
  const creds = {};
  for (const [f, , secret] of v.fields) {
    const val = String(input.creds?.[f] ?? '').trim();
    // 脱敏值或留空：保留原值
    if (secret && (val.includes('••') || (!val && c))) creds[f] = c?.creds?.[f] || '';
    else creds[f] = val;
  }
  const options = {};
  for (const [f, , def] of v.options || []) options[f] = String(input.options?.[f] ?? c?.options?.[f] ?? def ?? '').trim();
  if (v.relay && options.baseUrl) options.baseUrl = relayBase(options.baseUrl);
  const models = Array.isArray(input.models) ? cleanModels(input.models) : c?.models || cleanModels(v.models || []);
  // 默认模型要在映射表里：没选或选的已删掉时用第一个
  if (models.length && 'model' in options && !models.some((m) => m.id === options.model)) options.model = models[0].id;
  const extra = { note: String(input.note ?? c?.note ?? '').slice(0, 200), models };
  if (c) Object.assign(c, { name: input.name || c.name, creds, options, ...extra, enabled: input.enabled !== false, updatedAt: new Date().toISOString() });
  else {
    c = { id: 'cn_' + crypto.randomBytes(5).toString('hex'), vendor: input.vendor, name: input.name || v.name, creds, options, ...extra, enabled: input.enabled !== false, createdAt: new Date().toISOString() };
    s.connectors.push(c);
  }
  settings.update({});
  return publicOne(c);
}

// 模型映射：显示名 / 实际请求的模型 / 单价（人民币；单位：秒、条或张，不填时视频按秒、图片按张）
const UNITS = ['秒', '条', '张'];
// 统一接入里每个模型的类型。imagechat：用对话接口出图的模型（Gemini 图片模型等）
const KINDS = { text: '文本', vision: '看图', image: '图片', imagechat: '图片（对话出图）', video: '视频', asr: '语音转写', other: '其他（不用）' };
function cleanModels(list) {
  const out = [];
  for (const m of list.slice(0, 400)) {
    const id = String(m?.id || '').trim().slice(0, 120);
    if (!id || out.some((x) => x.id === id)) continue;
    const price = m.price === '' || m.price == null ? '' : Number(m.price);
    const x = { label: String(m.label || id).trim().slice(0, 60), id, price: Number.isFinite(price) && price >= 0 ? price : '', unit: UNITS.includes(m.unit) ? m.unit : '', note: String(m.note || '').slice(0, 80) };
    if (m.kind !== undefined) x.kind = KINDS[m.kind] ? m.kind : classify(id);
    if (m.enabled !== undefined) x.enabled = m.enabled !== false;
    out.push(x);
  }
  return out;
}
// 某个连接器下可选的模型：映射表为空时用默认模型
function modelsOf(c) {
  if (c.models?.length) return c.models;
  const id = c.options?.model || VENDORS[c.vendor]?.options?.find((o) => o[0] === 'model')?.[2] || '';
  return id ? [{ label: id, id, price: '' }] : [];
}
// 用指定模型请求：复制一份连接器，把默认模型换掉
const withModel = (c, model) => (model ? { ...c, options: { ...c.options, model } } : c);

function remove(id) {
  const s = settings.get();
  s.connectors = (s.connectors || []).filter((c) => c.id !== id);
  settings.update({});
}

// 标签里带「可选」的字段可以不填
const required = (field) => !/可选/.test(field[1]);
const mask = (v) => (!v ? '' : v.length <= 8 ? '••••' : `${v.slice(0, 4)}••••${v.slice(-4)}`);
function publicOne(c) {
  const v = VENDORS[c.vendor] || {};
  const creds = {};
  for (const [f, , secret] of v.fields || []) creds[f] = secret ? mask(c.creds?.[f]) : c.creds?.[f] || '';
  return { ...c, ...(c.vendor === 'hub' ? { models: hubModels(c) } : {}), creds, kind: v.kind, status: v.status, configured: (v.fields || []).filter(required).every(([f]) => c.creds?.[f]) };
}
const publicList = () => list().map(publicOne);
const catalog = () => Object.fromEntries(Object.entries(VENDORS).map(([k, v]) => [k, { kind: v.kind, name: v.name, status: v.status, desc: v.desc, link: v.link, keyUrl: v.keyUrl || '', relay: !!v.relay, recommend: v.recommend || '', refs: v.refs || 0, models: v.models || [], builtin: !!v.builtin, fields: v.fields.map(([f, l, s]) => ({ key: f, label: l, secret: !!s })), options: (v.options || []).map(([f, l, d, choices]) => ({ key: f, label: l, default: d, choices })) }]));

// 当前可用的某类连接器（已启用、已填写凭证）：统一接入拆出来的在前，首选的排第一
const ready = (c) => c.enabled !== false && VENDORS[c.vendor]?.status !== 'pending' && (VENDORS[c.vendor]?.fields || []).filter(required).every(([f]) => c.creds?.[f]);
function active(kind) {
  const own = list().filter((c) => ready(c) && VENDORS[c.vendor]?.kind === kind);
  const all = [...list().filter((c) => c.vendor === 'hub' && ready(c)).flatMap((h) => virtuals(h).filter((v) => VENDORS[v.vendor].kind === kind)), ...own];
  const pref = String(settings.get().modelPrefs?.[kind] || '').split('|')[0];
  return pref ? [...all.filter((c) => c.id === pref || c.hub === pref), ...all.filter((c) => c.id !== pref && c.hub !== pref)] : all;
}
// 统一接入拆出来的连接器 id 是「接入 id:类型」；旧连接器迁移进统一接入后，旧 id 记在别名表里，老任务重试还能找到
function get(id) {
  if (!id) return null;
  const alias = settings.get().connectorAliases?.[id];
  if (alias && alias !== id) return get(alias);
  const [hid, vk] = String(id).split(':');
  if (vk) {
    const h = list().find((c) => c.id === hid && c.vendor === 'hub');
    return (h && virtuals(h).find((v) => v.id === id)) || null;
  }
  return list().find((c) => c.id === id) || null;
}

// ---------- 统一接入：一个地址 + Key，模型自动分类、单独开关、出错自动换 ----------
// 按模型名认类型；中转站价格表里有接口类型时以它为准
const has = (re, id) => re.test(String(id).toLowerCase());
function classify(id, endpointTypes = []) {
  const t = endpointTypes.join(' ').toLowerCase();
  if (/video/.test(t)) return 'video';
  if (/embed|rerank|moderation/.test(t)) return 'other';
  if (/audio|transcri|whisper/.test(t)) return 'asr';
  if (/image/.test(t)) return has(/gemini|nano.?banana/, id) ? 'imagechat' : 'image';
  if (has(/embed|rerank|moderation|(^|[-_/])tts([-_]|$)|text-to-speech|speech-d|realtime/, id)) return 'other';
  if (has(/video|seedance|kling|hailuo|(^|[-_/])veo|sora|vidu|runway|pika|luma|pixverse|(^|[-_/])t2v|(^|[-_/])i2v|(^|[-_/])s2v|wan\d.*-(t2v|i2v)|minimax-h\d|hunyuan-?video/, id)) return 'video';
  if (has(/gemini.*image|nano.?banana/, id)) return 'imagechat';
  if (has(/image|seedream|dall-?e|gpt-image|flux|imagen|midjourney|(^|[-_/])mj[-_]|sdxl|stable-diffusion|kolors|ideogram|recraft|cogview|qwen-image|wanx/, id)) return 'image';
  if (has(/whisper|(^|[-_/])asr|transcri|sensevoice|paraformer|telespeech/, id)) return 'asr';
  if (has(/(^|[-_/])vl([-_]|$)|vision|-vl-|\d(\.\d)?v($|[-_])|4v|qvq|llava|internvl|minicpm-v|pixtral/, id)) return 'vision';
  return 'text';
}
// 一看就是对话模型的名字（迁移旧的视频连接器时，把误放进去的文字模型改回文本）
const looksText = (id) => has(/^(glm|deepseek|kimi|moonshot|qwen|gpt-|o\d|claude|gemini|doubao-(pro|lite|seed-1)|hunyuan-(chat|2|t1|turbo|large)|minimax-(m|text)|step-|mimo|ernie|yi-|llama|mistral)/, id) && classify(id) === 'text';
const hubModels = (h) => (h.models || []).map((m) => ({ ...m, kind: m.kind || classify(m.id), enabled: m.enabled !== false }));
const enabledOf = (h, kinds) => hubModels(h).filter((m) => m.enabled && kinds.includes(m.kind));
// 统一接入里的模型按类型交给原有的接口实现
const VIRTUAL = { video: ['videonewapi', ['video']], image: ['imageopenai', ['image']], imagechat: ['imagechat', ['imagechat']], vision: [null, ['vision']], asr: ['asropenai', ['asr']] };
function virtuals(h) {
  const out = [];
  for (const [vk, [vendor0, kinds]] of Object.entries(VIRTUAL)) {
    const ms = enabledOf(h, kinds);
    if (!ms.length) continue;
    const vendor = vendor0 || (h.options?.protocol === 'anthropic' ? 'visionclaude' : 'visionopenai');
    const o = h.options || {};
    out.push({
      id: `${h.id}:${vk}`, hub: h.id, vendor, name: h.name, note: h.note || '', enabled: true, creds: { apiKey: h.creds?.apiKey || '' },
      options: { baseUrl: o.baseUrl || '', model: ms[0].id, endpoint: o.endpoint || '/videos', resolution: o.resolution || '720p', durations: o.durations || '4-15', size: o.size || '1024x1536' },
      models: ms.map(({ label, id, price, unit, note }) => ({ label, id, price, unit, note })),
    });
  }
  return out;
}

// 文本模型：首选在前，其余启用的按顺序排；刚出错的往后放
const cooling = new Map(); // 「接入 id|模型」→ 出错时间（内存里，重启清空）
const COOL_MS = 5 * 60 * 1000;
const hot = (ref) => Date.now() - (cooling.get(ref) || 0) < COOL_MS;
function markFail(ref) {
  cooling.set(ref, Date.now());
}
const markOk = (ref) => cooling.delete(ref);
function textCfgs(h) {
  const o = h.options || {};
  const temp = Number(o.temperature);
  // 看图模型也能写字，排在文字模型后面当备用
  return [...enabledOf(h, ['text']), ...enabledOf(h, ['vision'])].map((m) => ({ id: h.id, ref: `${h.id}|${m.id}`, name: h.name, protocol: o.protocol === 'anthropic' ? 'anthropic' : 'openai', baseUrl: o.baseUrl, apiKey: h.creds?.apiKey || '', model: m.id, kind: m.kind, temperature: Number.isFinite(temp) && o.temperature !== '' ? temp : 0.7 }));
}
function textPool() {
  const s = settings.get();
  const out = list().filter((c) => c.vendor === 'hub' && ready(c)).flatMap(textCfgs);
  const pref = s.modelPrefs?.text;
  const i = out.findIndex((x) => x.ref === pref);
  if (i > 0) out.unshift(...out.splice(i, 1));
  const firstText = out.findIndex((x) => x.kind === 'text');
  if (i < 0 && firstText > 0) out.unshift(...out.splice(firstText, 1));
  return [...out.filter((x) => !hot(x.ref)), ...out.filter((x) => hot(x.ref))];
}
// 某类媒体模型的候选：[{ c: 连接器（已换成该模型）, ref }]，首选在前，刚出错的放后面
function mediaPool(kind) {
  const out = active(kind).flatMap((c) => modelsOf(c).filter((m) => m.enabled !== false).map((m) => ({ c: withModel(c, m.id), ref: `${c.hub || c.id}|${m.id}`, connectorId: c.id, model: m.id })));
  const pref = settings.get().modelPrefs?.[kind];
  const i = out.findIndex((x) => x.ref === pref);
  if (i > 0) out.unshift(...out.splice(i, 1));
  return [...out.filter((x) => !hot(x.ref)), ...out.filter((x) => hot(x.ref))];
}
const autoFallback = () => settings.get().autoFallback !== false;

// 首选模型和出错自动换模型的开关
function setPrefs({ kind, ref, autoFallback: af } = {}) {
  const s = settings.get();
  s.modelPrefs = s.modelPrefs || {};
  if (kind) {
    if (!['text', 'vision', 'image', 'video', 'asr'].includes(kind)) throw err('类型不对');
    if (ref) s.modelPrefs[kind] = String(ref);
    else delete s.modelPrefs[kind];
  }
  if (af !== undefined) s.autoFallback = !!af;
  settings.update({});
  return { modelPrefs: s.modelPrefs, autoFallback: s.autoFallback !== false };
}

// 在列表里直接开关模型：enable / disable 是模型 id 列表；all: true 全部启用、false 全部停用；kinds 改类型
function setModels(id, { enable = [], disable = [], all, kinds = {}, kind } = {}) {
  const h = list().find((c) => c.id === id);
  if (!h) throw err('这个接入不存在', 404);
  h.models = hubModels(h).map((m) => {
    const x = { ...m };
    if (kinds[m.id] && KINDS[kinds[m.id]]) x.kind = kinds[m.id];
    const inScope = !kind || x.kind === kind || (kind === 'image' && x.kind === 'imagechat');
    if (all !== undefined && inScope && x.kind !== 'other') x.enabled = !!all;
    if (enable.includes(m.id)) x.enabled = true;
    if (disable.includes(m.id)) x.enabled = false;
    return x;
  });
  settings.update({});
  return publicOne(h);
}

// 旧数据迁移（每个账号一次）：「模型供应商」和中转站类型的视频 / 图片 / 看图 / 语音连接器，
// 按「地址 + Key」合并成统一接入；原来启用的供应商成为首选文本模型
const RELAY_KIND = { videonewapi: 'video', imageopenai: 'image', imagechat: 'imagechat', visionopenai: 'vision', asropenai: 'asr' };
function migrate(s) {
  s.connectors = Array.isArray(s.connectors) ? s.connectors : [];
  const sameKey = (h, base, key, protocol) => h.vendor === 'hub' && relayBase(h.options?.baseUrl).toLowerCase() === relayBase(base).toLowerCase() && (h.creds?.apiKey || '') === key && (h.options?.protocol || 'openai') === protocol;
  const hubFor = (name, base, key, protocol, extra = {}) => {
    let h = s.connectors.find((x) => sameKey(x, base, key, protocol));
    if (!h) {
      h = { id: 'cn_' + crypto.randomBytes(5).toString('hex'), vendor: 'hub', name: name || '模型接入', creds: { apiKey: key }, options: { baseUrl: relayBase(base), protocol, presetId: '', endpoint: '/videos', resolution: '720p', durations: '4-15', size: '1024x1536', temperature: '0.7', ...extra }, models: [], note: '', enabled: true, createdAt: new Date().toISOString() };
      s.connectors.push(h);
    }
    return h;
  };
  const add = (h, m) => {
    const x = h.models.find((y) => y.id === m.id);
    if (x) x.enabled = x.enabled || m.enabled;
    else h.models.push(m);
  };
  for (const p of Array.isArray(s.providers) ? s.providers : []) {
    if (!p.baseUrl) continue;
    const h = hubFor(p.name, p.baseUrl, p.apiKey || '', p.protocol === 'anthropic' ? 'anthropic' : 'openai', { presetId: p.presetId || '', temperature: String(p.temperature ?? 0.7) });
    if (p.model) add(h, { label: p.model, id: p.model, price: '', unit: '', note: '', kind: classify(p.model) === 'vision' ? 'vision' : 'text', enabled: true });
    if (p.id === s.activeProviderId && p.model) s.modelPrefs = { ...(s.modelPrefs || {}), text: `${h.id}|${p.model}` };
  }
  s.connectorAliases = s.connectorAliases || {};
  for (const c of [...s.connectors]) {
    const kind = RELAY_KIND[c.vendor];
    if (!kind || !c.options?.baseUrl) continue;
    const h = hubFor(c.name, c.options.baseUrl, c.creds?.apiKey || '', 'openai');
    for (const k of ['endpoint', 'resolution', 'durations', 'size']) if (c.options[k]) h.options[k] = c.options[k];
    if (c.note && !h.note) h.note = c.note;
    for (const m of modelsOf(c)) {
      const k = kind !== 'imagechat' && looksText(m.id) ? 'text' : kind;
      add(h, { ...m, kind: k, enabled: c.enabled !== false });
    }
    s.connectorAliases[c.id] = `${h.id}:${kind}`;
    s.connectors = s.connectors.filter((x) => x !== c);
  }
  if (Array.isArray(s.providers) && s.providers.length) s.providersBackup = s.providers;
  s.providers = [];
}

// ---------- HTTP ----------
// 地址由用户填写：普通用户不能请求服务器内网，管理员可以（自建 n8n 等），规则见 net.js
async function request(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    if (!res.ok) throw err(`接口返回 HTTP ${res.status}：${(data.error_msg || data.message || data.error || data.raw || '').toString().slice(0, 160)}`, 424);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw err('接口请求超时', 424);
    if (e.cause?.code) throw err(`无法连接接口（${e.cause.code}）`, 424);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ---------- 1688 货源：统一成同一种结构 ----------
// 兼容官方（saleInfo.priceRanges / amountOnSale / shippingInfo.unitWeight / skuInfos）和第三方聚合（price / num / location / weight / skus）的字段
const pick = (o, ...paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};
const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function normalizeOffer(o, source) {
  const id = String(pick(o, 'offerId', 'num_iid', 'productID', 'productId', 'itemId', 'id') ?? '');
  let ranges = pick(o, 'priceRanges', 'saleInfo.priceRanges', 'priceRange', 'price_range', 'productSaleInfo.priceRangeList');
  if (Array.isArray(ranges)) ranges = ranges.map((r) => (Array.isArray(r) ? { startQuantity: toNum(r[0]), price: toNum(r[1]) } : { startQuantity: toNum(r.startQuantity ?? r.beginAmount ?? r.min ?? r.quantity), price: toNum(r.price ?? r.value) })).filter((r) => r.price != null);
  else ranges = [];
  const price = toNum(pick(o, 'price', 'promotion_price', 'consignPrice', 'priceInfo.price', 'saleInfo.consignPrice')) ?? (ranges.length ? Math.min(...ranges.map((r) => r.price)) : null);
  const skuList = pick(o, 'skus.sku', 'skuInfos', 'productSkuInfos', 'skuInfo.specs', 'skus') || [];
  const addr = pick(o, 'sendGoodsAddress', 'sendGoodsAddressText', 'shippingInfo.sendGoodsAddressText', 'location', 'province');
  const weightRaw = toNum(pick(o, 'unitWeight', 'shippingInfo.unitWeight', 'weight', 'item_weight'));
  // 1688 的 unitWeight 单位是千克；第三方有的用克，超过 50 视为克
  const weightKg = weightRaw == null ? null : weightRaw > 50 ? weightRaw / 1000 : weightRaw;
  const status = String(pick(o, 'status', 'productStatus') ?? 'published');
  return {
    offerId: id,
    title: String(pick(o, 'title', 'subject', 'name') ?? '').trim(),
    url: pick(o, 'detail_url', 'detailUrl', 'url') || (id ? `https://detail.1688.com/offer/${id}.html` : ''),
    image: pick(o, 'pic_url', 'imageUrl', 'image', 'img', 'image.images.0', 'productImage.images.0') || '',
    price,
    priceRanges: ranges,
    moq: toNum(pick(o, 'min_num', 'minOrderQuantity', 'saleInfo.minOrderQuantity', 'beginAmount')) ?? ranges[0]?.startQuantity ?? null,
    amountOnSale: toNum(pick(o, 'amountOnSale', 'saleInfo.amountOnSale', 'num', 'quantity', 'stock')),
    sendGoodsAddress: addr ? String(addr) : '',
    unitWeight: weightKg,
    skuCount: toNum(o.skuCount) ?? (Array.isArray(skuList) ? skuList.length : typeof skuList === 'object' ? Object.keys(skuList).length : 0),
    status: /publish|在售|上架|online|1|true/i.test(status) ? 'published' : status,
    sales: toNum(pick(o, 'sales', 'saleQuantity', 'monthSold', 'bookedCount')),
    shop: String(pick(o, 'seller_nick', 'nick', 'companyName', 'supplierName', 'shop', 'sellerLoginId') ?? ''),
    source,
  };
}

// 第三方聚合（万邦格式）：GET {baseUrl}/{api}/?key=&secret=&...
const onebound = {
  async call(c, apiName, params) {
    const base = (c.options?.baseUrl || 'https://api-gw.onebound.cn/1688').replace(/\/+$/, '');
    const qs = new URLSearchParams({ key: c.creds.key, secret: c.creds.secret, ...params });
    const data = await request(`${base}/${apiName}/?${qs}`);
    if (data.error && data.error !== '' && data.error_code && String(data.error_code) !== '0000') throw err(`1688 接口：${data.error}`, 424);
    return data;
  },
  async keyword(c, q, { page = 1 } = {}) {
    const d = await this.call(c, 'item_search', { q, page, page_size: 40 });
    return (pick(d, 'items.item', 'items', 'data.items', 'result') || []).map((o) => normalizeOffer(o, '1688 关键词'));
  },
  async image(c, imgUrl) {
    const d = await this.call(c, 'item_search_img', { imgid: imgUrl });
    return (pick(d, 'items.item', 'items', 'data.items', 'result') || []).map((o) => normalizeOffer(o, '1688 以图搜'));
  },
  async detail(c, offerId) {
    const d = await this.call(c, 'item_get', { num_iid: offerId });
    return normalizeOffer(pick(d, 'item', 'data', 'result') || {}, '1688 详情');
  },
  async test(c) {
    const r = await this.keyword(c, '手机壳');
    return `连接成功，测试搜索返回 ${r.length} 个货源`;
  },
};

// 官方开放平台：https://gw.open.1688.com/openapi/param2/1/{namespace}/{api}/{appKey}，_aop_signature = HMAC-SHA1(urlPath + 排序后的参数)
const ali1688 = {
  async call(c, apiSpec, params) {
    const [ns, nameVer] = String(apiSpec).split(':');
    const [name, ver = '1'] = nameVer.split(/-(?=\d+$)/);
    const urlPath = `param2/${ver}/${ns}/${name}/${c.creds.appKey}`;
    const all = { ...params, access_token: c.creds.accessToken, _aop_timestamp: String(Date.now()) };
    const factor = urlPath + Object.keys(all).sort().map((k) => k + all[k]).join('');
    const sign = crypto.createHmac('sha1', c.creds.appSecret).update(factor).digest('hex').toUpperCase();
    const body = new URLSearchParams({ ...all, _aop_signature: sign });
    const data = await request(`https://gw.open.1688.com/openapi/${urlPath}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (data.error_code || data.errorCode) throw err(`1688 官方接口：${data.error_message || data.errorMessage || data.error_code || data.errorCode}`, 424);
    return data;
  },
  list(d) {
    return pick(d, 'result.result.data', 'result.data', 'result.result', 'result') || [];
  },
  async keyword(c, q) {
    const d = await this.call(c, c.options?.keywordApi || VENDORS.ali1688.options[0][2], { offerQueryParam: JSON.stringify({ keyword: q, beginPage: 1, pageSize: 40, country: 'en' }) });
    return [].concat(this.list(d)).map((o) => normalizeOffer(o, '1688 关键词'));
  },
  async image(c, imgUrl) {
    const d = await this.call(c, c.options?.imageApi || VENDORS.ali1688.options[1][2], { offerQueryParam: JSON.stringify({ imageAddress: imgUrl, beginPage: 1, pageSize: 40, country: 'en' }) });
    return [].concat(this.list(d)).map((o) => normalizeOffer(o, '1688 以图搜'));
  },
  async detail(c, offerId) {
    const d = await this.call(c, c.options?.detailApi || VENDORS.ali1688.options[2][2], { offerDetailParam: JSON.stringify({ offerId, country: 'en' }) });
    return normalizeOffer(pick(d, 'result.result', 'result') || {}, '1688 详情');
  },
  async test(c) {
    const r = await this.keyword(c, '手机壳');
    return `连接成功，测试搜索返回 ${r.length} 个货源`;
  },
};

// ---------- ERP 适配器：push(c, pack) ----------
const webhook = {
  async push(c, payload) {
    const body = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'TikTokOps/1.0' };
    if (c.creds.secret) headers['X-TK-Signature'] = 'sha256=' + crypto.createHmac('sha256', c.creds.secret).update(body).digest('hex');
    const r = await request(c.creds.url, { method: 'POST', headers, body });
    return { ok: true, message: r.message || r.msg || '已推送', remoteId: r.id || r.taskId || r.data?.id || null };
  },
  async test(c) {
    if (!/^https?:\/\//.test(c.creds.url || '')) throw err('请填写以 http(s):// 开头的接收地址');
    await this.push(c, { event: 'ping', at: new Date().toISOString() });
    return '连接成功，接收地址返回正常';
  },
};

// 妙手开放平台：AppKey + 时间戳 + HMAC-SHA256 签名（审核通过拿到文档后核对路径与字段）
const miaoshou = {
  async call(c, path, payload) {
    const base = (c.options?.baseUrl || VENDORS.miaoshou.options[0][2]).replace(/\/+$/, '');
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = crypto.createHmac('sha256', c.creds.appSecret).update(c.creds.appKey + timestamp + body).digest('hex');
    const data = await request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Key': c.creds.appKey, 'X-Timestamp': timestamp, 'X-Sign': sign }, body });
    if (data.code != null && ![0, 200, '0', '200'].includes(data.code)) throw err(`妙手接口：${data.msg || data.message || data.code}`, 424);
    return data;
  },
  // 先把 1688 货源链接采集进采集箱，再带上 AI 上架包发布到 TikTok 店铺
  async push(c, payload) {
    const collected = await this.call(c, c.options?.collectPath || '/open/v1/collect/url', { urls: [payload.source?.url].filter(Boolean), platform: '1688' });
    const draftId = collected.data?.id || collected.data?.ids?.[0] || collected.data?.[0]?.id;
    const published = await this.call(c, c.options?.publishPath || '/open/v1/product/publish', { draftId, platform: 'tiktok', shopId: c.options?.shopId || undefined, product: payload.listing });
    return { ok: true, message: '已提交到妙手 ERP', remoteId: published.data?.id || draftId || null };
  },
  async test(c) {
    await this.call(c, '/open/v1/ping', {});
    return '连接成功';
  },
};

// FastMoss：统一 POST + Bearer；业务码 0 才算成功
const FASTMOSS_ERRORS = { 1002: '密钥无效', 10001: '参数不对', 20001: '数据不存在', 30001: '没有这个接口的权限', 30002: '超出套餐的数据量限制', 30003: '请求太频繁', 40001: 'FastMoss 服务异常' };
const fastmoss = {
  async call(c, path, payload = {}) {
    const base = (c.options?.baseUrl || VENDORS.fastmoss.options[0][2]).replace(/\/+$/, '');
    const data = await request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.creds.apiKey}` }, body: JSON.stringify(payload) });
    if (data.code !== 0) throw Object.assign(err(`FastMoss 接口：${FASTMOSS_ERRORS[data.code] || data.message || data.msg || data.code}`, 424), { fmCode: data.code });
    return data.data;
  },
  async test(c) {
    const list = await this.call(c, '/product/v1/categoryInfo', { lang: 'ZH_CN' });
    return `连接成功，读到 ${(list || []).length} 个一级类目`;
  },
};

const ADAPTERS = { onebound1688: onebound, ali1688, webhook, miaoshou, fastmoss };
// 视频模型和看画面 / 语音转写的适配器在各自模块里注册，避免循环依赖
const register = (vendor, a) => (ADAPTERS[vendor] = a);

function adapter(c) {
  const a = ADAPTERS[c.vendor];
  if (!a) throw err(`「${c.name}」暂未开放接口，${VENDORS[c.vendor]?.kind === 'erp' ? '可以先用「通用 Webhook」' : '可以先用浏览器插件'}`);
  return a;
}

// 从上游拉模型列表（OpenAI 兼容的 GET /models）。没保存的表单也能拉：密钥留空时用已保存的
async function listModels({ id, vendor, apiKey, baseUrl }) {
  const c = id ? get(id) : null;
  const key = apiKey && !String(apiKey).includes('••') ? apiKey : c?.creds?.apiKey;
  const v = VENDORS[vendor || c?.vendor];
  if (!v) throw err('不支持的连接器类型');
  let base = String(baseUrl || c?.options?.baseUrl || '').trim().replace(/\/+$/, '');
  if (v.relay) base = relayBase(base);
  if (!/^https?:\/\//.test(base)) throw err(v.relay ? '先填接口地址' : '这个类型读不了模型列表，请手动添加；一般的中转站请在「添加模型」里选「中转站」');
  if (!key) throw err('先填 API Key');
  const d = await request(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } }, 20000);
  const list = (Array.isArray(d.data) ? d.data : Array.isArray(d.models) ? d.models : Array.isArray(d) ? d : []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  if (!list.length) throw err('上游没有返回模型列表：这个服务可能不提供 /models 接口，请手动添加');
  return [...new Set(list)].sort();
}

async function hubList({ id, apiKey, baseUrl, protocol, presetId }) {
  const llm = require('./providers/llm');
  const c = id ? get(id) : null;
  const key = apiKey && !String(apiKey).includes('••') ? apiKey : c?.creds?.apiKey || '';
  const base = relayBase(baseUrl || c?.options?.baseUrl || '');
  if (!/^https?:\/\//.test(base)) throw err('先填接口地址，例如 https://你的中转站域名（会自动补 /v1）');
  if (!key) throw err('先填 API Key');
  const proto = (protocol || c?.options?.protocol) === 'anthropic' ? 'anthropic' : 'openai';
  const r = await llm.listModels({ protocol: proto, baseUrl: base, apiKey: key, presetId: presetId || c?.options?.presetId });
  if (!r.models.length) throw err(r.error || '上游没有返回模型列表，请手动添加');
  let table = { prices: {}, types: {} };
  if (proto === 'openai') table = await readPricing(base).catch(() => table);
  const models = r.models.map((m) => ({ id: m.id, kind: classify(m.id, table.types[m.id] || []), ...(table.prices[m.id] || {}) }));
  return { models, baseUrl: base, error: r.source === 'preset' ? r.error : '', priced: Object.keys(table.prices).length };
}

// 读 new-api 中转站公开的价格表（/api/pricing，不需要密钥），换算成人民币单价
// 按秒、按次计费的直接读；按 token 计费的视频读站长写在说明里的「不带视频约 ¥x/秒」，读不到就留空让用户填
async function relayPricing(baseUrl) {
  return (await readPricing(baseUrl)).prices;
}
async function readPricing(baseUrl) {
  let origin;
  try {
    origin = new URL(String(baseUrl || '').trim()).origin;
  } catch {
    throw err('先填接口地址');
  }
  const [p, st] = await Promise.all([request(`${origin}/api/pricing`, {}, 20000), request(`${origin}/api/status`, {}, 20000).catch(() => ({}))]);
  if (!Array.isArray(p.data)) throw err('这个中转站没有公开价格表（不是 new-api 一类，或者关掉了价格页），请手动填单价');
  const status = st.data || {};
  // new-api 的价格以美元记；站长把显示币种设成人民币时，汇率填在 usd_exchange_rate
  const cny = String(status.quota_display_type || '').toUpperCase() === 'CNY';
  const rate = cny ? Number(status.usd_exchange_rate) || 1 : 7.2;
  const groups = p.group_ratio || {};
  const out = {};
  const types = {};
  for (const m of p.data) {
    if (Array.isArray(m.supported_endpoint_types)) types[m.model_name] = m.supported_endpoint_types.map(String);
    const g = (m.enable_groups || []).find((x) => x !== 'auto');
    const gr = Number(groups[g] ?? 1) || 1;
    const fixed = Number(m.model_price) > 0 && Number(m.quota_type) === 1;
    let price = '';
    let unit = '';
    if (fixed) {
      // 按清晰度分档的模型取 720p 档（批量出片默认 720p）
      const base = Number(m.resolution_prices?.["720p"]) || Number(m.model_price);
      price = Math.round(base * rate * gr * 10000) / 10000;
      unit = m.billing_unit === 'second' || m.billing_mode === 'per_second' ? '秒' : (m.supported_endpoint_types || []).some((t) => /video/.test(t)) ? '条' : '张';
    } else {
      const hit = String(m.description || '').match(/不带视频约\s*¥\s*([\d.]+)\s*\/\s*秒/) || String(m.description || '').match(/约\s*¥\s*([\d.]+)\s*\/\s*秒/);
      if (hit) { price = Number(hit[1]) * (cny ? 1 : 1); unit = '秒'; }
    }
    out[m.model_name] = { price, unit, note: price === '' ? '按 token 计费，没读到单价' : `中转站价格表${m.resolution_prices?.["720p"] ? '（720p 档）' : ''}${cny ? '' : '（按 $1≈¥7.2 折算）'}${gr !== 1 ? `，含分组倍率 ${gr}` : ''}` };
  }
  return { prices: out, types };
}

// 测试统一接入：文本模型发一句话，视频、图片等用各自不扣费的检查
const hub = {
  async test(h) {
    const llm = require('./providers/llm');
    const lines = [];
    let ok = 0;
    const text = textCfgs(h)[0];
    if (text) {
      try {
        const r = await llm.test(text);
        lines.push(`文本 ${text.model}：${r.text} · ${r.ms}ms`);
        ok++;
      } catch (e) {
        lines.push(`文本 ${text.model}：${e.message}`);
      }
    }
    for (const v of virtuals(h)) {
      const a = ADAPTERS[v.vendor];
      if (!a?.test || /^vision|^asr/.test(v.vendor)) continue; // 看图、语音的测试要真的发图发音频，用到时再检查
      const label = KINDS[v.id.split(':')[1]] || '';
      try {
        lines.push(`${label} ${v.options.model}：${await a.test(v)}`);
        ok++;
      } catch (e) {
        lines.push(`${label} ${v.options.model}：${e.message}`);
      }
    }
    if (!lines.length) throw err('还没有启用文本、图片或视频模型：点「模型开关」勾选要用的模型');
    if (!ok) throw err(lines.join('；'), 424);
    return lines.join('；');
  },
};
ADAPTERS.hub = hub;

async function test(id) {
  const c = get(id);
  if (!c) throw err('连接器不存在', 404);
  return { message: await adapter(c).test(c) };
}

module.exports = { VENDORS, KINDS, catalog, list, publicList, save, remove, get, active, adapter, register, request, test, normalizeOffer, modelsOf, withModel, listModels, relayPricing, UNITS, relayBase, classify, virtuals, textCfgs, textPool, mediaPool, markFail, markOk, autoFallback, setPrefs, setModels, migrate, hubList };
