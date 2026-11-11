// 批量出片和仿 CC Switch 的接入配置：中转站（new-api 格式）出图、出视频，质检，预算，价格表
// 外部服务都走 tests/fake-upstream.js 的模拟服务
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
// 删掉视频、图片等模型，以及除了模拟大模型以外的统一接入（里面可能启用了视频、图片模型）
async function clearMediaConnectors(page) {
  for (const c of (await json(await page.request.get('/api/connectors'))).items.filter((x) => ['video', 'image', 'vision', 'asr'].includes(x.kind) || (x.vendor === 'hub' && x.options.baseUrl !== `${UP}/v1`))) await json(await page.request.delete(`/api/connectors/${c.id}`));
}

let clipFile;
test.beforeAll(() => {
  clipFile = path.join(os.tmpdir(), `tk-studio-${process.pid}.mp4`);
  execFileSync(require('ffmpeg-static'), ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=15:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clipFile], { stdio: 'ignore' });
});
test.afterAll(() => fs.rmSync(clipFile, { force: true }));

test('接入配置：中转站一次接入全部模型，自动分类、按类型一键启用、读价格、原始 JSON 双向同步', async ({ page }) => {
  await admin(page);
  await clearMediaConnectors(page);
  await page.goto('/#/providers');
  await page.click('#add');
  await expect(page.locator('.modal h4', { hasText: '官方专用接口' })).toBeVisible();
  await expect(page.locator('.preset-card[data-v=videonewapi]')).toHaveCount(0);
  await page.locator('.preset-card[data-preset=relay]').click();
  await expect(page.locator('.cc-logo')).toBeVisible();
  await page.fill('.modal [name=name]', '我的中转站');
  await page.fill('[name=note]', '朋友推荐的中转站');
  const key = page.locator('[data-cred=apiKey]');
  await key.fill('sk-relay');
  await expect(key).toHaveAttribute('type', 'password');
  await page.click('[data-eye]');
  await expect(key).toHaveAttribute('type', 'text');
  await page.fill('[data-opt=baseUrl]', `${UP}/relay/v1/`);
  await expect(page.locator('.cc-tip').first()).toContainText('自动补 /v1');
  await page.click('#full');
  await expect(page.locator('#pv')).toHaveText(`POST ${UP}/relay/v1/chat/completions`);
  // 读模型列表：全部列出来、按名字分好类，单价从中转站价格表带上
  await page.click('#fm');
  await expect(page.locator('.cc-tr.hub[data-i]')).toHaveCount(8);
  const tip = page.locator('.cc-tip', { hasText: '读到 8 个模型' });
  await expect(tip).toContainText('文本 2');
  await expect(tip).toContainText('看图 1');
  await expect(tip).toContainText('图片 1');
  await expect(tip).toContainText('视频 3');
  const row = (id) => page.locator('.cc-tr.hub[data-i]', { has: page.locator(`[data-m=id][value="${id}"]`) });
  await expect(row('doubao-seedance-2.0-fast-720p').locator('[data-m=kind]')).toHaveValue('video');
  await expect(row('doubao-seedance-2.0-fast-720p').locator('[data-m=price]')).toHaveValue('0.672');
  await expect(row('doubao-seedance-2.0-fast-720p').locator('[data-m=unit]')).toHaveValue('秒');
  await expect(row('text-embedding-3-small').locator('[data-m=kind]')).toHaveValue('other');
  // 只看视频，一键启用这一类
  await page.locator('[data-ef=video]').click();
  await expect(page.locator('.cc-tr.hub[data-i]')).toHaveCount(3);
  await page.click('#all-on');
  await expect(page.locator('.cc-tr.hub[data-i] [data-m=on]:checked')).toHaveCount(3);
  await page.locator('[data-ef=all]').click();
  // 原始 JSON 改了，表单跟着变
  await page.locator('#raw-box summary').click();
  const raw = JSON.parse(await page.locator('#raw').inputValue());
  raw.models.find((m) => m.id === 'doubao-seedance-2.0-fast-720p').label = 'Seedance Fast';
  await page.fill('#raw', JSON.stringify(raw));
  await page.click('#fmt');
  await expect(row('doubao-seedance-2.0-fast-720p').locator('[data-m=label]')).toHaveValue('Seedance Fast');
  await page.click('#ok');
  const card = page.locator('.mh-card', { hasText: '朋友推荐的中转站' });
  await expect(card.locator('.mh-count', { hasText: '视频' })).toContainText('视频 3/3');
  await card.locator('[data-act=test]').click();
  await expect(card.locator('[data-result]')).toContainText('没有扣费');
  const saved = (await json(await page.request.get('/api/connectors'))).items.find((x) => x.vendor === 'hub' && x.name === '我的中转站');
  expect(saved.options.baseUrl).toBe(`${UP}/relay/v1`);
  expect(saved.models.find((m) => m.id === 'doubao-seedance-2.0-fast-720p')).toEqual(expect.objectContaining({ label: 'Seedance Fast', kind: 'video', enabled: true, price: 0.672, unit: '秒' }));
  expect(saved.creds.apiKey).not.toBe('sk-relay');
  // 视频模型会出现在出片可选的模型里
  const studio = await json(await page.request.get('/api/studio'));
  expect(studio.video.find((x) => x.id === `${saved.id}:video`).models.map((m) => m.id)).toContain('doubao-seedance-2.0-fast-720p');
  // 编辑时密钥留空不会被清掉
  await card.locator('[data-act=edit]').click();
  await expect(page.locator('[data-cred=apiKey]')).toHaveValue(/••/);
  await page.click('#ok');
  await card.locator('[data-act=test]').click();
  await expect(card.locator('[data-result]')).toContainText('没有扣费');
  // 价格表：按秒、按张、按清晰度分档都能读
  const { prices } = await json(await page.request.post('/api/connectors/pricing', { data: { baseUrl: `${UP}/relay/v1` } }));
  expect(prices['doubao-seedream-5-0']).toMatchObject({ price: 0.288, unit: '张' });
  expect(prices['wan3.0-video']).toMatchObject({ price: 0.504, unit: '秒' });
  await json(await page.request.delete(`/api/connectors/${saved.id}`));
});

