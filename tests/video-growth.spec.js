// 增长榜与选品库筛选、FastMoss 接口、爆款方法论、脚本生成、爆款拆解、视频模型、内网防护
// 外部服务都走 tests/fake-upstream.js 的模拟服务，字段按各家官方文档
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const UP = 'http://127.0.0.1:3902';
const ADMIN = { username: 'admin', password: 'admin-pass-123' };
async function admin(page) {
  const r = await page.request.post('/api/auth/login', { data: ADMIN });
  if (r.status() === 401) expect((await page.request.post('/api/auth/register', { data: ADMIN })).ok()).toBeTruthy();
}
const json = async (r) => {
  const t = await r.text();
  expect(r.ok(), t.slice(0, 300)).toBeTruthy();
  return JSON.parse(t);
};
async function useFakeLlm(page) {
  const list = await json(await page.request.get('/api/providers'));
  let p = list.items.find((x) => x.baseUrl === `${UP}/v1`);
  if (!p) p = await json(await page.request.post('/api/providers', { data: { name: '测试模型', protocol: 'openai', baseUrl: `${UP}/v1`, apiKey: 'sk-test', model: 'glm-test' } }));
  await json(await page.request.post(`/api/providers/${p.id}/activate`));
}
const CSV_HEAD = '商品名称,店铺名称,国家/地区,商品分类,售价,7天销量,7天销售额,28天销量,28天销售额,总销量,总销售额,带货达人总数,带货视频总数,TikTok商品落地页地址';
const row = (name, id, cat, s7, g7, s28, g28, tot, gtot, cr = 20, vd = 30) => `${name},Shop A,US,${cat},$12.00,${s7},${g7},${s28},${g28},${tot},${gtot},${cr},${vd},https://shop.tiktok.com/view/product/${id}`;
async function importCsv(page, rows, dataDate, fileName) {
  const form = { multipart: { file: { name: fileName || 'fm.csv', mimeType: 'text/csv', buffer: Buffer.from([CSV_HEAD, ...rows].join('\n')) } } };
  const pv = await json(await page.request.post('/api/products/import/preview', form));
  return json(await page.request.post('/api/products/import/commit', { data: { token: pv.token, mapping: pv.mapping, dataDate } }));
}
const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);

let clipFile;
test.beforeAll(() => {
  clipFile = path.join(os.tmpdir(), `tk-viral-${process.pid}.mp4`);
  execFileSync(require('ffmpeg-static'), ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=15:duration=9', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=9', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clipFile], { stdio: 'ignore' });
});
test.afterAll(() => fs.rmSync(clipFile, { force: true }));

test('内网防护：普通用户不能让服务器访问内网，包括绕过写法和跳转', async ({ browser, baseURL, page }) => {
  await admin(page); // 第一个注册的账号是管理员，先占掉
  const ctx = await browser.newContext({ baseURL });
  const r = ctx.request;
  await json(await r.post('/api/auth/register', { data: { username: `ssrf${Date.now() % 100000}`, password: 'ssrf-pass-123' } }));
  const before = (await (await fetch(`${UP}/webhook/last`)).json()).count;
  for (const url of [`${UP}/webhook`, 'http://[::ffff:7f00:1]:3902/webhook', 'http://2130706433:3902/webhook', 'http://localhost:3902/webhook']) {
    const c = await json(await r.post('/api/connectors', { data: { vendor: 'webhook', creds: { url } } }));
    const t = await r.post(`/api/connectors/${c.id}/test`);
    expect(await t.text(), url).toContain('不能请求内网地址');
  }
  expect((await (await fetch(`${UP}/webhook/last`)).json()).count).toBe(before);
  const pv = await json(await r.post('/api/providers', { data: { name: 'x', protocol: 'openai', baseUrl: `${UP}/v1`, apiKey: 'sk-test', model: 'm' } }));
  expect(await (await r.post(`/api/providers/${pv.id}/test`)).text()).toContain('不能请求内网地址');
  const kb = await json(await r.post('/api/kbs', { data: { name: 'k' } }));
  expect(await (await r.post(`/api/kbs/${kb.id}/url`, { data: { url: `${UP}/webhook/last` } })).text()).toContain('不能请求内网地址');
  await ctx.close();
});

