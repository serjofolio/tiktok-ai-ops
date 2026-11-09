// 商品中文短名：TikTok 的商品标题又长又是外语，页面上同时显示「中文短名 + 原标题」
// 选品库里有没翻译的商品时在后台分批翻译，每批 40 个；没接大模型就不翻，页面照常显示原标题
const db = require('../db');
const ctx = require('../ctx');
const llm = require('../providers/llm');

const BATCH = 40;
const running = new Set(); // 按账号，同一个账号同时只跑一个

const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

async function translate(items) {
  const prompt = `把下面这些 TikTok Shop 商品标题翻译成简短的中文商品名，每个 6–16 个字：
- 保留品类、材质、关键卖点和规格（例如「S925 银莫桑石耳钉套装」「14K 镀金锆石网球项链」）
- 去掉店铺名、营销词、表情、型号堆砌和重复的适配机型
- 原标题已经是中文的，缩短即可

${items.map((p) => `${p.id}: ${clean(p.name).slice(0, 220)}`).join('\n')}

只输出 JSON：{"names":{"商品ID":"中文名"}}`;
  const r = await llm.completeJSON(prompt, { system: '你是跨境电商运营，负责把外文商品标题翻译成简洁准确的中文名。只输出 JSON。', temperature: 0.2, maxTokens: 4000, timeoutMs: 120000, noThinking: true });
  return r.names && typeof r.names === 'object' ? r.names : {};
}

async function fill() {
  for (let round = 0; round < 50; round++) {
    const todo = db.products.all().filter((p) => !p.nameZh && !p.nameZhFailed && p.name).slice(0, BATCH);
    if (!todo.length) return;
    let names;
    try {
      names = await translate(todo);
    } catch (e) {
      console.error('[zhnames]', e.message);
      return; // 模型出错就停，下次打开选品库再试
    }
    for (const p of todo) {
      const zh = clean(names[p.id]).slice(0, 40);
      // 模型漏了的标记一下，避免一直重试同一个
      db.products.update(p.id, zh ? { nameZh: zh } : { nameZhFailed: true });
    }
  }
}

// 打开选品库、导入之后调用：有没翻译的就在后台翻，不阻塞页面
function kick() {
  const uid = ctx.user()?.id;
  if (!uid || running.has(uid) || llm.isMock()) return false;
  if (!db.products.all().some((p) => !p.nameZh && !p.nameZhFailed && p.name)) return false;
  running.add(uid);
  fill().finally(() => running.delete(uid));
  return true;
}

module.exports = { kick, translate };