test('接入配置：选错成自定义接口时一键改用中转站；中转站只填域名自动补 /v1', async ({ page }) => {
  await admin(page);
  await clearMediaConnectors(page);
  await page.goto('/#/providers');
  await page.click('#add');
  await expect(page.locator('.preset-card.rec[data-preset=relay] .rec-tag')).toContainText('大多数中转站');
  await page.locator('.preset-card[data-v=videocustom]').click();
  await expect(page.locator('.cc-switch')).toContainText('一般的中转站');
  await page.fill('[data-cred=apiKey]', 'sk-relay');
  // 自定义接口的「获取模型列表」用提交地址推出来的 /v1
  await page.fill('[data-opt=submitUrl]', `${UP}/relay/v1/videos`);
  await page.click('#fm');
  await expect(page.locator('[data-add="wan3.0-video"]')).toBeVisible();
  // 改用中转站：Key 和地址带过去
  await page.click('#to-relay');
  await expect(page.locator('.cc-switch')).toHaveCount(0);
  await expect(page.locator('#proto')).toBeVisible();
  await expect(page.locator('[data-cred=apiKey]')).toHaveValue('sk-relay');
  await expect(page.locator('[data-opt=baseUrl]')).toHaveValue(`${UP}/relay/v1`);
  await page.fill('[data-opt=baseUrl]', `${UP}/`);
  await page.locator('[name=note]').click();
  await expect(page.locator('[data-opt=baseUrl]')).toHaveValue(`${UP}/v1`);
  await page.locator('.modal [data-close]').first().click();
  // 服务端同样补 /v1：读模型列表和保存都是
  expect((await json(await page.request.post('/api/connectors/models', { data: { vendor: 'hub', apiKey: 'sk-test', baseUrl: UP } }))).models.map((m) => m.id)).toContain('glm-test');
  expect((await json(await page.request.post('/api/connectors/models', { data: { vendor: 'videonewapi', apiKey: 'sk-test', baseUrl: UP } }))).models).toContain('glm-test');
  const c = await json(await page.request.post('/api/connectors', { data: { vendor: 'hub', creds: { apiKey: 'sk-test' }, options: { baseUrl: `${UP}/` }, models: [{ id: 'glm-test', kind: 'text', enabled: true }] } }));
  expect(c.options.baseUrl).toBe(`${UP}/v1`);
  await json(await page.request.delete(`/api/connectors/${c.id}`));
});