test('选品库：按日期、批次、分类筛选，批量操作', async ({ page }) => {
  await admin(page);
  const old = await importCsv(page, [row('Gold Hoop Earrings Alpha', '19100000000000001', '珠宝配饰', 100, 1200, 400, 4800, 3000, 36000, 10, 12), row('Silver Chain Necklace Beta', '19100000000000002', '珠宝配饰', 300, 3600, 1000, 12000, 5000, 60000, 8, 10)], daysAgo(10), 'old.csv');
  expect(old.created).toBe(2);
  const now = await importCsv(page, [row('Gold Hoop Earrings Alpha', '19100000000000001', '珠宝配饰', 500, 6000, 800, 9600, 4000, 48000, 40, 60), row('Silver Chain Necklace Beta', '19100000000000002', '珠宝配饰', 60, 720, 700, 8400, 5100, 61200, 8, 10), row('Kitchen Sponge Holder Gamma', '19100000000000003', '家居', 900, 2700, 1200, 3600, 9000, 27000)], undefined, 'new.csv');
  expect(now.updated).toBe(2);
  const hist = await importCsv(page, [row('Gold Hoop Earrings Alpha', '19100000000000001', '珠宝配饰', 50, 600, 200, 2400, 2500, 30000)], daysAgo(20), 'older.csv');
  expect(hist.history).toBe(1);
  // 旧文件不覆盖最新数据
  const all = await json(await page.request.get('/api/products?q=Alpha'));
  expect(all.items[0].salesTotal).toBe(4000);

  await page.goto('/#/products');
  await expect(page.locator('#filters')).toBeVisible();
  await expect(page.locator('[data-f=batch] option', { hasText: 'new.csv' })).toHaveCount(1);
  await page.locator('#f-cat').selectOption({ label: '家居（1）' });
  await expect(page.locator('#list .prow')).toHaveCount(1);
  await expect(page.locator('#list .prow')).toContainText('Gamma');
  await page.click('#f-clear');
  await page.locator('#f-cat').selectOption({ index: 1 }); // 首饰（自动识别）
  await expect(page.locator('#list .prow', { hasText: 'Gamma' })).toHaveCount(0);
  await expect(page.locator('#list .prow', { hasText: 'Alpha' })).toHaveCount(1);
  await page.click('#f-clear');
  // 批量：勾选后标记放弃，再取消
  await page.locator('.prow', { hasText: 'Gamma' }).locator('[data-chk]').check();
  await expect(page.locator('.bulkbar')).toContainText('已选 1 个');
  await page.click('[data-b=dropped]');
  await expect(page.locator('.bulkbar')).toHaveCount(0);
  const gamma = (await json(await page.request.get('/api/products?q=Gamma'))).items[0];
  expect(gamma.status).toBe('dropped');
  await json(await page.request.post('/api/products/bulk', { data: { ids: [gamma.id], action: 'status', status: 'candidate' } }));
});

