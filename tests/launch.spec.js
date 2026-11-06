// 测款作战室、今日行动、示例工作区：决策由程序计算，这里逐条核对边界
const { test, expect } = require('@playwright/test');
const { economics, decide, testPlan, sumRows } = require('../server/services/launch');

const UP = 'http://localhost:3902';
const json = async (r) => {
  const body = await r.json();
  if (!r.ok()) throw new Error(`${r.status()} ${body.error}`);
  return body;
};
async function admin(page) {
  const creds = { username: 'admin', password: 'admin-pass-123' };
  const r = await page.request.post('/api/auth/login', { data: creds });
  if (!r.ok()) await json(await page.request.post('/api/auth/register', { data: creds }));
}
async function useFakeLlm(page) {
  const list = await json(await page.request.get('/api/providers'));
  let p = list.items.find((x) => x.baseUrl === `${UP}/v1`);
  if (!p) p = await json(await page.request.post('/api/providers', { data: { name: '测试模型', protocol: 'openai', baseUrl: `${UP}/v1`, apiKey: 'sk-test', model: 'glm-test' } }));
  await json(await page.request.post(`/api/providers/${p.id}/activate`));
}
const makeProduct = async (page, name, extra = {}) => json(await page.request.post('/api/products', { data: { name, market: 'US', category: '首饰', price: 20, sales7d: 700, gmv: 14000, sales28d: 2000, creatorCount: 40, videoCount: 90, commissionRate: 10, ...extra } }));
const cleanSample = (page) => page.request.delete('/api/sample');
// 别的用例可能留下 1688 和 ERP 连接器，这里测的是没有接口时的路径
async function noConnectors(page) {
  for (const c of (await json(await page.request.get('/api/connectors'))).items) if (['sourcing', 'erp'].includes(c.kind)) await page.request.delete(`/api/connectors/${c.id}`);
}

// 售价 $20，不含佣金每单能花 $8，达人单 $6
const econ = { currency: '$', cnyRate: 7, price: 20, hasCost: true, ownOrder: 8, creatorOrder: 6, commission: 2 };
const plan = { killSpend: 16 };
const day = (n, o) => ({ date: `2026-10-${String(n).padStart(2, '0')}`, creatorOrders: 0, ...o });

test('决策：止损线、样本量、加码线和最近变贵都按账本算', async () => {
  const code = (rows, e = econ) => decide(e, plan, rows).code;
  expect(code([])).toBe('ready');
  expect(decide({ ...econ, hasCost: false, ownOrder: null, ceilingCny: 9 }, null, []).code).toBe('blocked');
  expect(decide({ ...econ, ownOrder: -1 }, null, []).code).toBe('stop');
  // 没出单：止损线前继续，到线就停
  expect(code([day(1, { adSpend: 15.99, orders: 0 })])).toBe('keep');
  expect(code([day(1, { adSpend: 16, orders: 0 })])).toBe('stop');
  // CPA 很低但只有 4 单：不下加码结论
  expect(code([day(1, { adSpend: 8, orders: 4 })])).toBe('keep');
  // 第 5 单开始，CPA 不超过保本的七成才加码
  expect(code([day(1, { adSpend: 28, orders: 5 })])).toBe('scale');
  expect(code([day(1, { adSpend: 29, orders: 5 })])).toBe('keep');
  // 超过保本要优化；花到止损线 3 倍还亏才判停
  expect(code([day(1, { adSpend: 45, orders: 5 })])).toBe('fix');
  expect(code([day(1, { adSpend: 48, orders: 5 })])).toBe('stop');
  // 累计赚钱，但最近 3 条超过保本：不能加预算
  const later = [day(1, { adSpend: 10, orders: 10 }), day(2, { adSpend: 10, orders: 10 }), day(3, { adSpend: 20, orders: 2 }), day(4, { adSpend: 20, orders: 2 }), day(5, { adSpend: 20, orders: 2 })];
  expect(code(later)).toBe('keep');
  expect(decide(econ, plan, later).title).toContain('变贵');
  // 没花广告费的自然单算赚钱
  expect(code([day(1, { adSpend: 0, orders: 3 })])).toBe('keep');
});

