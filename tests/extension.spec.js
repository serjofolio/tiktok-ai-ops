// 浏览器插件「运营台助手」端到端：真实加载插件 → 弹窗配置令牌 → 1688 搜索页 / 详情页识别货源 → 发送到运营台
// 1688 页面用本地假页面代替（结构参照 1688 搜索结果卡片和详情页里的脚本数据），其他外网请求一律拦截
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EXT = path.join(__dirname, '..', 'extension');
const ADMIN = { username: 'admin', password: 'admin-pass-123' };

const card = ([id, t, p, s, c, l, m]) => `<div class="search-offer-item">
  <a href="https://detail.1688.com/offer/${id}.html" target="_blank"><img src="https://cbu01.alicdn.com/img/${id}.jpg" alt=""></a>
  <div class="offer-title"><a href="https://detail.1688.com/offer/${id}.html" title="${t}">${t}</a></div>
  <div class="offer-price"><span>¥</span><span>${p}</span></div><div>${s}</div><div>${m}</div>
  <div class="company-name">${c}</div><div>${l}</div></div>`;
const SEARCH = `<!doctype html><html><head><meta charset="utf-8"><title>1688</title></head><body>${[
  ['770000001', '睡眠耳机无线蓝牙隐形侧睡不压耳 迷你入耳式', '18.50', '成交1.2万+件', '深圳声悦电子有限公司', '广东 深圳', '2件起批'],
  ['770000002', '隐形睡眠蓝牙耳机 超小 降噪 长续航', '16.00', '成交3200件', '东莞小耳朵电子', '广东 东莞', '5件起批'],
  ['770000003', '运动蓝牙耳机 挂耳式 防水', '12.00', '已售1.5万件', '义乌耳机厂', '浙江 金华', '10件起批'],
].map(card).join('')}</body></html>`;
const DETAIL = `<!doctype html><html><head><meta charset="utf-8"><title>睡眠耳机-阿里巴巴</title></head><body>
<h1 class="title-text">睡眠耳机无线蓝牙隐形侧睡不压耳 迷你入耳式</h1><div class="price-box"><span>¥</span><span class="price-text">17.20</span></div>
<div class="company-name">深圳声悦电子有限公司</div>
<script>window.__INIT_DATA = {"skuModel":{"skuInfoMap":{"黑色":{"skuId":1},"白色":{"skuId":2},"粉色":{"skuId":3}}},"offerBaseInfo":{"unitWeight":0.045,"sendGoodsAddressText":"广东省深圳市","amountOnSale":26000,"priceRanges":[{"startQuantity":2,"price":"19.50"},{"startQuantity":50,"price":"18.50"},{"startQuantity":500,"price":"17.20"}]}};</script></body></html>`;

test('浏览器插件：加载 → 填令牌连接 → 1688 搜索页和详情页识别货源 → 发送到运营台', async ({ request, baseURL }) => {
  test.setTimeout(90000);
  // 准备：管理员、马来西亚 3C 样例、插件令牌
  if ((await request.post('/api/auth/login', { data: ADMIN })).status() === 401) await request.post('/api/auth/register', { data: ADMIN });
  const pv = await (await request.post('/api/products/import/preview', { multipart: { file: { name: 'fm.xlsx', mimeType: 'application/octet-stream', buffer: fs.readFileSync(path.join(__dirname, 'fixtures', 'fastmoss-my-3c.xlsx')) } } })).json();
  await request.post('/api/products/import/commit', { data: { token: pv.token, mapping: pv.mapping } });
  const { token } = await (await request.post('/api/tokens', { data: { name: '插件测试' } })).json();
  const ear = (await (await request.get('/api/products')).json()).items.find((p) => /Sleep Earbuds/.test(p.name));

  const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];

    // 插件弹窗：填地址和令牌，测试连接
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${extId}/popup.html`);
    await pop.fill('#server', baseURL);
    await pop.fill('#token', token);
    await pop.click('#save');
    await expect(pop.locator('#msg')).toHaveText('已连接：admin');

    const page = await ctx.newPage();
    await page.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === 's.1688.com') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: SEARCH });
      if (host === 'detail.1688.com') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: DETAIL });
      return route.abort();
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // 搜索结果页：识别 3 个货源，发给「睡眠耳机」
    await page.goto('https://s.1688.com/selloffer/offer_search.htm?keywords=sleep');
    await page.click('.tkops-fab');
    await expect(page.locator('.tkops-found')).toHaveText('本页识别到 3 个货源');
    await expect(page.locator(`.tkops-sel option[value="${ear.id}"]`)).toHaveCount(1);
    await page.selectOption('.tkops-sel', ear.id);
    await page.click('.tkops-send');
    await expect(page.locator('.tkops-msg')).toContainText(/已发送，这个商品现在有 \d+ 个货源/);

    // 详情页：补全阶梯价、库存、发货地、重量、SKU，默认选中上次的商品
    await page.goto('https://detail.1688.com/offer/770000001.html');
    await page.click('.tkops-fab');
    await expect(page.locator('.tkops-found')).toHaveText('本页识别到 1 个货源');
    await expect(page.locator('.tkops-sel')).toHaveValue(ear.id);
    await page.click('.tkops-send');
    await expect(page.locator('.tkops-msg')).toContainText('已发送');
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }

  // 运营台里：同一个货源的搜索页信息和详情页信息合并在一起
  const p = await (await request.get(`/api/products/${ear.id}`)).json();
  const o = p.sourcing.offers.find((x) => x.offerId === '770000001');
  expect(o).toMatchObject({ moq: 2, amountOnSale: 26000, sendGoodsAddress: '广东省深圳市', unitWeight: 0.045, skuCount: 3, sales: 12000, shop: '深圳声悦电子有限公司', source: '浏览器插件' });
  expect(o.priceRanges).toEqual([{ startQuantity: 2, price: 19.5 }, { startQuantity: 50, price: 18.5 }, { startQuantity: 500, price: 17.2 }]);
  expect(p.sourcing.offers.find((x) => x.offerId === '770000003').sendGoodsAddress).toBe('浙江 金华');
});