test('增长榜：两次导入算实测增长，只有一次数据的标估算', async ({ page }) => {
  await admin(page);
  const b = await json(await page.request.get('/api/products/growth?window=10&q=Hoop Earrings Alpha'));
  const alpha = b.items[0];
  expect(alpha.grade).toBe('snapshot');
  expect(alpha.units.cur).toBe(1000); // 累计 3000 → 4000，隔 10 天
  expect(alpha.units.prev).toBe(500); // 累计 2500 → 3000
  expect(alpha.units.rate).toBe(100);
  expect(alpha.gmv.cur).toBe(12000);
  expect(alpha.lead.creators).toBe(30);
  const gamma = (await json(await page.request.get('/api/products/growth?window=10&q=Gamma'))).items[0];
  expect(gamma.grade).toBe('estimate');
  expect(gamma.units.cur).toBe(1286); // 900 / 7 × 10
  // 只看销量和 GMV 都在涨：Beta 10 天只卖了 100 件（前期按 28 天日均约 357 件），被隐藏
  const beta = (await json(await page.request.get('/api/products/growth?window=10&q=Chain Necklace Beta'))).items[0];
  expect(beta.units.rate).toBeLessThan(0);
  const rising = await json(await page.request.get('/api/products/growth?window=10&q=Chain Necklace Beta&rising=1'));
  expect(rising.items).toHaveLength(0);
  expect(rising.flat).toBe(1);
  expect((await json(await page.request.get('/api/products/growth?window=10&q=Hoop Earrings Alpha&rising=1'))).items).toHaveLength(1);
  await page.goto('/#/products');
  await page.click('#panes [data-p=growth]');
  await expect(page.locator('#growth-pane .ptable')).toBeVisible();
  await expect(page.locator('#growth-pane .note-card')).toContainText('估算');
  await expect(page.locator('#growth-pane .prow', { hasText: 'Alpha' })).toContainText('实测');
  await expect(page.locator('#growth-pane .prow', { hasText: 'Beta' })).toHaveCount(1);
  const risingSwitch = page.locator('label.switch', { has: page.locator('#g-rising') }).locator('span');
  await risingSwitch.click();
  await expect(page.locator('#growth-pane .prow', { hasText: 'Beta' })).toHaveCount(0);
  await expect(page.locator('#growth-pane')).toContainText('销量或 GMV 没涨，已隐藏');
  await expect(page.locator('#growth-pane .prow', { hasText: 'Alpha' })).toHaveCount(1);
  await expect(page.locator('#g-rising')).toBeChecked();
  await risingSwitch.click();
  await expect(page.locator('#growth-pane .prow', { hasText: 'Beta' })).toHaveCount(1);
  // 导入批次精确到秒（补传的旧文件标出数据日期）；按批次和结论筛；不建议上的直接写原因
  const delta = await importCsv(page, [row('PAVOI Four Leaf Clover Earrings Delta', '19100000000000009', '珠宝配饰', 400, 4800, 600, 7200, 900, 10800)], undefined, 'delta.csv');
  const dRow = (await json(await page.request.get('/api/products/growth?window=10&q=Clover Earrings Delta'))).items[0];
  expect(dRow.verdict).toBe('不建议上');
  expect(dRow.reason).toContain('品牌商品');
  await page.reload();
  await page.click('#panes [data-p=growth]');
  const batchSel = page.locator('#growth-pane [data-g=batch]');
  await expect(batchSel.locator('option', { hasText: 'delta.csv' })).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} · delta\.csv · 1 个$/);
  await expect(batchSel.locator('option', { hasText: 'older.csv' })).toContainText(`数据日期 ${daysAgo(20)}`);
  await batchSel.selectOption({ label: (await batchSel.locator('option', { hasText: 'new.csv' }).textContent()).trim() });
  await expect(page.locator('#growth-pane .prow', { hasText: 'Alpha' })).toHaveCount(1);
  await expect(page.locator('#growth-pane .prow', { hasText: 'Delta' })).toHaveCount(0);
  await page.locator('#growth-pane [data-g=batch]').selectOption('');
  await page.locator('#growth-pane [data-g=verdict]').selectOption('不建议上');
  await expect(page.locator('#growth-pane .prow', { hasText: 'Delta' }).locator('.v-reason')).toContainText('品牌商品');
  await expect(page.locator('#growth-pane .prow', { hasText: 'Alpha' })).toHaveCount(0);
  await page.locator('#growth-pane [data-g=verdict]').selectOption('');
  await json(await page.request.delete(`/api/products/${delta.ids[0]}`));
  await page.locator('#g-cat').selectOption({ index: 1 });
  await expect(page.locator('#growth-pane .prow', { hasText: 'Gamma' })).toHaveCount(0);
});

test('FastMoss 接口：拉候选和逐日销量，算出实测增长', async ({ page }) => {
  await admin(page);
  const c = await json(await page.request.post('/api/connectors', { data: { vendor: 'fastmoss', creds: { apiKey: 'fm-test' }, options: { baseUrl: `${UP}/fastmoss` } } }));
  expect((await json(await page.request.post(`/api/connectors/${c.id}/test`))).message).toContain('2 个一级类目');
  await page.goto('/#/products');
  await page.click('#pull');
  await expect(page.locator('#cost')).toContainText('预计调用');
  await page.locator('#pf [name=limit]').selectOption('20');
  await page.click('#go');
  await expect(page.locator('.toast').last()).toContainText('拉取完成', { timeout: 20000 });
  const sent = await (await fetch(`${UP}/sent`)).json();
  const search = sent.fastmoss.find((x) => x.path.endsWith('/product/v1/search'));
  expect(search.body.filter.region).toBe('US');
  expect(search.body.filter.l1_category_id).toBe(200);
  expect(sent.fastmoss.filter((x) => x.path.endsWith('/salesTrend'))[0].body.filter.days).toBe(20);
  const b = await json(await page.request.get('/api/products/growth?window=10&q=Gold Hoop Earrings 3'));
  expect(b.items[0].grade).toBe('daily');
  expect(b.items[0].units).toMatchObject({ cur: 600, prev: 50 });
  expect(b.items[0].spark).toHaveLength(20);
  await json(await page.request.delete(`/api/connectors/${c.id}`));
});