test('利润：没填达人单时全部扣佣金，填 0 时不扣', () => {
  expect(sumRows([{ date: '2026-10-01', orders: 10, adSpend: 20 }], econ).profit).toBe(40); // 10×6-20
  expect(sumRows([{ date: '2026-10-01', orders: 10, adSpend: 20, creatorOrders: 0 }], econ).profit).toBe(60); // 10×8-20
  expect(sumRows([{ date: '2026-10-01', orders: 10, adSpend: 20, creatorOrders: 4 }], econ).profit).toBe(52);
});

test('诊断：用保本反推需要的转化率', () => {
  const d = decide(econ, plan, [day(1, { views: 10000, clicks: 200, adSpend: 60, orders: 3 })]);
  const text = d.diagnosis.map((x) => x.text).join();
  expect(text).toContain('至少要 3.8%'); // 每次点击 $0.3 ÷ 保本 $8 = 3.75%
  expect(text).toContain('现在是 1.5%');
  const low = decide(econ, plan, [day(1, { views: 10000, clicks: 50, adSpend: 5, orders: 2 })]);
  expect(low.diagnosis[0].stage).toBe('开头');
});

test('账本接口：录入、覆盖、校验、用户隔离', async ({ page, browser, baseURL }) => {
  await admin(page);
  const p = await makeProduct(page, `Gold Hoop Earrings ${Date.now()}`, { });
  let v = await json(await page.request.post(`/api/launch/${p.id}/start`));
  expect(v.decision.code).toBe('blocked');
  await json(await page.request.patch(`/api/products/${p.id}`, { data: { costCny: 20, shippingCny: 8 } }));
  v = await json(await page.request.get(`/api/launch/${p.id}`));
  expect(v.economics.hasCost).toBe(true);
  // 账本和选品的净利对得上：选品净利 + 广告预留 + 佣金 = 自投单能花的钱
  const full = await json(await page.request.get(`/api/products/${p.id}`));
  const pr = full.evaluation.profit;
  expect(v.economics.ownOrder).toBeCloseTo(pr.unitProfit + (pr.asp * pr.adRate) / 100 + (pr.asp * pr.commission) / 100, 1);
  expect(v.plan.killSpend).toBeCloseTo(v.economics.ownOrder * 2, 1);

  const date = '2026-10-20';
  v = await json(await page.request.post(`/api/launch/${p.id}/days`, { data: { date, views: 100, clicks: 10, orders: 1, adSpend: 3 } }));
  v = await json(await page.request.post(`/api/launch/${p.id}/days`, { data: { date, views: 200, clicks: 20, orders: 2, adSpend: 6 } }));
  expect(v.days).toHaveLength(1);
  expect(v.totals.orders).toBe(2);
  expect((await json(await page.request.get(`/api/products/${p.id}`))).status).toBe('testing');
  for (const bad of [{ date: 'x' }, { date, orders: -1 }, { date, orders: 1, creatorOrders: 2 }, { date, scriptId: 'nope' }]) expect((await page.request.post(`/api/launch/${p.id}/days`, { data: bad })).status()).toBe(400);
  v = await json(await page.request.delete(`/api/launch/${p.id}/days/${v.days[0].id}`));
  expect(v.days).toHaveLength(0);
  const md = await (await page.request.get(`/api/launch/${p.id}/export`)).text();
  expect(md).toContain('测款作战书');

  const ctx = await browser.newContext({ baseURL });
  await json(await ctx.request.post('/api/auth/register', { data: { username: `iso${Date.now() % 100000}`, password: 'iso-pass-123' } }));
  expect((await ctx.request.get(`/api/launch/${p.id}`)).status()).toBe(404);
  expect((await ctx.request.post(`/api/launch/${p.id}/days`, { data: { date, orders: 1 } })).status()).toBe(404);
  await ctx.close();
  await page.request.delete(`/api/products/${p.id}`);
});

