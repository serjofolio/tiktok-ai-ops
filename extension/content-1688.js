// 1688 页面：识别货源（搜索结果 / 以图搜结果 / 商品详情），发送到运营台；执行插件派来的自动找货任务
(() => {
  if (window.__tkOps) return;
  window.__tkOps = true;

  const bg = (msg) => new Promise((resolve, reject) => chrome.runtime.sendMessage(msg, (r) => (r?.ok ? resolve(r.data) : reject(new Error(r?.error || '插件未连接运营台')))));
  const api = (path, opts = {}) => bg({ type: 'api', path, ...opts });
  // 操作节奏倍数：正常为 1（像人一样慢慢来，避免触发 1688 风控）；自动化测试里调小
  let pace = 1;
  const ready = chrome.storage.local.get({ pace: 1 }).then((v) => (pace = Number(v.pace) || 1)).catch(() => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * pace));
  const jitter = (a, b) => sleep(a + Math.random() * (b - a));
  const num = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  const text = (el) => (el?.innerText ?? el?.textContent ?? '').trim();
  const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const abs = (u) => (!u ? '' : u.startsWith('//') ? 'https:' + u : u);
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // ---------- 发货地：「广东 深圳」「广东省深圳市」取省 + 市；只有城市（店名里的「深圳市龙华区…」）时补上省 ----------
  const PROVINCES = /(广东|浙江|福建|江苏|上海|山东|河北|河南|湖北|湖南|安徽|江西|广西|四川|重庆|北京|天津|辽宁|吉林|黑龙江|山西|陕西|云南|贵州|海南|甘肃|宁夏|青海|新疆|西藏|内蒙古)(省|市|自治区)?\s?[一-龥]{0,4}/;
  const CITY = { 深圳: '广东', 广州: '广东', 东莞: '广东', 佛山: '广东', 汕头: '广东', 揭阳: '广东', 中山: '广东', 惠州: '广东', 潮州: '广东', 江门: '广东', 珠海: '广东', 义乌: '浙江', 金华: '浙江', 杭州: '浙江', 宁波: '浙江', 温州: '浙江', 台州: '浙江', 绍兴: '浙江', 嘉兴: '浙江', 湖州: '浙江', 永康: '浙江', 泉州: '福建', 厦门: '福建', 莆田: '福建', 晋江: '福建', 石狮: '福建', 福州: '福建', 苏州: '江苏', 南通: '江苏', 常州: '江苏', 无锡: '江苏', 扬州: '江苏', 临沂: '山东', 青岛: '山东', 潍坊: '山东', 保定: '河北', 石家庄: '河北', 郑州: '河南', 武汉: '湖北', 长沙: '湖南', 成都: '四川', 合肥: '安徽', 南昌: '江西' };
  const CITY_RE = new RegExp(`(${Object.keys(CITY).join('|')})`);
  function place(...texts) {
    for (const t of texts) {
      const p = t && t.match(PROVINCES);
      if (p) return p[0].trim();
    }
    for (const t of texts) {
      const c = t && t.match(CITY_RE);
      if (c) return `${CITY[c[1]]} ${c[1]}`;
    }
    return '';
  }

  // ---------- 搜索结果 / 以图搜结果：不依赖固定的类名 ----------
  // 1. 找出页面上所有带商品 ID 的元素（详情链接、data-offerid、埋点属性里的 offerId）
  // 2. 每个 ID 往上找「只包含这一个商品」的最大容器，就是这个商品的卡片
  // 3. 在卡片里找标题、价格、主图、销量、起批量、店铺、发货地
  const idFromUrl = (h) => (String(h).match(/offer\/(\d{8,14})\.html/) || String(h).match(/[?&](?:offerId|offer_id|offerid)=(\d{8,14})/i) || [])[1] || null;
  const ATTR_ID = /offer[_-]?id["'\s]*[:=@]\s*["']?(\d{8,14})/i;
  function idOf(el) {
    if (el.tagName === 'A') {
      const id = idFromUrl(el.getAttribute('href') || '');
      if (id) return id;
    }
    for (const a of el.attributes) {
      const v = a.value;
      if (/^(data-)?offer-?id$/i.test(a.name) && /^\d{8,14}$/.test(v)) return v;
      if (v.length < 3000 && /offer/i.test(v)) {
        const m = v.match(ATTR_ID) || (a.name !== 'href' && v.match(/offer\/(\d{8,14})\.html/));
        if (m) return m[1];
      }
    }
    return null;
  }
  function findCards() {
    const hits = [];
    for (const el of [...document.body.getElementsByTagName('*')]) {
      const id = idOf(el);
      if (id) hits.push([el, id]);
    }
    const sets = new Map();
    for (const [el, id] of hits) {
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        let s = sets.get(p);
        if (!s) sets.set(p, (s = new Set()));
        s.add(id);
      }
    }
    const cards = new Map();
    for (const [el, id] of hits) {
      let card = el;
      for (let p = el.parentElement; p && p !== document.body && sets.get(p).size === 1 && p.textContent.length < 4000; p = p.parentElement) card = p;
      const list = cards.get(id) || [];
      if (!list.includes(card)) list.push(card);
      cards.set(id, list);
    }
    return cards;
  }

  const BADGE = /^(新品|人气新品|新款|跨境|严选|源头工厂|源头厂家|实力商家|超级工厂|深度验厂|官方旗舰|热销|爆款|厂家直销|包邮|一件代发)\s*/;
  const SHOP_LINE = /(公司|商行|厂|店|经营部|贸易|工作室|批发部|商贸|实业|制品)$/;
  function cardTitle(card) {
    const attrs = [card, ...card.querySelectorAll('[title]')].map((e) => (e.getAttribute('title') || '').trim()).filter((t) => t.length >= 6 && t.length <= 200 && !/^[¥￥\d]/.test(t));
    if (attrs.length) return attrs.sort((a, b) => b.length - a.length)[0];
    for (const el of card.querySelectorAll('[class*="title" i], [class*="subject" i], h2, h3, h4')) {
      const t = lines(text(el)).map((s) => s.replace(BADGE, '')).find((s) => s.length >= 4 && !/^[¥￥]/.test(s));
      if (t) return t;
    }
    const alt = [...card.querySelectorAll('img[alt]')].map((i) => i.alt.trim()).find((t) => t.length >= 6 && !/^(商品|图片|主图)/.test(t));
    if (alt) return alt;
    return lines(text(card)).map((s) => s.replace(BADGE, '')).filter((s) => s.length >= 6 && s.length <= 150 && !/[¥￥]/.test(s) && !SHOP_LINE.test(s)).sort((a, b) => b.length - a.length)[0] || '';
  }
  function cardPrice(card) {
    // 价格常被拆成「¥」「3」「.8」几段，去掉空白再取
    for (const el of card.querySelectorAll('[class*="price" i]')) {
      const t = text(el).replace(/\s+/g, '');
      const m = t.match(/[¥￥](\d+(?:\.\d+)?)/) || t.match(/^(\d+(?:\.\d+)?)(?![\d.件个人%])/);
      if (m) return Number(m[1]);
    }
    const m = text(card).replace(/[¥￥]\s+/g, '¥').match(/[¥￥](\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  }
  function cardImage(card) {
    // 卡片里最大的那张图就是主图（懒加载的图片地址在 data-src 等属性里）
    let best = '', area = -1;
    for (const img of card.querySelectorAll('img')) {
      const src = ['data-src', 'data-lazy-src', 'data-original', 'data-lazyload', 'src'].map((k) => img.getAttribute(k)).find((s) => s && /^(https?:)?\/\//.test(s));
      if (!src || /\.(gif|svg)(\?|$)/i.test(src)) continue;
      const r = img.getBoundingClientRect();
      if (r.width * r.height > area) (area = r.width * r.height), (best = src);
    }
    if (!best) best = [...card.querySelectorAll('[style*="background-image"]')].map((e) => (e.getAttribute('style').match(/url\(["']?([^"')]+)/) || [])[1]).find(Boolean) || '';
    return abs(best);
  }
  function cardSales(t) {
    const m = t.match(/(?:成交|已售|销量|月销|年销|售出)\s*(\d+(?:\.\d+)?)\s*(万)?\s*\+?\s*(?:件|笔|个|单|套|双)?/) || t.match(/(\d+(?:\.\d+)?)\s*(万)?\+\s*(?:件|笔|个|单|套|双)(?!起)/);
    return m ? Math.round(Number(m[1]) * (m[2] ? 1e4 : 1)) : null;
  }
  const MOQ = /(\d+)\s*(?:件|个|套|只|双|箱|包|条|台|米|千克|kg)\s*起(?:批|订|购|售|卖)?/i;
  function cardShop(card) {
    for (const el of card.querySelectorAll('[class*="shop" i], [class*="company" i], [class*="supplier" i], [class*="seller" i], [class*="store" i]')) {
      const t = lines(text(el)).find((s) => s.length >= 2 && s.length <= 40 && !/^[¥￥\d]/.test(s) && !/(进店|旺旺|关注|收藏|联系)/.test(s));
      if (t) return t;
    }
    return lines(text(card)).find((s) => s.length <= 40 && SHOP_LINE.test(s)) || '';
  }
  const LOC_SEL = '[class*="location" i], [class*="address" i], [class*="province" i], [class*="city" i]';

  // 页面脚本里的结构化数据（有的版本卡片上没有链接，商品信息只在数据里）
  function matchEnd(s, i) {
    let depth = 0, q = false;
    for (let k = i; k < s.length && k - i < 5e6; k++) {
      const c = s[k];
      if (q) { if (c === '\\') k++; else if (c === '"') q = false; continue; }
      if (c === '"') q = true;
      else if (c === '{' || c === '[') depth++;
      else if ((c === '}' || c === ']') && --depth === 0) return k;
    }
    return -1;
  }
  function jsonBlobs(src) {
    const out = [];
    const re = /=\s*(?=[{[])/g;
    let m, n = 0;
    while ((m = re.exec(src)) && n++ < 12) {
      const start = re.lastIndex, end = matchEnd(src, start);
      if (end < 0) break;
      try { out.push(JSON.parse(src.slice(start, end + 1))); } catch {}
      re.lastIndex = end;
    }
    return out;
  }
  function findKey(obj, test, depth = 2) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const k of Object.keys(obj)) {
      const x = obj[k];
      if ((typeof x === 'string' || typeof x === 'number') && test(k, String(x))) return String(x);
    }
    if (depth > 0) for (const x of Object.values(obj)) {
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        const r = findKey(x, test, depth - 1);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  }
  function fromData(v, id) {
    const o = { num_iid: id, detail_url: `https://detail.1688.com/offer/${id}.html` };
    o.title = (findKey(v, (k, x) => /^(title|subject|offerTitle|simpleSubject)$/i.test(k) && x.length >= 4) || '').replace(/<[^>]+>/g, '').trim();
    o.price = num(findKey(v, (k, x) => /price/i.test(k) && !/(unit|currency|type)/i.test(k) && /\d/.test(x)));
    o.pic_url = abs(findKey(v, (k, x) => /(img|image|pic)/i.test(k) && /^(https?:)?\/\//.test(x)) || '');
    const shop = findKey(v, (k, x) => /(company|shopName|sellerName|supplierName|memberName|nick)/i.test(k) && x.length >= 2 && x.length <= 40);
    if (shop) o.nick = shop;
    const loc = `${findKey(v, (k) => /^province$/i.test(k)) || ''} ${findKey(v, (k) => /^city$/i.test(k)) || ''}`.trim();
    if (loc) o.location = loc;
    const sales = num(findKey(v, (k, x) => /(saleQuantity|sold|bookedCount|salesCount)/i.test(k) && /\d/.test(x)));
    if (sales != null) o.sales = sales;
    const moq = num(findKey(v, (k, x) => /(beginAmount|minOrder|quantityBegin)/i.test(k) && /\d/.test(x)));
    if (moq != null) o.min_num = moq;
    return o;
  }
  const filled = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== '' && x != null));
  function walkOffers(v, found, depth = 0) {
    if (!v || typeof v !== 'object' || depth > 14) return;
    if (Array.isArray(v)) return v.forEach((x) => walkOffers(x, found, depth + 1));
    const id = v.offerId ?? v.offer_id ?? v.offerid;
    if (id != null && /^\d{8,14}$/.test(String(id))) {
      const o = fromData(v, String(id));
      if (o.title || o.price != null) found.set(o.num_iid, { ...filled(o), ...filled(found.get(o.num_iid) || {}) });
    }
    for (const k in v) if (v[k] && typeof v[k] === 'object') walkOffers(v[k], found, depth + 1);
  }
  function scriptOffers() {
    const found = new Map();
    for (const s of document.querySelectorAll('script:not([src])')) {
      const t = s.textContent;
      if (t.length < 100 || !/offer_?id/i.test(t)) continue;
      const blobs = /json/i.test(s.type) ? [(() => { try { return JSON.parse(t); } catch { return null; } })()] : jsonBlobs(t);
      for (const b of blobs) walkOffers(b, found);
    }
    return found;
  }

  function listOffers() {
    const out = new Map();
    for (const [id, cards] of findCards()) {
      for (const card of cards) {
        const price = cardPrice(card);
        const title = price == null ? '' : cardTitle(card);
        if (!title) continue;
        const rest = text(card).replace(title, ' ');
        const o = { num_iid: id, detail_url: `https://detail.1688.com/offer/${id}.html`, title: title.slice(0, 150), price, pic_url: cardImage(card) };
        const sales = cardSales(rest);
        if (sales != null) o.sales = sales;
        const moq = rest.match(MOQ);
        if (moq) o.min_num = Number(moq[1]);
        const shop = cardShop(card);
        if (shop) o.nick = shop;
        const loc = place(text(card.querySelector(LOC_SEL)), rest);
        if (loc) o.location = loc;
        out.set(id, o);
        break;
      }
    }
    // 结构化数据：补全卡片上没显示的字段；卡片识别得太少时，直接用数据里的商品
    for (const [id, d] of scriptOffers()) {
      if (out.has(id)) out.set(id, { ...filled(d), ...filled(out.get(id)) });
      else if (out.size < 5 && d.title && d.price != null) out.set(id, d);
    }
    return [...out.values()].slice(0, 60);
  }

  // ---------- 商品详情页：一个货源 ----------
  function fromScripts() {
    const html = document.documentElement.innerHTML;
    const grab = (re) => (html.match(re) || [])[1];
    const out = {};
    const w = grab(/"(?:unitWeight|pieceWeight|singleWeight)"\s*:\s*"?([\d.]+)/);
    if (w) out.unitWeight = Number(w);
    const addr = grab(/"(?:sendGoodsAddressText|sendGoodsAddress|deliveryLocation|deliveryAddress)"\s*:\s*"([^"]{2,40})"/);
    if (addr) out.sendGoodsAddress = addr;
    const stock = grab(/"(?:amountOnSale|canBookCount)"\s*:\s*"?(\d+)/);
    if (stock) out.amountOnSale = Number(stock);
    const ranges = grab(/"(?:priceRanges|priceRangeList|currentPrices)"\s*:\s*(\[[^\]]*\])/) || grab(/"priceRange"\s*:\s*(\[\[[^\]]*\](?:\s*,\s*\[[^\]]*\])*\])/);
    if (ranges) try { out.priceRanges = JSON.parse(ranges); } catch {}
    const skus = new Set([...html.matchAll(/"skuId"\s*:\s*"?(\d+)/g)].map((m) => m[1]));
    if (skus.size) out.skuCount = skus.size;
    return out;
  }
  function detailOffer() {
    const id = (location.href.match(/offer\/(\d+)\.html/) || [])[1];
    if (!id) return [];
    const title = (document.querySelector('h1, .title-text, [class*="title-content"], [class*="offer-title" i]')?.textContent || document.title.replace(/-.*$/, '')).trim();
    const priceEl = [...document.querySelectorAll('[class*="price"]')].map((e) => e.textContent).find((t) => /[¥￥]?\s*\d/.test(t));
    const img = document.querySelector('img[class*="detail-gallery"], .detail-gallery img, [class*="main-image"] img, img[src*="cbu01.alicdn.com"]');
    const shop = document.querySelector('[class*="company-name"], [class*="shop-name"], [class*="companyName"]')?.textContent?.trim() || '';
    return [{ num_iid: id, detail_url: `https://detail.1688.com/offer/${id}.html`, title, price: num(priceEl), pic_url: img?.src || '', nick: shop, location: place(document.body.innerText), ...fromScripts() }];
  }

  const isDetail = () => /detail\.1688\.com\/offer\//.test(location.href);
  const scrape = () => (isDetail() ? detailOffer() : listOffers());
  // 1688 滑块验证 / 跳登录（只算看得见的验证框，页面里预埋的隐藏容器不算）
  const CAPTCHA_SEL = '#nc_1_wrapper, .nc-container, .nc_wrapper, #nocaptcha, [id^="baxia"], [class*="baxia-dialog"], .J_MIDDLEWARE_FRAME_WIDGET, iframe[src*="punish"], iframe[src*="_____tmd_____"]';
  const captcha = () => /_____tmd_____|\/punish|login\.(1688|taobao)\.com/.test(location.href) || [...document.querySelectorAll(CAPTCHA_SEL)].some(visible);

  // 识别失败时把页面结构（去掉脚本、样式、图片）发到你自己的运营台，用来调整识别规则
  async function report(reason) {
    try {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script, style, link, noscript, iframe, svg, canvas, video, audio, .tkops-root').forEach((e) => e.remove());
      clone.querySelectorAll('input').forEach((e) => e.removeAttribute('value'));
      const html = clone.innerHTML.replace(/\s{2,}/g, ' ').slice(0, 900000);
      const scripts = [...document.querySelectorAll('script:not([src])')].map((s) => s.textContent).filter((t) => /offer_?id/i.test(t)).slice(0, 3).map((t) => t.slice(0, 200000));
      await api('/ext/debug', { method: 'POST', body: { reason, url: location.href, title: document.title, html, scripts, ua: navigator.userAgent, version: chrome.runtime.getManifest().version } });
      return true;
    } catch {
      return false;
    }
  }

  // ---------- 浮动面板 ----------
  const root = document.createElement('div');
  root.className = 'tkops-root';
  root.innerHTML = `<button class="tkops-fab" title="TikTok 运营台助手">运营台找货</button>
    <div class="tkops-panel" hidden><div class="tkops-head"><b>TikTok 运营台助手</b><button class="tkops-x">×</button></div>
      <div class="tkops-body"><label>给哪个商品找货<select class="tkops-sel"><option>加载中…</option></select></label>
      <div class="tkops-auto"><b>自动找货</b><input class="tkops-kw" placeholder="1688 搜索词（留空由 AI 提炼）">
        <div class="tkops-row"><button class="tkops-go" data-mode="keyword">关键词搜</button><button class="tkops-go" data-mode="image">以图搜</button><button class="tkops-go" data-mode="both">两种都搜</button></div>
        <label class="tkops-chk"><input type="checkbox" class="tkops-dn" checked>自动打开前 3 个详情页补数据</label></div>
      <div class="tkops-status" hidden></div>
      <div class="tkops-manual"><b>手动发送本页</b><div class="tkops-found"></div><button class="tkops-send">发送本页货源</button><a class="tkops-report" href="#">识别不准？上报本页结构</a></div><div class="tkops-msg"></div></div></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  let items = [];
  const status = (msg, done) => {
    const el = $('.tkops-status');
    el.hidden = false;
    el.className = 'tkops-status' + (done ? ' done' : '');
    el.textContent = msg;
  };

  async function loadProducts() {
    try {
      ({ items } = await api('/ext/products'));
      $('.tkops-sel').innerHTML = items.length
        ? items.map((p) => `<option value="${p.id}">【${p.verdict}】${p.name.slice(0, 40).replace(/</g, '&lt;')}${p.ceilingCny != null ? `（成本上限 ¥${p.ceilingCny}）` : ''}${p.offers ? ` · 已有 ${p.offers} 个货源` : ''}</option>`).join('')
        : '<option value="">选品库里还没有「可以上 / 谨慎测试」的商品</option>';
      const last = sessionStorage.getItem('tkops-pid');
      if (last && items.some((p) => p.id === last)) $('.tkops-sel').value = last;
      syncKw();
    } catch (e) {
      $('.tkops-msg').textContent = e.message;
    }
  }
  const syncKw = () => ($('.tkops-kw').value = items.find((p) => p.id === $('.tkops-sel').value)?.kw || '');

  async function open() {
    $('.tkops-panel').hidden = false;
    const n = scrape().length;
    $('.tkops-found').textContent = n ? `本页识别到 ${n} 个货源` : '本页没有识别到货源（在搜索结果、以图搜结果或商品详情页可用）';
    if (!items.length) await loadProducts();
  }

  $('.tkops-fab').onclick = open;
  $('.tkops-x').onclick = () => ($('.tkops-panel').hidden = true);
  $('.tkops-sel').onchange = syncKw;
  for (const b of root.querySelectorAll('.tkops-go')) {
    b.onclick = async () => {
      const productId = $('.tkops-sel').value;
      if (!productId) return;
      sessionStorage.setItem('tkops-pid', productId);
      $('.tkops-msg').textContent = '正在打开 1688…';
      try {
        await bg({ type: 'hunt', productId, mode: b.dataset.mode, kw: $('.tkops-kw').value, detailN: $('.tkops-dn').checked ? 3 : 0 });
        $('.tkops-msg').textContent = '已在新标签页开始自动找货';
      } catch (e) {
        $('.tkops-msg').textContent = e.message;
      }
    };
  }
  $('.tkops-send').onclick = async () => {
    const productId = $('.tkops-sel').value;
    if (!productId) return;
    const offers = scrape();
    if (!offers.length) {
      $('.tkops-msg').textContent = '没有可发送的货源';
      report('manual-empty');
      return;
    }
    $('.tkops-msg').textContent = '发送中…';
    try {
      sessionStorage.setItem('tkops-pid', productId);
      const r = await api('/ext/offers', { method: 'POST', body: { productId, offers, pageUrl: location.href } });
      $('.tkops-msg').textContent = `已发送，这个商品现在有 ${r.count} 个货源（运营台会自动打分和判断同款）`;
    } catch (e) {
      $('.tkops-msg').textContent = e.message;
    }
  };
  $('.tkops-report').onclick = async (e) => {
    e.preventDefault();
    $('.tkops-msg').textContent = '上报中…';
    $('.tkops-msg').textContent = (await report('manual')) ? '已上报到你的运营台，告诉开发者「已上报」即可' : '上报失败：插件没有连上运营台';
  };
  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === 'progress') status(m.text, m.done);
  });

  // ---------- 自动找货 ----------
  // 遇到 1688 验证就停下等你处理（最多 3 分钟），并让插件接下来一段时间不再自动打开详情页
  async function passCaptcha() {
    if (!captcha()) return;
    bg({ type: 'captcha' }).catch(() => {});
    for (let i = 0; captcha() && i < 90; i++) {
      status('1688 弹出了验证，请手动完成（拖动滑块 / 登录），完成后自动继续…');
      await sleep(2000);
    }
    if (captcha()) throw new Error('1688 验证没有完成，自动找货已停止');
  }

  // 像人一样慢慢往下翻几屏，让懒加载的商品出来
  async function browse(screens) {
    for (let i = 0; i < screens; i++) {
      window.scrollBy({ top: Math.round(innerHeight * (0.6 + Math.random() * 0.5)), behavior: 'smooth' });
      await jitter(900, 1900);
    }
  }

  // 模拟一次完整的鼠标点击（按下 → 抬起 → 点击）
  function press(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.left + r.width * (0.35 + Math.random() * 0.3), clientY: r.top + r.height * (0.35 + Math.random() * 0.3) };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  }

  const fileInput = () => [...document.querySelectorAll('input[type=file]')].find((i) => !i.accept || /image|jpe?g|png/i.test(i.accept));
  // 以图搜弹出框里的「搜索」：从「已上传」提示 / 预览图 / 上传框往上找，最先遇到的那个（不是顶部关键词搜索的按钮）
  const SEARCH_BTN = /^(搜索|开始搜索|立即搜索|搜索图片)$/;
  const btnText = (el) => (el.value || el.textContent || '').replace(/\s+/g, '');
  function imageSearchButton(input) {
    const cands = [...document.querySelectorAll('button, a, [role="button"], div, span, input[type="button"], input[type="submit"]')]
      .filter((el) => !root.contains(el) && SEARCH_BTN.test(btnText(el)) && visible(el) && ![...el.children].some((c) => SEARCH_BTN.test(btnText(c))));
    if (!cands.length) return null;
    const marks = [
      ...[...document.querySelectorAll('div, span, p, em, i')].filter((e) => !root.contains(e) && /已上传/.test(e.textContent) && e.textContent.length < 40 && visible(e)),
      ...[...document.querySelectorAll('img')].filter((i) => /^(blob|data):/.test(i.src) && visible(i)),
      input,
    ];
    for (const m of marks) {
      for (let p = m.parentElement, d = 0; p && p !== document.body && d < 8; p = p.parentElement, d++) {
        const inside = cands.filter((c) => p.contains(c));
        if (inside.length) return inside[inside.length - 1];
      }
    }
    return null;
  }

  async function upload(task) {
    status(`以图搜：正在把「${task.name.slice(0, 30)}」的主图传到 1688…`);
    await jitter(1500, 3000);
    await passCaptcha();
    const { b64, type } = await bg({ type: 'image', url: task.image });
    const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'product.jpg', { type });
    let input = fileInput();
    // 上传框通常藏在搜索栏的相机图标后面：点一下让它出现
    for (const el of document.querySelectorAll('[class*="camera"], [class*="Camera"], [class*="image-search"], [class*="imageSearch"], [class*="img-search"], [class*="imgSearch"], [title*="图片搜索"], [title*="以图"]')) {
      if (input) break;
      press(el);
      await jitter(400, 800);
      input = fileInput();
    }
    for (let i = 0; !input && i < 16; i++) await sleep(500), (input = fileInput());
    if (!input) {
      report('no-upload-input');
      // 兜底：主图放进剪贴板，你在搜索框粘贴
      try {
        const bmp = await createImageBitmap(file);
        const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        c.getContext('2d').drawImage(bmp, 0, 0);
        const png = await new Promise((r) => c.toBlob(r, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      } catch {
        throw new Error('没找到 1688 的图片上传框，请点搜索框旁的相机图标手动上传商品主图，结果出来后点「发送本页货源」');
      }
      await bg({ type: 'update', patch: { stage: 'collect', uploadedAt: Date.now() } });
      status('没找到 1688 的图片上传框。商品主图已复制到剪贴板：点搜索框旁的相机图标，按 Ctrl+V 粘贴并搜索，结果出来后插件自动采集');
      return collect(task, 180);
    }
    await bg({ type: 'update', patch: { stage: 'collect', uploadedAt: Date.now() } });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    status('以图搜：主图已上传，正在点「搜索」…');
    // 等预览图出来、「搜索」按钮可以点
    let btn = null;
    for (let i = 0; !btn && i < 20; i++) await sleep(500), (btn = imageSearchButton(input));
    if (!btn) {
      report('no-search-button');
      status('主图已上传，但没找到「搜索」按钮：请点 1688 弹出框里的「搜索」，结果出来后插件自动采集');
      return collect(task, 180);
    }
    await jitter(800, 1600);
    document.dispatchEvent(new CustomEvent('tkops:same-tab')); // 结果在当前标签打开，避免新窗口被浏览器拦截
    press(btn);
    status('以图搜：已点「搜索」，等待 1688 返回结果…');
    return collect(task);
  }

  // 还停在 1688 首页 = 以图搜的结果还没出来（首页推荐的商品不能当成结果采集）
  const onHome = () => location.hostname === 'www.1688.com' && /^\/(index\.html?)?$/.test(location.pathname);
  async function collect(task, homeWait = 45) {
    status(`${task.mode === 'image' ? '以图搜' : `关键词「${task.kw}」`}：等待 1688 搜索结果…`);
    let found = [];
    for (let i = 0, h = 0; i < 30; i++) {
      await passCaptcha();
      if (task.mode === 'image' && onHome()) {
        if (++h > homeWait) break;
        if (h > 3 && !(await bg({ type: 'task' }).catch(() => null))) return status('以图搜结果已在新标签页打开，插件在那边继续采集', true);
        i--;
        await sleep(1000);
        continue;
      }
      found = listOffers();
      if (found.length >= 8 || (found.length && i >= 6)) break;
      await sleep(1000);
    }
    if (!found.length) {
      if (task.mode === 'image' && onHome()) throw new Error('1688 没有打开以图搜结果。结果出来后点「运营台找货 → 发送本页货源」');
      const sent = await report('no-offers');
      throw new Error(`这个页面没有识别到货源${sent ? '，页面结构已上报到你的运营台，用来调整识别规则' : ''}。也可以点「发送本页货源」再试一次`);
    }
    await browse(3 + Math.floor(Math.random() * 2));
    found = listOffers();
    status(`识别到 ${found.length} 个货源，正在发送到运营台（AI 判断同款）…`);
    const r = await api('/ext/offers', { method: 'POST', body: { productId: task.productId, offers: found, pageUrl: location.href } });
    await bg({ type: 'done' });
    const urls = r.top.slice(0, task.detailN || 0);
    if (!urls.length) return status(`完成：发送了 ${found.length} 个货源，这个商品现在共 ${r.count} 个。回到运营台「1688 找货」看比价结果。`, true);
    status(`已发送 ${found.length} 个货源；接下来每隔十几秒在后台打开 1 个排名靠前的详情页补数据（共 ${urls.length} 个）…`);
    await bg({ type: 'details', productId: task.productId, urls });
  }

  async function detail(task) {
    for (let i = 0; i < 30 && !document.querySelector('h1, .title-text, [class*="title-content"], [class*="offer-title" i]') && !captcha(); i++) await sleep(500);
    if (captcha()) {
      bg({ type: 'captcha' }).catch(() => {});
      return bg({ type: 'detailDone', ok: false, captcha: true });
    }
    await jitter(1500, 3000);
    await browse(1 + Math.floor(Math.random() * 2));
    try {
      await api('/ext/offers', { method: 'POST', body: { productId: task.productId, offers: detailOffer(), pageUrl: location.href } });
      await bg({ type: 'detailDone', ok: true });
    } catch (e) {
      await bg({ type: 'detailDone', ok: false, error: e.message });
    }
  }

  const IMG_RESULT = /youyuan|imageSearch|image_search|pailitao|imageId|imageAddress/i;
  async function run() {
    await ready;
    // 运营台网页上的「插件自动搜」链接：#tkops=商品ID&mode=keyword|image
    const h = new URLSearchParams(location.hash.slice(1));
    let task = null;
    if (h.get('tkops')) {
      history.replaceState(null, '', location.href.replace(/#.*$/, ''));
      try {
        task = await bg({ type: 'adopt', productId: h.get('tkops'), mode: h.get('mode') === 'image' ? 'image' : 'keyword', kw: new URLSearchParams(location.search).get('keywords') || '', detailN: h.get('d') ?? 3 });
      } catch (e) {
        $('.tkops-panel').hidden = false;
        return ($('.tkops-msg').textContent = e.message);
      }
    }
    for (let i = 0; !task && i < 3; i++) {
      task = await bg({ type: 'task' }).catch(() => null);
      if (!task) await sleep(700);
    }
    // 以图搜结果在新标签打开、任务没跟过来：认领刚上传过主图的那个任务
    if (!task && IMG_RESULT.test(location.href)) task = await bg({ type: 'claim' }).catch(() => null);
    if (!task) return;
    if (task.stage === 'detail') return detail(task);
    $('.tkops-panel').hidden = false;
    $('.tkops-manual').hidden = true;
    loadProducts().then(() => {
      if (items.some((p) => p.id === task.productId)) ($('.tkops-sel').value = task.productId), syncKw();
    });
    try {
      if (task.stage === 'upload') await upload(task);
      else await collect(task);
    } catch (e) {
      status(e.message, true);
      bg({ type: 'done' }).catch(() => {});
    } finally {
      $('.tkops-manual').hidden = false;
    }
  }
  run();
})();