test('批量出片：上传素材 → 估算和预算 → 关键帧质检 → 换图重出 → 只为勾选的生成视频 → 复检 → 清单 → 删除', async ({ page }) => {
  test.setTimeout(120000);
  await admin(page);
  await useFakeLlm(page);
  await clearMediaConnectors(page);
  const video = await json(await page.request.post('/api/connectors', { data: { vendor: 'videonewapi', name: '我的中转站', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1` }, models: [{ label: 'Seedance Fast', id: 'doubao-seedance-2.0-fast-720p', price: 0.672, unit: '秒' }] } }));
  const image = await json(await page.request.post('/api/connectors', { data: { vendor: 'imageopenai', name: '我的中转站 · 出图', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1` }, models: [{ label: 'Seedream 5.0', id: 'doubao-seedream-5-0', price: 0.288 }] } }));
  expect((await json(await page.request.post(`/api/connectors/${image.id}/test`))).message).toContain('没有扣费');

  // 估算：先出图再出片 vs 直接出片
  const est = await json(await page.request.post('/api/studio/estimate', { data: { videoConnectorId: video.id, imageConnectorId: image.id, count: 4, candidates: 2, duration: 5, passRate: 0.5 } }));
  expect(est.image.yuan).toBeCloseTo(8 * 0.288, 2);
  expect(est.video.perVideo).toBeCloseTo(3.36, 2);
  expect(est.total).toBeCloseTo(2.3 + 13.44, 1);
  expect(est.directTotal).toBeCloseTo(26.88, 2);
  const over = await page.request.post('/api/studio', { data: { videoConnectorId: video.id, imageConnectorId: image.id, count: 4, candidates: 2, duration: 5, budget: 5, productName: 'Gold Anklet' } });
  expect(over.status()).toBe(400);
  expect(await over.text()).toContain('超过预算');

  // 页面：上传一张商品图和一段视频（视频截 3 帧）
  await page.goto('/#/scripts/studio');
  await expect(page.locator('.studio-why')).toBeVisible();
  await page.setInputFiles('#files', [path.join(__dirname, '..', 'extension', 'icon128.png'), clipFile]);
  await expect(page.locator('#assets .asset')).toHaveCount(4);
  await expect(page.locator('#assets .asset i', { hasText: '视频截帧' })).toHaveCount(3);
  await page.fill('#pname', 'Waterproof Gold Anklet');
  await page.fill('#points', '18K 镀金不锈钢，防水不褪色');
  await page.fill('#count', '4');
  await page.fill('#budget', '30');
  await expect(page.locator('#est')).toContainText('比直接出片省');
  await page.click('#go');
  await expect(page).toHaveURL(/#\/scripts\/studio\/st_/);
  const id = page.url().split('/').pop();
  await expect(page.locator('.studio-head .clip')).toHaveText('待确认', { timeout: 40000 });
  let b = await json(await page.request.get(`/api/studio/${id}`));
  // 模型只写了 3 条，第 4 条用模板补上；每条的钩子都不一样
  expect(b.briefs).toHaveLength(4);
  expect(new Set(b.briefs.map((x) => x.hookId)).size).toBe(4);
  expect(b.briefs[3].angle).toContain('×');
  expect(b.briefs.every((x) => x.candidates.length === 2 && x.candidates.every((c) => c.status === 'done' && c.qc && !c.qc.skipped))).toBeTruthy();
  expect(b.refs).toHaveLength(4);
  // 每 3 张有 1 张商品不像：它不会被选中
  for (const x of b.briefs) if (x.pick != null && x.candidates[x.pick].qc.pass === false) expect(x.candidates.every((c) => c.qc.pass === false)).toBeTruthy();
  expect(b.spent.images).toBe(8);
  const sentImg = (await (await fetch(`${UP}/sent`)).json()).image;
  const last = sentImg.at(-1);
  expect(last.model).toBe('doubao-seedream-5-0');
  expect(last.image).toHaveLength(4);
  expect(last.image[0]).toMatch(/^data:image\/jpeg;base64,/);
  expect(last.prompt).toContain('same shape, color, material');
  await expect(page.locator('.brief')).toHaveCount(4);
  await expect(page.locator('.brief .qc').first()).toBeVisible();

  // 第 1 条写意见再出一张：自动选中新的那张
  const first = page.locator('.brief[data-n="1"]');
  await first.locator('[data-note]').fill('hand closer to the camera');
  await first.locator('[data-regen]').click();
  await expect(first.locator('.kf')).toHaveCount(3);
  b = await json(await page.request.get(`/api/studio/${id}`));
  expect(b.briefs[0].pick).toBe(2);
  expect((await (await fetch(`${UP}/sent`)).json()).image.at(-1).prompt).toContain('hand closer to the camera');
  // 第 2 条不要；改一下第 3 条的屏幕字
  await page.locator('.brief[data-n="2"] .switch span').click();
  await expect.poll(async () => (await json(await page.request.get(`/api/studio/${id}`))).briefs[1].approved).toBe(false);
  await page.locator('.brief[data-n="3"] [data-edit=caption]').fill('No green skin, ever');
  await page.locator('.brief[data-n="3"] [data-edit=caption]').blur();
  await expect.poll(async () => (await json(await page.request.get(`/api/studio/${id}`))).briefs[2].caption).toBe('No green skin, ever');
  for (const n of [1, 3, 4]) await json(await page.request.patch(`/api/studio/${id}/briefs/${n}`, { data: { approved: true } }));

  await page.reload();
  await expect(page.locator('#render')).toContainText('生成 3 条视频');
  await page.click('#render');
  await expect(page.locator('.studio-head .clip')).toHaveText('完成', { timeout: 60000 });
  b = await json(await page.request.get(`/api/studio/${id}`));
  const done = b.briefs.filter((x) => x.video?.status === 'done');
  expect(done.map((x) => x.n)).toEqual([1, 3, 4]);
  expect(b.briefs[1].video).toBeFalsy();
  expect(done.every((x) => x.video.qc && !x.video.qc.skipped)).toBeTruthy();
  expect(b.spent.videos).toBe(3);
  expect(b.spent.videoYuan).toBeCloseTo(3 * 3.36, 2);
  const relay = (await (await fetch(`${UP}/sent`)).json()).video.filter((x) => x.vendor === 'relay').slice(-3);
  expect(relay[0].body.model).toBe('doubao-seedance-2.0-fast-720p');
  expect(relay[0].body.aspect_ratio).toBe('9:16');
  expect(relay[0].body.images[0]).toMatch(/^data:image\//);
  expect(relay[0].body.prompt).toContain('no morphing');
  await expect(page.locator('.brief video')).toHaveCount(3);
  // 发布清单
  const md = await (await page.request.get(`/api/studio/${id}/export`)).text();
  expect(md).toContain('No green skin, ever');
  expect(md).toContain('AI-generated content');
  // 删除：文件一起删
  const mid = done[0].video.mediaId;
  await json(await page.request.delete(`/api/studio/${id}`));
  expect((await page.request.get(`/api/media/${mid}`)).status()).toBe(404);
});

test('批量出片：不用图片模型时直接出片，参考图交给视频模型', async ({ page }) => {
  test.setTimeout(60000);
  await admin(page);
  await useFakeLlm(page);
  await clearMediaConnectors(page);
  const video = await json(await page.request.post('/api/connectors', { data: { vendor: 'videonewapi', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1`, model: 'wan3.0-video' } } }));
  const png = fs.readFileSync(path.join(__dirname, '..', 'extension', 'icon128.png'));
  const up = await json(await page.request.post('/api/studio/assets', { multipart: { files: { name: 'p.png', mimeType: 'image/png', buffer: png } } }));
  const est = await json(await page.request.post('/api/studio/estimate', { data: { videoConnectorId: video.id, direct: true, count: 2 } }));
  expect(est.mode).toBe('direct');
  expect(est.missing[0]).toContain('wan3.0-video');
  const b = await json(await page.request.post('/api/studio', { data: { videoConnectorId: video.id, direct: true, count: 2, productName: 'Anklet', assetIds: up.items.map((x) => x.id) } }));
  await expect.poll(async () => (await json(await page.request.get(`/api/studio/${b.id}`))).status, { timeout: 30000 }).toBe('review');
  await json(await page.request.post(`/api/studio/${b.id}/render`));
  await expect.poll(async () => (await json(await page.request.get(`/api/studio/${b.id}`))).status, { timeout: 30000 }).toBe('done');
  const relay = (await (await fetch(`${UP}/sent`)).json()).video.filter((x) => x.vendor === 'relay').slice(-2);
  expect(relay[0].body.images[0]).toMatchObject({ role: 'reference_image' });
  expect(relay[0].body.resolution).toBe('720p');
  await json(await page.request.delete(`/api/studio/${b.id}`));
  await clearMediaConnectors(page);
});

test('批量出片：视频格式、统一人物、10 秒多镜头、字幕文件；爆款没拆完时说明原因', async ({ page }) => {
  test.setTimeout(90000);
  await admin(page);
  await useFakeLlm(page);
  await clearMediaConnectors(page);
  const video = await json(await page.request.post('/api/connectors', { data: { vendor: 'videonewapi', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1` }, models: [{ id: 'doubao-seedance-2.0-fast-720p', price: 0.672 }] } }));
  const image = await json(await page.request.post('/api/connectors', { data: { vendor: 'imageopenai', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1` }, models: [{ id: 'doubao-seedream-5-0', price: 0.288 }] } }));
  const png = fs.readFileSync(path.join(__dirname, '..', 'extension', 'icon128.png'));
  const prod = await json(await page.request.post('/api/studio/assets', { multipart: { files: { name: 'p.png', mimeType: 'image/png', buffer: png } } }));
  const person = await json(await page.request.post('/api/studio/assets', { multipart: { files: { name: 'model.png', mimeType: 'image/png', buffer: png } } }));
  const base = { videoConnectorId: video.id, imageConnectorId: image.id, count: 2, candidates: 1, duration: 10, productName: 'Gold Anklet', assetIds: prod.items.map((x) => x.id) };
  const bad = await page.request.post('/api/studio', { data: { ...base, viralId: 'vi_nope' } });
  expect(bad.status()).toBe(400);
  expect(await bad.text()).toContain('还没有拆解完');
  const b = await json(await page.request.post('/api/studio', { data: { ...base, format: 'tryon', personAssetIds: person.items.map((x) => x.id) } }));
  await expect.poll(async () => (await json(await page.request.get(`/api/studio/${b.id}`))).status, { timeout: 30000 }).toBe('review');
  let v = await json(await page.request.get(`/api/studio/${b.id}`));
  expect(v.formatName).toBe('上身试戴');
  expect(v.briefs.every((x) => ['wear', 'mirror', 'scale'].includes(x.sceneId))).toBeTruthy();
  // 模型只写了 1 条，第 2 条模板补上：带人物和多镜头
  expect(v.briefs[1].keyframe).toContain('same person as in image 2');
  expect(v.briefs[1].motion).toContain('Then cut to');
  const img = (await (await fetch(`${UP}/sent`)).json()).image.at(-1);
  expect(img.image).toHaveLength(2);
  await json(await page.request.post(`/api/studio/${b.id}/render`));
  await expect.poll(async () => (await json(await page.request.get(`/api/studio/${b.id}`))).status, { timeout: 30000 }).toBe('done');
  const relay = (await (await fetch(`${UP}/sent`)).json()).video.filter((x) => x.vendor === 'relay').at(-1);
  expect(relay.body.duration).toBe(10);
  const srt = await (await page.request.get(`/api/studio/${b.id}/briefs/1/srt`)).text();
  expect(srt).toContain('00:00:00,000 --> 00:00:03,000\nHook 1');
  expect(srt).toContain('Line 1');
  await json(await page.request.delete(`/api/studio/${b.id}`));
  await clearMediaConnectors(page);
});