test('爆款方法论：页面能打开，内容带来源', async ({ page }) => {
  await admin(page);
  await page.goto('/#/scripts/playbook');
  await expect(page.locator('.pb-head')).toContainText('局限');
  await expect(page.locator('#p-sum .pb-point')).toHaveCount(9);
  expect(await page.locator('#p-hooks .card').count()).toBeGreaterThanOrEqual(12);
  expect(await page.locator('#p-styles .card').count()).toBeGreaterThanOrEqual(20);
  await expect(page.locator('#p-jewelry')).toContainText('$12.92');
  await expect(page.locator('#p-rules')).toContainText('AI 不能改变商品');
  await expect(page.locator('#p-sample a[href*="peargrowth"]').first()).toBeVisible();
});

test('写脚本：多种风格、挖痛点、生成多条、自检、字幕', async ({ page }) => {
  await admin(page);
  await useFakeLlm(page);
  const p = (await json(await page.request.get('/api/products?q=Alpha'))).items[0];
  await page.goto(`/#/scripts/new/${p.id}`);
  await expect(page.locator('#groups button')).toHaveCount(4);
  await page.click('#groups [data-g=show]');
  await page.click('#styles [data-k=styling]');
  await expect(page.locator('#styles [data-k=styling] .rec')).toBeVisible(); // 首饰推荐
  await expect(page.locator('#style-detail')).toContainText('第 1 种搭配');
  await page.click('#mine');
  await expect(page.locator('.pain')).toHaveCount(2);
  await page.locator('.pain').first().click();
  await page.locator('#count').selectOption('3');
  const sentBodies = [];
  page.on('request', (q) => q.url().endsWith('/api/scripts/generate') && sentBodies.push(q.postDataJSON()));
  await page.click('#gen');
  await expect(page.locator('.toast').last()).toContainText('写好了 3 条', { timeout: 20000 });
  expect(sentBodies).toHaveLength(3);
  expect(sentBodies[0].pain.pain).toBe('戴两周就变色');
  expect(sentBodies.map((b) => b.variant)).toEqual([0, 1, 2]);
  expect(sentBodies[2].avoid).toHaveLength(2);
  await expect(page.locator('.check-box')).toContainText('上线前自检');
  const s = (await json(await page.request.get('/api/scripts'))).items[0];
  expect(s.check.items.length).toBeGreaterThan(5);
  expect(s.hookName).toBeTruthy();
  const srt = await page.request.get(`/api/scripts/${s.id}/srt`);
  expect(await srt.text()).toContain('00:00:00,000 --> 00:00:04,000'); // 15 秒的镜头按要求的 20 秒等比调整
});

test('脚本自检能发现违禁词和寒暄', async () => {
  const { lint } = require('../server/services/scripts');
  const r = lint({ hook: 'Hi guys, you won\'t believe this', scenes: [{ n: 1, duration: 3, voiceover: 'Kualiti terbaik dijamin', caption: 'best dupe of Van Cleef', productVisible: false }], caption: 'Tốt nhất' }, { duration: 15, jewelry: true });
  const failed = r.items.filter((x) => !x.pass).map((x) => x.label);
  expect(failed).toEqual(expect.arrayContaining(['开头没有寒暄', '不是纯悬念钩子', '第一帧有产品', '没有违禁用语', '没有提其他品牌', '总时长对得上']));
  expect(r.score).toBeLessThan(60);
});

