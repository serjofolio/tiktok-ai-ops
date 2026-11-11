// 模型只接入一次：文本、图片、视频模型自动分类、单独开关；首选出错（没额度等）自动换下一个启用的；旧配置自动合并
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

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
const sent = async () => (await fetch(`${UP}/sent`)).json();

test('出错自动换模型：首选文本模型没额度时换备用，视频模型提交失败时换下一个；在列表里开关模型、设首选', async ({ page }) => {
  test.setTimeout(120000);
  await admin(page);
  for (const c of (await json(await page.request.get('/api/connectors'))).items.filter((x) => ['video', 'image', 'vision', 'asr'].includes(x.kind) || (x.vendor === 'hub' && x.options.baseUrl !== `${UP}/v1`))) await json(await page.request.delete(`/api/connectors/${c.id}`));
  const hub = await json(await page.request.post('/api/connectors', { data: { vendor: 'hub', name: '同一个中转站', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1/` }, models: [
    { id: 'broke-text', kind: 'text', enabled: true }, { id: 'glm-test', kind: 'text', enabled: true },
    { id: 'broke-video', kind: 'video', enabled: true }, { id: 'doubao-seedance-2.0-fast-720p', kind: 'video', enabled: true, price: 0.672, unit: '秒' },
    { id: 'doubao-seedream-5-0', kind: 'image', enabled: false }, { id: 'glm-4.6v', kind: 'vision', enabled: false },
  ] } }));
  expect(hub.options.baseUrl).toBe(`${UP}/relay/v1`);

  // 文本：首选设成没额度的模型 → 调用时自动换成同一个接入里的 glm-test，结果正常
  await json(await page.request.put('/api/models/prefs', { data: { kind: 'text', ref: `${hub.id}|broke-text`, autoFallback: true } }));
  const before = (await sent()).broke || 0;
  const pains = await json(await page.request.post('/api/scripts/pains', { data: { productName: 'Gold Hoop Earrings', productDesc: '14K 镀金' } }));
  expect(pains.pains.length).toBeGreaterThan(0);
  expect((await sent()).broke).toBe(before + 1);
  // 刚出错的往后放：接下来直接用备用的，不再先撞一次
  const st = await json(await page.request.get('/api/connectors'));
  expect(st.prefs.text).toBe(`${hub.id}|broke-text`);
  expect(st.primary.text).toMatch(/\|glm-test$/); // 换到哪个接入里的 glm-test 都行：首选之后按列表顺序
  await json(await page.request.post('/api/scripts/pains', { data: { productName: 'Gold Hoop Earrings' } }));
  expect((await sent()).broke).toBe(before + 1);

  // 视频：选了没额度的模型，提交失败 → 自动换成 Seedance，任务照常完成，记下换模型的原因
  const s = await json(await page.request.post('/api/scripts/manual', { data: { title: '换模型测试', shots: [{ prompt: 'A hand holds the earrings', duration: 5 }] } }));
  const { items: [job] } = await json(await page.request.post('/api/video-jobs/free', { data: { scriptId: s.id, connectorId: `${hub.id}:video`, model: 'broke-video', shots: [{ prompt: 'A hand holds the earrings', duration: 5 }] } }));
  await expect.poll(async () => (await json(await page.request.get('/api/video-jobs'))).items.find((j) => j.id === job.id).status, { timeout: 40000 }).toBe('done');
  const done = (await json(await page.request.get('/api/video-jobs'))).items.find((j) => j.id === job.id);
  expect(done.model).toBe('doubao-seedance-2.0-fast-720p');
  expect(done.fallbacks[0]).toMatchObject({ from: 'broke-video', to: 'doubao-seedance-2.0-fast-720p' });
  expect(done.fallbacks[0].error).toContain('402');

  // 关掉「出错自动换模型」：出错直接报错
  await json(await page.request.put('/api/models/prefs', { data: { autoFallback: false } }));
  const s2 = await json(await page.request.post('/api/scripts/manual', { data: { title: '不换模型', shots: [{ prompt: 'A hand holds the earrings', duration: 5 }] } }));
  const { items: [job2] } = await json(await page.request.post('/api/video-jobs/free', { data: { scriptId: s2.id, connectorId: `${hub.id}:video`, model: 'broke-video', shots: [{ prompt: 'x', duration: 5 }] } }));
  await expect.poll(async () => (await json(await page.request.get('/api/video-jobs'))).items.find((j) => j.id === job2.id).status, { timeout: 30000 }).toBe('error');
  await json(await page.request.put('/api/models/prefs', { data: { autoFallback: true } }));

  // 页面：模型开关按类型筛、单个开关、一键全部启用、设首选
  await page.goto('/#/providers');
  const card = page.locator('.mh-card', { hasText: '同一个中转站' });
  await expect(card.locator('.mh-count', { hasText: '图片' })).toContainText('图片 0/1');
  await card.locator('[data-act=models]').click();
  await card.locator('[data-f=image]').click();
  await expect(card.locator('.mh-row')).toHaveCount(1);
  await card.locator('.mh-row .switch').click();
  await expect(card.locator('.mh-count', { hasText: '图片' })).toContainText('图片 1/1');
  await card.locator('[data-f=all]').click();
  await card.locator('[data-all="1"]').click();
  await expect(card.locator('.mh-count', { hasText: '看图' })).toContainText('看图 1/1');
  // 认错的类型可以改
  await card.locator('.mh-row[data-m="glm-4.6v"] [data-kind]').selectOption('text');
  await expect(card.locator('.mh-count').first()).toContainText('文本 3/3');
  // 刚出错的 broke-text 排到后面，不再显示成首选；改成别的再设首选
  await expect(card.locator('.mh-row[data-m="broke-text"] [data-prefer]')).toBeVisible();
  await card.locator('.mh-row[data-m="glm-4.6v"] [data-prefer]').click();
  await expect(page.locator('[data-pref=text]')).toHaveValue(`${hub.id}|glm-4.6v`);
  await expect(card.locator('.mh-row[data-m="glm-4.6v"]')).toContainText('首选');
  // 「现在用的模型」里能换视频首选
  await expect(card).toContainText('首选视频');
  await page.locator('[data-pref=video]').selectOption(`${hub.id}|broke-video`);
  await expect.poll(async () => (await json(await page.request.get('/api/connectors'))).prefs.video).toBe(`${hub.id}|broke-video`);

  for (const id of [job.id, job2.id]) await json(await page.request.delete(`/api/video-jobs/${id}`));
  for (const id of [s.id, s2.id]) await json(await page.request.delete(`/api/scripts/${id}`));
  await json(await page.request.delete(`/api/connectors/${hub.id}`));
  const fake = (await json(await page.request.get('/api/providers'))).items.find((x) => x.baseUrl === `${UP}/v1`);
  if (fake) await json(await page.request.post(`/api/providers/${fake.id}/activate`));
});

test('模型那边繁忙（503）：同一段等一会儿自动再提交，不算失败；一直忙就换别家的模型，不换同一家的其他档位，也不换贵一倍以上的', async ({ page }) => {
  test.setTimeout(120000);
  await admin(page);
  for (const c of (await json(await page.request.get('/api/connectors'))).items.filter((x) => ['video', 'image', 'vision', 'asr'].includes(x.kind) || (x.vendor === 'hub' && x.options.baseUrl !== `${UP}/v1`))) await json(await page.request.delete(`/api/connectors/${c.id}`));
  const hub = await json(await page.request.post('/api/connectors', { data: { vendor: 'hub', name: '高峰期排队的中转站', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1` }, models: [
    { id: 'jam-video', kind: 'video', enabled: true, price: 0.3, unit: '秒' },
    { id: 'jam-video-hd', kind: 'video', enabled: true, price: 0.35, unit: '秒' }, // 同一家：一个在排队，另一个多半也在排队
    { id: 'wan3.0-video', kind: 'video', enabled: true, price: 9.9, unit: '秒' }, // 贵太多：不自动换过去
    { id: 'doubao-seedance-2.0-fast-720p', kind: 'video', enabled: true, price: 0.5, unit: '秒' },
    { id: 'busy-video', kind: 'video', enabled: true, price: 0.3, unit: '秒' },
  ] } }));
  const s = await json(await page.request.post('/api/scripts/manual', { data: { title: '排队测试', shots: [{ prompt: 'A hand holds the necklace', duration: 5 }] } }));
  const poll = (id) => expect.poll(async () => (await json(await page.request.get('/api/video-jobs'))).items.find((j) => j.id === id).status, { timeout: 40000 });
  const jobOf = async (id) => (await json(await page.request.get('/api/video-jobs'))).items.find((j) => j.id === id);

  // 关掉自动换模型：忙两次后第三次提交成功，还是原来的模型，这一段不算失败
  await json(await page.request.put('/api/models/prefs', { data: { autoFallback: false } }));
  const busyBefore = (await sent()).busyVideo || 0;
  const { items: [a] } = await json(await page.request.post('/api/video-jobs/free', { data: { scriptId: s.id, connectorId: `${hub.id}:video`, model: 'busy-video', shots: [{ prompt: 'A hand holds the necklace', duration: 5 }] } }));
  await poll(a.id).toBe('done');
  const doneA = await jobOf(a.id);
  expect(doneA.model).toBe('busy-video');
  expect(doneA.fallbacks || []).toHaveLength(0);
  expect(doneA.clips[0]).toMatchObject({ status: 'done', busy: 0 });
  expect((await sent()).busyVideo - busyBefore).toBe(3);
  await json(await page.request.put('/api/models/prefs', { data: { autoFallback: true } }));

  // 一直忙：忙两次后换成别家的 Seedance（跳过同一家的 jam-video-hd 和贵 30 倍的 wan3.0）
  const jamBefore = (await sent()).jam || 0;
  const { items: [b] } = await json(await page.request.post('/api/video-jobs/free', { data: { scriptId: s.id, connectorId: `${hub.id}:video`, model: 'jam-video', shots: [{ prompt: 'A hand holds the necklace', duration: 5 }] } }));
  await poll(b.id).toBe('done');
  const doneB = await jobOf(b.id);
  expect(doneB.model).toBe('doubao-seedance-2.0-fast-720p');
  expect(doneB.fallbacks).toHaveLength(1);
  expect(doneB.fallbacks[0]).toMatchObject({ from: 'jam-video', to: 'doubao-seedance-2.0-fast-720p' });
  expect(doneB.fallbacks[0].error).toContain('503');
  expect((await sent()).jam - jamBefore).toBe(2);
  // 视频库卡片写明自动换了哪个模型
  await page.goto('/#/scripts/videos');
  await expect(page.locator(`[data-job="${b.id}"]`)).toContainText('自动换了模型：jam-video → doubao-seedance-2.0-fast-720p');

  for (const id of [a.id, b.id]) await json(await page.request.delete(`/api/video-jobs/${id}`));
  await json(await page.request.delete(`/api/scripts/${s.id}`));
  await json(await page.request.delete(`/api/connectors/${hub.id}`));
});