test('一键备战：只补缺的，不覆盖已有上架包，也不推送', async ({ page }) => {
  await admin(page);
  await useFakeLlm(page);
  await noConnectors(page);
  const p = await makeProduct(page, `Layered Pearl Necklace ${Date.now()}`);
  await json(await page.request.patch(`/api/products/${p.id}`, { data: { costCny: 15, shippingCny: 5 } }));
  await page.goto(`/#/launch/${p.id}`);
  await page.locator('#prep').click();
  const final = await expect.poll(async () => (await json(await page.request.get(`/api/launch/${p.id}`))).job?.status, { timeout: 40000 }).toBe('done');
  void final;
  const v = await json(await page.request.get(`/api/launch/${p.id}`));
  const steps = Object.fromEntries(v.job.steps.map((s) => [s.key, s]));
  expect(steps.source.status).toBe('skipped'); // 没有 1688 接口，写明原因
  expect(steps.source.note).toContain('没有 1688 接口');
  expect(steps.scripts.status).toBe('done');
  expect(v.scripts).toHaveLength(3);
  const before = await json(await page.request.get(`/api/products/${p.id}`));
  expect(before.listing.status).toBe('draft');
  await json(await page.request.patch(`/api/products/${p.id}/listing`, { data: { pack: { titleEn: '我改过的标题' } } }));
  await json(await page.request.post(`/api/launch/${p.id}/prepare`));
  await expect.poll(async () => (await json(await page.request.get(`/api/launch/${p.id}`))).job?.status, { timeout: 20000 }).toBe('done');
  const after = await json(await page.request.get(`/api/products/${p.id}`));
  expect(after.listing.pack.titleEn).toBe('我改过的标题');
  expect((await json(await page.request.get(`/api/launch/${p.id}`))).scripts).toHaveLength(3);
  await page.request.delete(`/api/products/${p.id}`);
});

test('硬伤商品不会被一键备战直接跑掉', async ({ page }) => {
  await admin(page);
  await useFakeLlm(page);
  const p = await makeProduct(page, `Cartier Love Bangle ${Date.now()}`);
  const r = await page.request.post(`/api/launch/${p.id}/prepare`);
  expect(r.status()).toBe(409);
  await page.request.delete(`/api/products/${p.id}`);
});

