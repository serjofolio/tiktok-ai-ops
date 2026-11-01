// 1688 页面：识别货源（搜索结果 / 以图搜结果 / 商品详情），一键发送到运营台的某个商品
(() => {
  if (window.__tkOps) return;
  window.__tkOps = true;

  const bg = (msg) => new Promise((resolve, reject) => chrome.runtime.sendMessage(msg, (r) => (r?.ok ? resolve(r.data) : reject(new Error(r?.error || '插件未连接运营台')))));
  const api = (path, opts = {}) => bg({ type: 'api', path, ...opts });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  // 「广东 深圳」「广东省深圳市」都能取到省 + 市
  const PROVINCES = /(广东|浙江|福建|江苏|上海|山东|河北|河南|湖北|湖南|安徽|江西|广西|四川|重庆|北京|天津|辽宁|吉林|黑龙江|山西|陕西|云南|贵州|海南|甘肃|宁夏|青海|新疆|西藏|内蒙古)(省|市|自治区)?\s?[一-龥]{0,4}/;

  // 页面源码里的结构化数据（1688 详情页把商品数据放在脚本里；字段名可能变化，取不到就忽略）
  function fromScripts() {
    const html = document.documentElement.innerHTML;
    const grab = (re) => (html.match(re) || [])[1];
    const out = {};
    const w = grab(/"unitWeight"\s*:\s*"?([\d.]+)/);
    if (w) out.unitWeight = Number(w);
    const addr = grab(/"sendGoodsAddressText"\s*:\s*"([^"]+)"/) || grab(/"deliveryLocation"\s*:\s*"([^"]+)"/);
    if (addr) out.sendGoodsAddress = addr;
    const stock = grab(/"amountOnSale"\s*:\s*"?(\d+)/) || grab(/"canBookCount"\s*:\s*"?(\d+)/);
    if (stock) out.amountOnSale = Number(stock);
    const ranges = grab(/"priceRanges"\s*:\s*(\[[^\]]*\])/) || grab(/"priceRangeList"\s*:\s*(\[[^\]]*\])/);
    if (ranges) try { out.priceRanges = JSON.parse(ranges); } catch {}
    const skus = html.match(/"skuId"\s*:/g);
    if (skus) out.skuCount = skus.length;
    return out;
  }

  // 商品详情页：一个货源
  function detailOffer() {
    const id = (location.href.match(/offer\/(\d+)\.html/) || [])[1];
    if (!id) return [];
    const title = (document.querySelector('h1, .title-text, [class*="title-content"]')?.textContent || document.title.replace(/-.*$/, '')).trim();
    const priceEl = [...document.querySelectorAll('[class*="price"]')].map((e) => e.textContent).find((t) => /[¥￥]?\s*\d/.test(t));
    const img = document.querySelector('img[class*="detail-gallery"], .detail-gallery img, [class*="main-image"] img, img[src*="cbu01.alicdn.com"]');
    const shop = document.querySelector('[class*="company-name"], [class*="shop-name"], [class*="companyName"]')?.textContent?.trim() || '';
    const addr = (document.body.innerText.match(PROVINCES) || [])[0];
    return [{ num_iid: id, detail_url: `https://detail.1688.com/offer/${id}.html`, title, price: num(priceEl), pic_url: img?.src || '', nick: shop, location: addr || '', ...fromScripts() }];
  }

  // 搜索结果 / 以图搜结果：页面上所有指向商品详情的卡片
  function listOffers() {
    const byId = new Map();
    for (const a of document.querySelectorAll('a[href*="detail.1688.com/offer/"], a[href*="/offer/"][href*="1688"]')) {
      const id = (a.href.match(/offer\/(\d+)\.html/) || [])[1];
      if (!id) continue;
      // 向上找包含价格的卡片容器
      let card = a;
      for (let i = 0; i < 6 && card.parentElement; i++) {
        card = card.parentElement;
        if (/[¥￥]\s*\d|\d+\.\d{1,2}/.test(card.innerText || '') && (card.querySelector('img') || i > 3)) break;
      }
      const text = card.innerText || '';
      const o = byId.get(id) || { num_iid: id, detail_url: `https://detail.1688.com/offer/${id}.html` };
      const t = (a.getAttribute('title') || a.textContent || '').trim();
      if (t.length > (o.title || '').length && t.length < 120) o.title = t;
      if (o.price == null) o.price = num((text.match(/[¥￥]\s*([\d,]+(\.\d+)?)/) || [])[1]) ?? num((card.querySelector('[class*="price"]') || {}).textContent);
      const img = card.querySelector('img');
      if (!o.pic_url && img) o.pic_url = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.src || '';
      const sales = text.match(/(成交|已售|销量)\s*([\d.]+)\s*(万)?\s*(\+)?\s*(件|笔|个)?/);
      if (sales && o.sales == null) o.sales = Number(sales[2]) * (sales[3] ? 1e4 : 1);
      const min = text.match(/(\d+)\s*(件|个|套|只)\s*起(批|订)?/);
      if (min && !o.min_num) o.min_num = Number(min[1]);
      const shop = card.querySelector('[class*="company"], [class*="shop"], [class*="Company"]');
      if (shop && !o.nick) o.nick = shop.textContent.trim().slice(0, 40);
      const addr = text.match(PROVINCES);
      if (addr && !o.location) o.location = addr[0];
      byId.set(id, o);
    }
    return [...byId.values()].filter((o) => o.title && o.price != null).slice(0, 60);
  }

  const scrape = () => (/detail\.1688\.com\/offer\//.test(location.href) ? detailOffer() : listOffers());
  // 1688 滑块 / 登录验证
  const captcha = () => !!document.querySelector('#nc_1_wrapper, .nc-container, [id^="baxia"], .J_MIDDLEWARE_FRAME_WIDGET, iframe[src*="punish"]') || /_____tmd_____|punish/.test(location.href);

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
      <div class="tkops-manual"><b>手动发送本页</b><div class="tkops-found"></div><button class="tkops-send">发送本页货源</button></div><div class="tkops-msg"></div></div></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  let offers = [];
  let items = [];
  const status = (text, done) => {
    const el = $('.tkops-status');
    el.hidden = false;
    el.className = 'tkops-status' + (done ? ' done' : '');
    el.textContent = text;
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
    offers = scrape();
    $('.tkops-found').textContent = offers.length ? `本页识别到 ${offers.length} 个货源` : '本页没有识别到货源（在搜索结果、以图搜结果或商品详情页可用）';
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
    offers = scrape();
    if (!offers.length) return ($('.tkops-msg').textContent = '没有可发送的货源');
    $('.tkops-msg').textContent = '发送中…';
    try {
      sessionStorage.setItem('tkops-pid', productId);
      const r = await api('/ext/offers', { method: 'POST', body: { productId, offers, pageUrl: location.href } });
      $('.tkops-msg').textContent = `已发送，这个商品现在有 ${r.count} 个货源（运营台会自动打分和判断同款）`;
    } catch (e) {
      $('.tkops-msg').textContent = e.message;
    }
  };
  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === 'progress') status(m.text, m.done);
  });

  // ---------- 自动找货 ----------
  // 遇到 1688 验证就等用户处理（最多 3 分钟）
  async function passCaptcha() {
    for (let i = 0; captcha() && i < 90; i++) {
      status('1688 弹出了验证，请手动完成（拖动滑块 / 登录），完成后自动继续…');
      await sleep(2000);
    }
    if (captcha()) throw new Error('1688 验证没有完成，自动找货已停止');
  }

  const fileInput = () => [...document.querySelectorAll('input[type=file]')].find((i) => !i.accept || /image|jpe?g|png/i.test(i.accept));
  async function upload(task) {
    status(`以图搜：正在把「${task.name.slice(0, 30)}」的主图传到 1688…`);
    await passCaptcha();
    const { b64, type } = await bg({ type: 'image', url: task.image });
    const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'product.jpg', { type });
    let input = fileInput();
    // 上传框通常藏在搜索栏的相机图标后面：点一下让它出现
    for (const el of document.querySelectorAll('[class*="camera"], [class*="Camera"], [class*="image-search"], [class*="imageSearch"], [class*="img-search"], [class*="imgSearch"], [title*="图片搜索"], [title*="以图"]')) {
      if (input) break;
      el.click();
      await sleep(500);
      input = fileInput();
    }
    for (let i = 0; !input && i < 16; i++) await sleep(500), (input = fileInput());
    if (!input) {
      // 兜底：主图放进剪贴板，用户在搜索框粘贴
      try {
        const bmp = await createImageBitmap(file);
        const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        c.getContext('2d').drawImage(bmp, 0, 0);
        const png = await new Promise((r) => c.toBlob(r, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        throw new Error('没找到 1688 的图片上传框。商品主图已复制到剪贴板：点搜索框旁的相机图标，按 Ctrl+V 粘贴即可，搜索结果出来后插件会自动采集');
      } catch (e) {
        if (/剪贴板/.test(e.message)) {
          await bg({ type: 'update', patch: { stage: 'collect' } });
          throw e;
        }
        throw new Error('没找到 1688 的图片上传框，请点搜索框旁的相机图标手动上传商品主图，结果出来后点「发送本页货源」');
      }
    }
    await bg({ type: 'update', patch: { stage: 'collect' } });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    status('以图搜：主图已上传，等待 1688 返回结果…');
    // 结果可能在当前页渲染，也可能跳转到结果页（新页面会接着采集）
    await sleep(1500);
    return collect(task);
  }

  const IMG_RESULT = /youyuan|imageSearch|image_search|pailitao|imageId|imageAddress/i;
  async function collect(task) {
    status(`${task.mode === 'image' ? '以图搜' : `关键词「${task.kw}」`}：等待 1688 搜索结果…`);
    let found = [];
    for (let i = 0; i < 30; i++) {
      await passCaptcha();
      // 以图搜：还在首页时别把首页推荐的商品当成结果
      if (task.mode === 'image' && !IMG_RESULT.test(location.href)) {
        if (i > 2 && !(await bg({ type: 'task' }).catch(() => null))) return status('以图搜结果已在新标签页打开，插件在那边继续采集', true);
        await sleep(1000);
        continue;
      }
      found = listOffers();
      if (found.length >= 8 || (found.length && i >= 6)) break;
      await sleep(1000);
    }
    if (!found.length) {
      if (task.mode === 'image' && !IMG_RESULT.test(location.href)) throw new Error('主图已上传，但 1688 没有打开以图搜结果页。结果出来后点「运营台找货 → 发送本页货源」');
      throw new Error('这个页面没有识别到货源。如果 1688 页面改版了，请截图发给开发者调整识别规则');
    }
    // 往下滚几屏，让懒加载的卡片和图片出来
    for (let i = 0; i < 5; i++) scrollBy(0, innerHeight), await sleep(700);
    scrollTo(0, 0);
    found = listOffers();
    status(`识别到 ${found.length} 个货源，正在发送到运营台（AI 判断同款）…`);
    const r = await api('/ext/offers', { method: 'POST', body: { productId: task.productId, offers: found, pageUrl: location.href } });
    await bg({ type: 'done' });
    const urls = r.top.slice(0, task.detailN || 0);
    if (!urls.length) return status(`完成：发送了 ${found.length} 个货源，这个商品现在共 ${r.count} 个。回到运营台「1688 找货」看比价结果。`, true);
    status(`已发送 ${found.length} 个货源；接着打开排名前 ${urls.length} 的详情页补数据…`);
    await bg({ type: 'details', productId: task.productId, urls });
  }

  async function detail(task) {
    for (let i = 0; i < 20 && !document.querySelector('h1, .title-text, [class*="title-content"]') && !captcha(); i++) await sleep(500);
    if (captcha()) return bg({ type: 'detailDone', ok: false, captcha: true });
    await sleep(800);
    try {
      await api('/ext/offers', { method: 'POST', body: { productId: task.productId, offers: detailOffer(), pageUrl: location.href } });
      await bg({ type: 'detailDone', ok: true });
    } catch (e) {
      await bg({ type: 'detailDone', ok: false, error: e.message });
    }
  }

  async function run() {
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
    if (!task) return;
    if (task.stage === 'detail') return detail(task);
    $('.tkops-panel').hidden = false;
    $('.tkops-manual').hidden = true;
    loadProducts().then(() => { if (items.some((p) => p.id === task.productId)) $('.tkops-sel').value = task.productId, syncKw(); });
    try {
      if (task.stage === 'upload') await upload(task);
      else await collect(task);
    } catch (e) {
      status(e.message, true);
      if (!/剪贴板/.test(e.message)) bg({ type: 'done' });
    } finally {
      $('.tkops-manual').hidden = false;
    }
  }
  run();
})();
