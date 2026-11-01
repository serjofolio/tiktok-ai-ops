// 1688 页面：识别货源（搜索结果 / 以图搜结果 / 商品详情），一键发送到运营台的某个商品
(() => {
  if (window.__tkOps) return;
  window.__tkOps = true;

  const api = (path, opts = {}) => new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'api', path, ...opts }, (r) => (r?.ok ? resolve(r.data) : reject(new Error(r?.error || '插件未连接运营台')))));
  const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  const PROVINCES = /(广东|浙江|福建|江苏|上海|山东|河北|河南|湖北|湖南|安徽|江西|广西|四川|重庆|北京|天津|辽宁|吉林|黑龙江|山西|陕西|云南|贵州|海南|甘肃|宁夏|青海|新疆|西藏|内蒙古)[一-龥]{0,4}/;

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

  // ---------- 浮动面板 ----------
  const root = document.createElement('div');
  root.className = 'tkops-root';
  root.innerHTML = `<button class="tkops-fab" title="发送到 TikTok 运营台">发送到运营台</button>
    <div class="tkops-panel" hidden><div class="tkops-head"><b>发送货源到运营台</b><button class="tkops-x">×</button></div>
      <div class="tkops-body"><label>发送给哪个商品<select class="tkops-sel"><option>加载中…</option></select></label>
      <div class="tkops-found"></div><button class="tkops-send">发送</button><div class="tkops-msg"></div></div></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  let offers = [];

  async function open() {
    $('.tkops-panel').hidden = false;
    offers = scrape();
    $('.tkops-found').textContent = offers.length ? `本页识别到 ${offers.length} 个货源` : '本页没有识别到货源（请在搜索结果、以图搜结果或商品详情页使用）';
    try {
      const { items } = await api('/ext/products');
      $('.tkops-sel').innerHTML = items.length
        ? items.map((p) => `<option value="${p.id}">【${p.verdict}】${p.name.slice(0, 40).replace(/</g, '&lt;')}${p.ceilingCny != null ? `（成本上限 ¥${p.ceilingCny}）` : ''}${p.offers ? ` · 已有 ${p.offers} 个货源` : ''}</option>`).join('')
        : '<option value="">选品库里还没有「可以上 / 谨慎测试」的商品</option>';
      const last = sessionStorage.getItem('tkops-pid');
      if (last && items.some((p) => p.id === last)) $('.tkops-sel').value = last;
    } catch (e) {
      $('.tkops-msg').textContent = e.message;
    }
  }

  $('.tkops-fab').onclick = open;
  $('.tkops-x').onclick = () => ($('.tkops-panel').hidden = true);
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
})();