test('示例工作区：载入后四种状态齐全，界面标明示例，清除不动真实数据', async ({ page }) => {
  await admin(page);
  await cleanSample(page);
  const real = await makeProduct(page, `My Real Product ${Date.now()}`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await json(await page.request.post('/api/sample'));
  expect((await page.request.post('/api/sample')).status()).toBe(409);

  const b = await json(await page.request.get('/api/launch/board'));
  expect(b.columns.scale.map((x) => x.name).join()).toContain('Pearl');
  expect(b.columns.testing.map((x) => x.name).join()).toContain('Huggie');
  expect(b.columns.stop.map((x) => x.name).join()).toContain('Organizer');
  expect(b.columns.prep.map((x) => x.name).join()).toContain('Initial');
  expect(b.summary.profitCny).toBeGreaterThan(0);
  expect(b.next.map((x) => x.name).join()).not.toContain('Cartier');

  // 品牌款和可疑数据被规则拦住
  const items = (await json(await page.request.get('/api/products'))).items;
  expect(items.find((x) => x.name.includes('Cartier')).evaluation.verdict).toBe('不建议上');
  expect(items.find((x) => x.name.includes('Crystal Pendant')).evaluation.flags.map((f) => f.title)).toContain('数据可疑');
  const g = await json(await page.request.get('/api/products/growth?window=10&group=首饰'));
  expect(g.items.find((x) => x.name.includes('Pearl')).grade).toBe('snapshot');

  await page.goto('/#/dashboard');
  await expect(page.locator('.sample-bar')).toContainText('虚构');
  await expect(page.locator('.today-row').first()).toContainText('停掉');
  await page.goto('/#/launch');
  await expect(page.locator('.lb-scale .lb-card')).toHaveCount(1);
  await page.locator('.lb-scale .lb-card').click();
  await expect(page.locator('.dc-call b')).toHaveText('加码');
  await expect(page.locator('.profit-chart svg')).toBeVisible();
  await expect(page.locator('text=赢家').first()).toBeVisible();
  await expect(page.locator('.tag-sample').first()).toBeVisible();
  // 录入一条后判断立即更新
  await page.locator('input[name=adSpend]').fill('9999');
  await page.locator('#d-add').click();
  await expect(page.locator('.dc-call b')).not.toHaveText('加码');

  await page.goto('/#/scripts/viral');
  await expect(page.locator('.viral-nofile')).toBeVisible();

  // 手机宽度不溢出
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ['/#/launch', `/#/launch/${b.columns.scale[0].id}`, '/#/dashboard']) {
    await page.goto(url);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), url).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await json(await page.request.delete('/api/sample'));
  const left = (await json(await page.request.get('/api/products'))).items;
  expect(left.some((x) => x.sample)).toBe(false);
  expect(left.some((x) => x.id === real.id)).toBe(true);
  expect((await json(await page.request.get('/api/scripts'))).items.some((x) => x.sample)).toBe(false);
  expect((await json(await page.request.get('/api/viral'))).items.some((x) => x.sample)).toBe(false);
  await page.request.delete(`/api/products/${real.id}`);
  expect(errors).toEqual([]);
});

test('流水线：继续时保留人工修改、插件补货后不再卡住、同款度门槛可以设 0', async ({ page }) => {
  await admin(page);
  await useFakeLlm(page);
  await cleanSample(page);
  await noConnectors(page);
  const name = `Pipeline Pearl Necklace ${Date.now()}`;
  const p = await makeProduct(page, name);
  const list = (await json(await page.request.get('/api/products'))).items;
  for (const x of list) if (x.id !== p.id && x.status !== 'dropped' && x.evaluation.verdict === '可以上') await page.request.patch(`/api/products/${x.id}`, { data: { status: 'dropped' } });
  await json(await page.request.patch(`/api/products/${p.id}`, { data: { costCny: 8, shippingCny: 3 } }));
  const cur = await json(await page.request.get(`/api/products/${p.id}`));
  test.skip(cur.evaluation.verdict !== '可以上', `测试商品结论是 ${cur.evaluation.verdict}`);
  const run = await json(await page.request.post('/api/pipeline/runs', { data: { scope: 'all', topN: 20, minMatch: 0 } }));
  expect(run.config.minMatch).toBe(0);
  const settled = async () => { let r; await expect.poll(async () => { r = await json(await page.request.get(`/api/pipeline/runs/${run.id}`)); return r.running; }, { timeout: 30000 }).toBe(false); return r; };
  let r = await settled();
  expect(r.stages.find((s) => s.key === 'source').status).toBe('waiting');
  await json(await page.request.post(`/api/products/${p.id}/sourcing/offers`, { data: { offers: [{ offerId: '111', title: '珍珠项链', price: 5, url: 'https://detail.1688.com/offer/111.html' }] } }));
  await json(await page.request.post(`/api/pipeline/runs/${run.id}/resume`));
  r = await settled();
  await json(await page.request.patch(`/api/products/${p.id}/listing`, { data: { pack: { titleEn: '人工改过' } } }));
  await json(await page.request.post(`/api/pipeline/runs/${run.id}/resume`));
  r = await settled();
  expect((await json(await page.request.get(`/api/products/${p.id}`))).listing.pack.titleEn).toBe('人工改过');
  await page.request.delete(`/api/products/${p.id}`);
});