test('爆款拆解：上传视频 → 报告 → 学习写脚本；非视频和看不见图片的模型会被拦住', async ({ page }) => {
  test.setTimeout(120000);
  await admin(page);
  await useFakeLlm(page);
  // 假文件
  const fake = await page.request.post('/api/viral', { multipart: { video: { name: 'x.mp4', mimeType: 'video/mp4', buffer: Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n') } } });
  expect(fake.status()).toBe(400);
  expect(await fake.text()).toContain('不是视频');
  const asr = await json(await page.request.post('/api/connectors', { data: { vendor: 'asropenai', creds: { apiKey: 'sk-test' }, options: { baseUrl: `${UP}/v1`, model: 'whisper-1' } } }));
  expect((await json(await page.request.post(`/api/connectors/${asr.id}/test`))).message).toContain('语音转写接口可用');
  await page.goto('/#/scripts/viral');
  await expect(page.locator('.caps')).toContainText('听口播');
  await page.setInputFiles('#file', { name: 'viral-earrings.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(clipFile) });
  await expect(page.locator('.key-reason')).toContainText('别人的反应', { timeout: 60000 });
  await expect(page.locator('.measure')).toContainText('9 秒');
  await expect(page.locator('.timeline-table tbody tr')).toHaveCount(2);
  await expect(page.locator('video.video-el')).toHaveAttribute('src', /\/api\/media\//);
  await expect(page.locator('.frame-strip img').first()).toBeVisible();
  const v = (await json(await page.request.get('/api/viral'))).items[0];
  const full = await json(await page.request.get(`/api/viral/${v.id}`));
  expect(full.transcript.text).toContain('Everyone keeps asking');
  expect(full.seen.frames.length).toBe(full.frames.length);
  // 视频能播放（支持拖动进度）
  const ranged = await page.request.get(`/api/media/${full.mediaId}`, { headers: { Range: 'bytes=0-99' } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()['x-content-type-options']).toBe('nosniff');
  // 别人看不到
  const other = await page.context().browser().newContext({ baseURL: page.url().replace(/\/#.*/, '') });
  await other.request.post('/api/auth/register', { data: { username: `peek${Date.now() % 100000}`, password: 'peek-pass-123' } });
  expect((await other.request.get(`/api/media/${full.mediaId}`)).status()).toBe(404);
  expect((await other.request.get(`/api/viral/${v.id}/frames/f-001.jpg`)).status()).toBe(404);
  await other.close();
  // 学习写脚本
  await page.locator('#l-count').selectOption('1');
  await page.click('#l-go');
  await expect(page.locator('#l-out .list-item')).toHaveCount(1, { timeout: 20000 });
  const script = (await json(await page.request.get('/api/scripts'))).items[0];
  expect(script.viralId).toBe(v.id);
  expect(script.hookType).toBe('others_react');
  // 看不见图片的模型：不能编造，没有口播时直接报错说明
  await json(await page.request.delete(`/api/connectors/${asr.id}`));
  const blind = await json(await page.request.post('/api/providers', { data: { name: '文字模型', protocol: 'openai', baseUrl: `${UP}/blind/v1`, apiKey: 'sk-test', model: 'text-only' } }));
  await json(await page.request.post(`/api/providers/${blind.id}/activate`));
  const up = await json(await page.request.post('/api/viral', { multipart: { video: { name: 'b.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(clipFile) } } }));
  await expect.poll(async () => (await json(await page.request.get(`/api/viral/${up.id}`))).status, { timeout: 40000 }).toBe('error');
  expect((await json(await page.request.get(`/api/viral/${up.id}`))).error).toContain('看不到画面');
  await json(await page.request.delete(`/api/viral/${up.id}`));
  await json(await page.request.delete(`/api/providers/${blind.id}`));
  await useFakeLlm(page);
});

test('视频模型：接入配置添加 → 脚本生成视频 → 合并保存 → 可下载；各家适配器', async ({ page }) => {
  test.setTimeout(120000);
  await admin(page);
  await useFakeLlm(page);
  const script = (await json(await page.request.get('/api/scripts'))).items[0];
  // 没接入时给出引导
  await page.goto(`/#/scripts/${script.id}`);
  await page.click('#to-video');
  await expect(page.locator('.modal')).toContainText('还没有接入视频模型');
  await page.click('.modal [data-close]');
  // 在接入配置页面添加
  await page.goto('/#/providers');
  await page.click('#add-media');
  await page.locator('.preset-card[data-v=seedance]').click();
  await page.fill('[data-cred=apiKey]', 'vk-test');
  await page.fill('[data-opt=baseUrl]', `${UP}/video/ark`);
  await page.click('#ok');
  const row = page.locator('#media-conns .conn', { hasText: 'Seedance' });
  await expect(row).toBeVisible();
  await row.locator('[data-act=test]').click();
  await expect(row.locator('[data-result]')).toContainText('没有扣费');
  // 从脚本生成
  await page.goto(`/#/scripts/${script.id}`);
  await page.click('#to-video');
  await expect(page.locator('#plan')).toContainText('个任务');
  await expect(page.locator('.modal .note-card')).toContainText('AI-generated');
  await page.click('#go');
  await expect(page).toHaveURL(/#\/scripts\/videos/);
  await expect(page.locator('.video-card video')).toBeVisible({ timeout: 40000 });
  const job = (await json(await page.request.get('/api/video-jobs'))).items[0];
  expect(job.status).toBe('done');
  expect(job.clips.every((c) => c.status === 'done')).toBeTruthy();
  const video = await page.request.get(`/api/media/${job.mediaId}?download=1`);
  expect(video.headers()['content-disposition']).toContain('attachment');
  expect((await video.body()).length).toBeGreaterThan(1000);
  // 每段裁到脚本要求的时长再合并（模拟服务的片段都是 6 秒）
  expect(Math.round(job.duration)).toBe(job.clips.reduce((a, c) => a + Math.min(c.target, 6), 0));
  const sent = (await (await fetch(`${UP}/sent`)).json()).video.filter((x) => x.vendor === 'seedance');
  expect(sent[0].body.ratio).toBe('9:16');
  expect(sent[0].body.duration).toBeGreaterThanOrEqual(4);
  expect(sent[0].body.content[0].text).toContain('No on-screen text');

  // 其余适配器：整条生成 / 带首帧图
  const png = fs.readFileSync(path.join(__dirname, '..', 'extension', 'icon128.png'));
  const image = await json(await page.request.post('/api/media/image', { multipart: { image: { name: 'p.png', mimeType: 'image/png', buffer: png } } }));
  const adapters = [
    ['kling', { baseUrl: `${UP}/video/kling` }, { apiKey: 'vk-test' }],
    ['wan', { baseUrl: `${UP}/video/wan` }, { apiKey: 'vk-test' }],
    ['minimax', { baseUrl: `${UP}/video/mm`, durations: '6,10,15' }, { apiKey: 'vk-test' }],
    ['videocustom', { submitUrl: `${UP}/video/custom/submit`, queryUrl: `${UP}/video/custom/query/{{id}}`, submitBody: '{"m":"{{model}}","p":"{{prompt}}","d":{{duration}}}', taskIdPath: 'data.task_id', statusPath: 'state', doneValues: 'success', videoUrlPath: 'result.url', model: 'my-model', durations: '5-30' }, { apiKey: 'vk-test' }],
  ];
  for (const [vendor, options, creds] of adapters) {
    const c = await json(await page.request.post('/api/connectors', { data: { vendor, options, creds } }));
    await json(await page.request.post(`/api/connectors/${c.id}/test`));
    await json(await page.request.post('/api/video-jobs', { data: { scriptId: script.id, connectorId: c.id, mode: 'whole', imageMediaId: vendor === 'videocustom' ? undefined : image.id } }));
    await expect.poll(async () => (await json(await page.request.get('/api/video-jobs'))).items[0].status, { timeout: 30000, message: vendor }).toBe('done');
    const j = (await json(await page.request.get('/api/video-jobs'))).items[0];
    expect(j.vendor).toBe(vendor);
    expect(j.mediaId).toBeTruthy();
  }
  const all = (await (await fetch(`${UP}/sent`)).json()).video;
  const kling = all.find((x) => x.vendor === 'kling');
  expect(kling.path).toContain('/image-to-video/kling-3.0');
  expect(kling.body.contents[0].text).toMatch(/shot 1, \d+,/);
  expect(kling.body.settings.aspect_ratio).toBe('9:16');
  const wan = all.find((x) => x.vendor === 'wan');
  expect(wan.async).toBe('enable');
  expect(wan.body.input.media[0].type).toBe('first_frame');
  expect(all.find((x) => x.vendor === 'minimax').body.first_frame_image).toMatch(/^data:image/);
  expect(all.find((x) => x.vendor === 'custom').body.m).toBe('my-model');

  // 模型失败时给出原因，可以重试；删除任务会连文件一起删
  const c = (await json(await page.request.get('/api/connectors'))).items.find((x) => x.vendor === 'seedance');
  const delId = job.id;
  await json(await page.request.delete(`/api/video-jobs/${delId}`));
  expect((await page.request.get(`/api/media/${job.mediaId}`)).status()).toBe(404);
  for (const x of (await json(await page.request.get('/api/connectors'))).items.filter((i) => ['seedance', 'kling', 'wan', 'minimax', 'videocustom'].includes(i.vendor))) await json(await page.request.delete(`/api/connectors/${x.id}`));
  expect(c).toBeTruthy();
});