test('写脚本时切到别的页面再回来：进度还在，写好的脚本自动出现在历史脚本里；款式名（tennis）带说明', async ({ page }) => {
  test.setTimeout(90000);
  await admin(page);
  const list = await json(await page.request.get('/api/providers'));
  let llm = list.items.find((x) => x.baseUrl === `${UP}/v1`);
  if (!llm) llm = await json(await page.request.post('/api/providers', { data: { name: '测试模型', protocol: 'openai', baseUrl: `${UP}/v1`, apiKey: 'sk-test', model: 'glm-test' } }));
  await json(await page.request.post(`/api/providers/${llm.id}/activate`));
  // 写一条要半分钟：这里让它慢 2.5 秒，够切走再回来
  await page.route('**/api/scripts/generate', async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  const glossBefore = (await sent()).glossary || 0;
  await page.goto('/#/scripts');
  await page.click('#srcs [data-src=manual]');
  await page.fill('#mname', 'Gold Tennis Necklace');
  await page.locator('#count').selectOption('1');
  const before = Number(await page.locator('#hist-n').textContent());
  await page.click('#gen');
  await page.click('#script-tabs [data-tab=videos]');
  await expect(page).toHaveURL(/#\/scripts\/videos/);
  await page.click('#script-tabs [data-tab=""]');
  await expect(page.locator('#gen-progress')).toContainText('正在写');
  await expect(page.locator('#gen')).toBeDisabled();
  await expect(page.locator('#hist-n')).toHaveText(String(before + 1), { timeout: 30000 });
  await expect(page.locator('#hist .list-item').first()).toHaveClass(/on/);
  await expect(page.locator('#gen')).toBeEnabled();
  await expect(page.locator('#gen-progress')).toHaveText('');
  expect((await sent()).glossary - glossBefore).toBeGreaterThan(0);
  const made = (await json(await page.request.get('/api/scripts'))).items[0];
  expect(made.productName).toBe('Gold Tennis Necklace');
  await json(await page.request.delete(`/api/scripts/${made.id}`));
});

test('旧配置自动合并：模型供应商和同一个中转站的视频连接器合成一个接入，误放的文字模型改回文本，老任务还能找到连接', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-migrate-'));
  const script = `
    const c = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'connectors.js'))});
    const s = { activeProviderId: 'pv_2', providers: [
      { id: 'pv_1', name: '智谱 GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'k1', model: 'glm-4.7' },
      { id: 'pv_2', name: 'wb', protocol: 'openai', baseUrl: 'https://relay.example.com', apiKey: 'k2', model: 'deepseek-v4-pro' } ],
      connectors: [
      { id: 'cn_old', vendor: 'videonewapi', name: '反代', creds: { apiKey: 'k2' }, options: { baseUrl: 'https://relay.example.com/v1', model: 'glm-5.3' }, models: [{ label: 'glm-5.3', id: 'glm-5.3' }, { label: '可灵', id: 'kling-video-v3', price: 0.5, unit: '秒' }] },
      { id: 'cn_hook', vendor: 'webhook', name: 'n8n', creds: { url: 'https://n8n.example.com/x' }, options: {} } ] };
    c.migrate(s);
    console.log(JSON.stringify(s));`;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, DATA_DIR: dir } }).toString());
  fs.rmSync(dir, { recursive: true, force: true });
  const hubs = out.connectors.filter((x) => x.vendor === 'hub');
  expect(hubs).toHaveLength(2);
  const wb = hubs.find((x) => x.name === 'wb');
  expect(wb.options.baseUrl).toBe('https://relay.example.com/v1');
  expect(wb.models.map((m) => `${m.id}:${m.kind}:${m.enabled}`)).toEqual(['deepseek-v4-pro:text:true', 'glm-5.3:text:true', 'kling-video-v3:video:true']);
  expect(wb.models.find((m) => m.id === 'kling-video-v3')).toMatchObject({ price: 0.5, unit: '秒' });
  expect(out.modelPrefs.text).toBe(`${wb.id}|deepseek-v4-pro`);
  expect(out.connectorAliases.cn_old).toBe(`${wb.id}:video`);
  expect(out.connectors.some((x) => x.id === 'cn_hook')).toBeTruthy();
  expect(out.connectors.some((x) => x.id === 'cn_old')).toBeFalsy();
  expect(out.providers).toEqual([]);
});
