// AI 出片创作台：不依赖脚本写分镜 → 优化提示词 → 插入 / 移动 / 删除镜头 → AI 出首帧 → 多版本生成；脚本导入后改了再存
const { test, expect } = require('@playwright/test');
const path = require('path');

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
async function clearMediaConnectors(page) {
  for (const c of (await json(await page.request.get('/api/connectors'))).items.filter((x) => ['video', 'image', 'vision', 'asr'].includes(x.kind))) await json(await page.request.delete(`/api/connectors/${c.id}`));
}

test('AI 出片：自己写分镜，不用等脚本；插入、移动、删除镜头；AI 出首帧；两个版本；存成脚本再导入修改', async ({ page }) => {
  test.setTimeout(120000);
  await admin(page);
  await useFakeLlm(page);
  await clearMediaConnectors(page);
  await json(await page.request.post('/api/connectors', { data: { vendor: 'videonewapi', name: '我的中转站', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1` }, models: [{ label: 'Seedance Fast', id: 'doubao-seedance-2.0-fast-720p', price: 0.672, unit: '秒' }] } }));
  await json(await page.request.post('/api/connectors', { data: { vendor: 'imageopenai', name: '我的中转站 · 出图', creds: { apiKey: 'sk-relay' }, options: { baseUrl: `${UP}/relay/v1` }, models: [{ id: 'doubao-seedream-5-0', price: 0.288 }] } }));
  await page.goto('/#/scripts/create');
  await page.evaluate(() => localStorage.removeItem('create-draft'));
  await page.reload();
  await page.fill('#title', '项链镜前试戴');
  const shot = (i) => page.locator(`.shot[data-i="${i}"]`);
  await shot(0).locator('[data-k=prompt]').fill('女生在镜子前戴上项链，镜头慢慢推近');
  await shot(0).locator('[data-act=polish]').click();
  await expect(shot(0).locator('[data-k=prompt]')).toHaveValue(/fastens the necklace/);
  await expect(shot(0).locator('[data-note]')).toContainText('改成英文');
  // 插入、移动、删除
  await shot(0).locator('[data-act=insert]').click();
  await shot(1).locator('[data-k=prompt]').fill('Close-up of the pendant catching the light, slow orbit');
  await shot(1).locator('[data-k=duration]').fill('4');
  await shot(1).locator('[data-act=insert]').click();
  await expect(page.locator('.shot')).toHaveCount(3);
  await shot(2).locator('[data-k=prompt]').fill('temporary shot');
  await shot(2).locator('[data-act=up]').click();
  await expect(shot(1).locator('[data-k=prompt]')).toHaveValue('temporary shot');
  await shot(1).locator('[data-act=del]').click();
  await expect(page.locator('.shot')).toHaveCount(2);
  await expect(shot(1).locator('[data-k=prompt]')).toHaveValue(/pendant/);
  // 商品参考图 + AI 出首帧
  await page.setInputFiles('#reffiles', path.join(__dirname, '..', 'extension', 'icon128.png'));
  await expect(page.locator('#refs .asset')).toHaveCount(1);
  await shot(0).locator('[data-act=genimg]').click();
  await expect(shot(0).locator('.shot-frame img')).toBeVisible();
  const img = (await (await fetch(`${UP}/sent`)).json()).image.at(-1);
  expect(img.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(img.prompt).toContain('fastens the necklace');
  // 估算：两个版本
  await page.selectOption('#variants', '2');
  await expect(page.locator('#plan')).toContainText('4 个任务、18 秒');
  await expect(page.locator('#plan')).toContainText('¥12.10');
  // 存成脚本
  await page.click('#save');
  await expect(page.locator('.toast').last()).toContainText('已存成脚本');
  const saved = (await json(await page.request.get('/api/scripts'))).items.find((s) => s.title === '项链镜前试戴');
  expect(saved.scenes).toHaveLength(2);
  expect(saved.scenes[1].videoPrompt).toContain('pendant');
  // 生成
  const before = (await (await fetch(`${UP}/sent`)).json()).video.length;
  await page.click('#go');
  await expect(page).toHaveURL(/#\/scripts\/videos/);
  await expect.poll(async () => (await json(await page.request.get('/api/video-jobs'))).items.slice(0, 2).map((j) => j.status).join(), { timeout: 60000 }).toBe('done,done');
  const jobs = (await json(await page.request.get('/api/video-jobs'))).items.slice(0, 2);
  expect(jobs.map((j) => j.title).sort()).toEqual(['项链镜前试戴 · 版本 1', '项链镜前试戴 · 版本 2']);
  expect(jobs[0].model).toBe('doubao-seedance-2.0-fast-720p');
  const sent = (await (await fetch(`${UP}/sent`)).json()).video.slice(before).filter((x) => x.vendor === 'relay');
  expect(sent).toHaveLength(4);
  const first = sent.find((x) => /fastens/.test(x.body.prompt));
  const second = sent.find((x) => /catching the light/.test(x.body.prompt));
  expect(first.body.images[0]).toMatch(/^data:image\//); // 第 1 镜用自己的首帧
  expect(second.body.images[0]).toMatchObject({ role: 'reference_image' }); // 第 2 镜没有首帧，用商品参考图
  expect(second.body.prompt).toContain('no morphing');
  // 从脚本详情进来：导入、修改、保存回同一个脚本
  await page.goto(`/#/scripts/create/${saved.id}`);
  await expect(page.locator('.shot')).toHaveCount(2);
  await shot(1).locator('[data-act=insert]').click();
  await shot(2).locator('[data-k=prompt]').fill('Hands place the necklace in a gift box');
  await page.click('#save');
  await expect(page.locator('.toast').last()).toContainText('已存成脚本');
  const again = await json(await page.request.get(`/api/scripts/${saved.id}`));
  expect(again.scenes).toHaveLength(3);
  expect(again.check).toBeTruthy();
  // 这个文件排在最前面：把自己留下的东西清掉，后面的用例依赖干净的环境（没有模型、没有脚本、没有视频）
  await json(await page.request.delete(`/api/scripts/${saved.id}`));
  for (const j of (await json(await page.request.get('/api/video-jobs'))).items) await json(await page.request.delete(`/api/video-jobs/${j.id}`));
  for (const p of (await json(await page.request.get('/api/providers'))).items) await json(await page.request.delete(`/api/providers/${p.id}`));
  await clearMediaConnectors(page);
});
