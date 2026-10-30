// 端到端测试（Playwright 无头）：接入配置 → 选品导入与测算 → AI 分析 → 视频脚本 → Agent 流式聊天 → 知识库
// 大模型使用 tests/fake-upstream.js 提供的本地模拟上游（127.0.0.1:3902），走的是真实调用链路
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const UP = 'http://127.0.0.1:3902';
const ADMIN = { username: 'admin', password: 'admin-pass-123' };
// 以管理员身份登录（全新数据目录里第一个注册的账号就是管理员）
async function login(page, who = ADMIN) {
  const r = await page.request.post('/api/auth/login', { data: who });
  if (r.status() === 401) expect((await page.request.post('/api/auth/register', { data: who })).ok()).toBeTruthy();
}
let errors = [];
test.beforeEach(async ({ page }, info) => {
  if (!info.title.startsWith('账号')) await login(page);
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|status of (400|401|403|424|502)/.test(m.text()) && errors.push(m.text()));
});
test.afterEach(async () => {
  expect(errors, `页面存在 JS 错误：\n${errors.join('\n')}`).toEqual([]);
});

const PAGES = [['dashboard', '总览'], ['products', '智能选品'], ['scripts', '视频脚本'], ['knowledge', '知识库'], ['providers', '接入配置'], ['chat', 'Agent']];

test('导航与所有页面', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.nav a')).toHaveCount(6);
  // Agent 位于知识库、接入配置下面
  await expect(page.locator('.nav a').nth(5)).toHaveText('Agent');
  await expect(page.locator('#style-btn')).toHaveCount(0);
  for (const [p, title] of PAGES) {
    await page.goto(`/#/${p}`);
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(page.locator('#view .skeleton')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('#view')).not.toContainText('页面加载失败');
  }
});

test('未接入模型时给出明确提示', async ({ page }) => {
  await page.goto('/#/chat');
  await expect(page.locator('#inp')).toHaveAttribute('placeholder', /接入配置/);
  await expect(page.locator('#mode-chip')).toContainText('未接入大模型');
});

test('接入配置：预设、获取模型、启用、测试、错误提示', async ({ page }) => {
  await page.goto('/#/providers');
  await page.click('#add');
  await expect(page.locator('.preset-card', { hasText: '智谱 GLM 编码套餐' })).toBeVisible();
  // 智谱预设自动填好地址
  await page.locator('.preset-card', { hasText: '智谱 GLM（Anthropic 协议）' }).click();
  await expect(page.locator('#pf [name=baseUrl]')).toHaveValue('https://open.bigmodel.cn/api/anthropic');
  await page.click('#back');
  // 自定义：接到本地模拟上游
  await page.locator('.preset-card', { hasText: '自定义' }).click();
  await page.fill('#pf [name=name]', '测试 GLM');
  await page.fill('#pf [name=baseUrl]', `${UP}/v1`);
  await page.fill('#pf [name=apiKey]', 'sk-test');
  await page.click('#fetch');
  await expect(page.locator('#models [data-m]')).toHaveCount(2);
  await page.locator('#models [data-m=glm-test]').click();
  await expect(page.locator('#pf [name=model]')).toHaveValue('glm-test');
  await page.click('#save');
  await expect(page.locator('.provider-item.on')).toContainText('测试 GLM');
  await expect(page.locator('#mode-chip')).toContainText('glm-test');
  await page.locator('.provider-item.on [data-act=test]').click();
  await expect(page.locator('.provider-item.on [data-result]')).toContainText('连接成功');

  // Anthropic 协议的第二个供应商，地址多写了 /v1 也能用；Key 错误时给出原因
  await page.click('#add');
  await page.locator('.preset-card', { hasText: '自定义' }).click();
  await page.fill('#pf [name=name]', 'Anthropic 兼容');
  await page.locator('#proto [data-v=anthropic]').click();
  await page.fill('#pf [name=baseUrl]', `${UP}/anthropic/v1`);
  await page.fill('#pf [name=apiKey]', 'sk-wrong');
  await page.fill('#pf [name=model]', 'glm-test');
  await page.click('#save');
  const item = page.locator('.provider-item', { hasText: 'Anthropic 兼容' });
  await item.locator('[data-act=test]').click();
  await expect(item.locator('[data-result]')).toContainText('401');
  await item.locator('[data-act=edit]').click();
  await page.fill('#pf [name=apiKey]', 'sk-test');
  await page.click('#save');
  await item.locator('[data-act=test]').click();
  await expect(item.locator('[data-result]')).toContainText('连接成功');
  // 切回 OpenAI 兼容的那个
  await page.locator('.provider-item', { hasText: '测试 GLM' }).locator('[data-act=use]').click();
  await expect(page.locator('.provider-item.on')).toContainText('测试 GLM');
});

test('智能选品：粘贴 FastMoss 表格 → 识别列 → 利润测算 → AI 分析 → 生成脚本', async ({ page }) => {
  await page.goto('/#/products');
  await expect(page.locator('.step')).toHaveCount(6);
  await expect(page.locator('.criteria')).toContainText('对标视频');
  await expect(page.locator('.onboard')).toBeVisible();
  await page.click('#import');
  const tsv = '商品名称\t商品ID\t售价\t近7天销量\t销量增长率\t带货达人数\t带货视频数\t佣金率\t类目\t店铺\nMini Desk Fan\t1729384756102938475\t$15.99\t1.2万\t86%\t240\t120\t15%\t3C数码\tCoolShop\nOld Phone Case\t1729384756102938476\t$6.99\t800\t-35%\t12\t4\t10%\t3C数码\tCaseShop';
  await page.fill('#paste', tsv);
  await page.click('#parse');
  await expect(page.locator('[data-f=name]')).toHaveValue('0');
  await expect(page.locator('[data-f=growth]')).toHaveValue('4');
  await page.click('#commit');
  await expect(page.locator('.prow')).toHaveCount(2);
  const fan = page.locator('.prow', { hasText: 'Mini Desk Fan' });
  await expect(fan).toContainText('+86%');
  await expect(fan.locator('a[href*="fastmoss.com/zh/e-commerce/detail/1729384756102938475"]')).toHaveCount(1);
  await expect(page.locator('.prow', { hasText: 'Old Phone Case' })).toContainText('建议放弃');

  await fan.click();
  await expect(page.locator('.ck', { hasText: '销量在增长' })).toHaveClass(/pass/);
  await page.fill('#cost', '3');
  await page.fill('#ship', '2.5');
  await expect(page.locator('.profit-table')).toContainText('27.6%');
  await page.locator('[data-j=visual] [data-v=true]').click();
  await page.locator('[data-j=wantBuy] [data-v=true]').click();
  await expect(page.locator('#pd .verdict').first()).toHaveText('推荐测款');
  await page.click('#ai');
  await expect(page.locator('.analysis')).toContainText('为什么选');
  await expect(page.locator('.analysis')).toContainText('止损线');
  await page.locator('[data-st=testing]').click();
  await page.locator('#pf a', { hasText: '生成视频脚本' }).click();

  await expect(page).toHaveURL(/#\/scripts\/new\//);
  await expect(page.locator('#pid option:checked')).toContainText('Mini Desk Fan');
  await page.fill('#bench', 'POV: your desk is a sauna...');
  await page.click('#gen');
  await expect(page.locator('.scene2')).toHaveCount(3);
  await expect(page.locator('.hook-box')).toContainText('Stop sweating');
  await expect(page.locator('#hist .list-item')).toHaveCount(1);
});

test('智能选品：上传 CSV 文件与利润参数', async ({ page }) => {
  const csv = path.join(__dirname, '..', 'test-results', 'fastmoss.csv');
  fs.mkdirSync(path.dirname(csv), { recursive: true });
  fs.writeFileSync(csv, '﻿Product Name,Price,7d Sales,Growth,Creators,Videos,Category\nLED Strip,$12.50,5000,40%,300,90,Home\n');
  await page.goto('/#/products');
  await page.click('#import');
  await page.setInputFiles('#file', csv);
  await expect(page.locator('[data-f=price]')).toHaveValue('1');
  await page.click('#commit');
  await expect(page.locator('.prow', { hasText: 'LED Strip' })).toBeVisible();
  await page.click('#assume');
  await page.fill('#af [name=targetMargin]', '30');
  await page.click('.modal #ok');
  await expect(page.locator('.toast').last()).toContainText('重新测算');
});

test('Agent：流式回答、引用知识库、会话列表', async ({ page }) => {
  await page.goto('/#/chat');
  await expect(page.locator('.suggest')).toHaveCount(4);
  await page.fill('#inp', '视频前3秒怎么写钩子');
  await page.keyboard.press('Enter');
  await expect(page.locator('.msg.user')).toContainText('视频前3秒');
  await expect(page.locator('.msg.ai .md').last()).toContainText('前 3 秒要用痛点', { timeout: 15000 });
  await expect(page.locator('.msg.ai .cites details').first()).toBeVisible();
  await expect(page.locator('.msg.ai .think').last()).toContainText('思考过程');
  await expect(page.locator('#list .list-item')).toHaveCount(1);
  await expect(page.locator('#ctitle')).toContainText('视频前3秒');
  await page.click('#new');
  await expect(page.locator('.chat-empty')).toBeVisible();
});

test('知识库：上传文档、检索、飞书链接给出导出指引', async ({ page }) => {
  const doc = path.join(__dirname, '..', 'test-results', '售后话术.md');
  fs.mkdirSync(path.dirname(doc), { recursive: true });
  fs.writeFileSync(doc, '# 售后话术\n\n## 退款处理\n买家申请退款时，先安抚情绪，48 小时内给出解决方案，优先补发或部分退款，避免差评。');
  await page.goto('/#/knowledge');
  await expect(page.locator('.lark-guide')).toContainText('下载为');
  await page.locator('#kbs .list-item', { hasText: 'TikTok 官方文档' }).click();
  await page.setInputFiles('#file', doc);
  await expect(page.locator('#pane table tbody tr')).toHaveCount(1, { timeout: 10000 });
  await page.fill('#url', 'https://bytedance.sg.larkoffice.com/docx/P8EPd6xnMovSF9xKyuvlRDM2gWb');
  await page.click('#urlgo');
  await expect(page.locator('.toast').last()).toContainText(/飞书|无法访问/);
  await page.click('#tabs button[data-t=search]');
  await page.fill('#q', '退款 差评');
  await page.click('#s');
  await expect(page.locator('#hits .hit').first()).toContainText('售后话术');
});

test('总览：3D 主视觉、拖动旋转、统计', async ({ page }) => {
  await page.goto('/#/dashboard');
  await expect(page.locator('#headline')).toContainText('今天选出能卖的品');
  await expect(page.locator('#stage canvas.webgl')).toHaveCount(1);
  await expect(page.locator('.stat-strip > a')).toHaveCount(4);
  await expect(page.locator('.stat-value').first()).not.toHaveText('0');
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45, { steps: 8 });
  await expect(page.locator('#stage')).toHaveClass(/grabbing/);
  await page.mouse.up();
  await expect(page.locator('#stage')).not.toHaveClass(/grabbing/);
  const res = await page.request.get('/vendor/three/three.module.min.js');
  expect(res.ok()).toBeTruthy();
});

test('移动端布局不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const p of ['home', 'dashboard', 'products', 'scripts', 'knowledge', 'providers', 'chat', 'account', 'admin']) {
    await page.goto(`/#/${p}`);
    await expect(page.locator('#view .skeleton')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, p).toBeFalsy();
  }
  await page.click('#menu-btn');
  await expect(page.locator('#app')).toHaveClass(/nav-open/);
});

test('官网首页：首屏、轮播、集成墙、功能、流程、FAQ', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(/is-home/);
  await expect(page.locator('.lp-hero h1')).toContainText('把 FastMoss 数据');
  await expect(page.locator('#rot span.on')).toHaveCount(1);
  const first = await page.locator('#rot span.on').textContent();
  await expect(page.locator('#rot span.on')).not.toHaveText(first, { timeout: 5000 });
  await expect(page.locator('.logo-track span').first()).toBeVisible();
  await expect(page.locator('.bento > div')).toHaveCount(5);
  await expect(page.locator('.faq details')).toHaveCount(5);
  await page.locator('.lp-hero a', { hasText: '开始选品' }).click();
  await expect(page).toHaveURL(/#\/products/);
  await expect(page.locator('body')).not.toHaveClass(/is-home/);
});

test('页面自己会动：开启系统「减少动画」且不移动鼠标，画面仍在变化', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const p of ['home', 'dashboard', 'products']) {
    await page.goto(`/#/${p}`);
    await page.waitForTimeout(1500);
    const a = await page.screenshot();
    await page.waitForTimeout(1500);
    const b = await page.screenshot();
    expect(Buffer.compare(a, b), `${p} 页面静止不动`).not.toBe(0);
  }
  // 关键动画没有被系统设置关掉
  await page.goto('/#/home');
  await page.locator('.mock').waitFor();
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.mock')).animationName);
  expect(anim).toBe('mockSway');
});

test('页面大标题的强调词可见', async ({ page }) => {
  for (const p of ['products', 'scripts', 'knowledge', 'providers']) {
    await page.goto(`/#/${p}`);
    const em = page.locator('.page-hero h2 em .ch').first();
    await em.waitFor();
    await page.waitForTimeout(1200);
    const style = await em.evaluate((e) => { const s = getComputedStyle(e); return { color: s.color, opacity: s.opacity, clip: s.backgroundClip || s.webkitBackgroundClip }; });
    expect(style.color, p).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(Number(style.opacity), p).toBeGreaterThan(0.9);
  }
});

test('智能选品：导入 FastMoss 风格的 Excel（标题行 + 百分比单元格 + 日期）', async ({ page }) => {
  await page.goto('/#/products');
  await page.click('#import');
  await page.setInputFiles('#file', require('path').join(__dirname, 'fixtures', 'fastmoss-sample.xlsx'));
  await expect(page.locator('[data-f=name]')).not.toHaveValue('');
  for (const f of ['productId', 'price', 'sales7d', 'growth', 'creatorCount', 'videoCount', 'commissionRate', 'shop', 'category']) await expect(page.locator(`[data-f=${f}]`), f).not.toHaveValue('');
  await page.click('#commit');
  const row = page.locator('.prow', { hasText: 'Product 3 迷你风扇' });
  await expect(row).toContainText('-7%');
  await expect(row.locator('a[href*="detail/1729384756102900003"]')).toHaveCount(1);
});

test('首页按钮互不遮挡：流光按钮的高光扫过时不会盖住旁边的按钮', async ({ page }) => {
  await page.goto('/');
  const btns = page.locator('.lp-hero .ctas .btn');
  await expect(btns).toHaveCount(3);
  // 高光每 4.5 秒扫一次，连续采样 5 秒，每个按钮中心点命中的始终是它自己
  for (let t = 0; t < 25; t++) {
    const bad = await btns.evaluateAll((els) => els.filter((b) => {
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width * 0.3, r.top + r.height / 2);
      return !b.contains(hit);
    }).map((b) => b.textContent.trim()));
    expect(bad, '被遮挡的按钮').toEqual([]);
    await page.waitForTimeout(200);
  }
});

test('账号：未登录跳转登录页，登录失败提示，登录后回到原页面，退出登录', async ({ page }) => {
  await page.goto('/#/products');
  await expect(page).toHaveURL(/#\/login\/products/);
  expect((await page.request.get('/api/providers')).status()).toBe(401);
  // 首页无需登录
  await page.goto('/');
  await expect(page.locator('.lp-hero h1')).toBeVisible();
  await expect(page.locator('#account')).toContainText('登录');
  await page.goto('/#/login/products');
  await page.fill('[name=username]', ADMIN.username);
  await page.fill('[name=password]', 'wrong-password');
  await page.click('#go');
  await expect(page.locator('#err')).toContainText('用户名或密码错误');
  await page.fill('[name=password]', ADMIN.password);
  await page.click('#go');
  await expect(page).toHaveURL(/#\/products/);
  await expect(page.locator('#user-btn')).toContainText('admin');
  await expect(page.locator('#user-btn')).toContainText('管理员');
  await page.click('#user-btn');
  await page.click('#logout');
  await expect(page.locator('#account')).toContainText('登录');
  expect((await page.request.get('/api/products')).status()).toBe(401);
});

test('账号：其他用户注册后看不到管理员的模型配置、商品和知识库', async ({ page, browser }) => {
  // 管理员已有数据（前面的用例里接入了模型、导入了商品）
  await login(page);
  const adminProducts = (await (await page.request.get('/api/products')).json()).items;
  expect(adminProducts.length).toBeGreaterThan(0);
  const ctx = await browser.newContext();
  const bob = await ctx.newPage();
  await bob.goto('/#/login/register');
  await expect(bob.locator('#tabs button.on')).toHaveText('注册');
  await bob.fill('[name=username]', 'bob');
  await bob.fill('[name=password]', 'bob-pass-123');
  await bob.fill('[name=password2]', 'bob-pass-123');
  await bob.click('#go');
  await expect(bob).toHaveURL(/#\/dashboard/);
  await expect(bob.locator('#user-btn')).not.toContainText('管理员');
  await expect(bob.locator('#mode-chip')).toContainText('未接入大模型');
  const get = async (u) => (await bob.request.get('/api' + u)).json();
  expect((await get('/providers')).items).toEqual([]);
  expect((await get('/products')).items).toEqual([]);
  expect((await bob.request.get('/api/products/' + adminProducts[0].id)).status()).toBe(404);
  expect((await bob.request.delete('/api/products/' + adminProducts[0].id)).status()).toBe(404);
  // 内置知识库只读共享，自己的官方文档库是空的
  const kbs = (await get('/kbs')).items;
  expect(kbs.find((k) => k.builtin).readonly).toBe(true);
  expect(kbs.find((k) => k.official).docCount).toBe(0);
  expect((await bob.request.delete('/api/kbs/' + kbs.find((k) => k.builtin).id)).status()).toBe(403);
  await bob.goto('/#/knowledge/' + kbs.find((k) => k.builtin).id);
  await expect(bob.locator('#pane')).toContainText('只读');
  await expect(bob.locator('#dz')).toHaveCount(0);
  // 普通用户进不了用户管理
  expect((await bob.request.get('/api/admin/users')).status()).toBe(403);
  await bob.goto('/#/admin');
  await expect(bob).toHaveURL(/#\/dashboard/);
  await ctx.close();
});

test('账号：管理员管理用户、关闭注册、修改密码', async ({ page, browser }) => {
  await login(page);
  await page.goto('/#/admin');
  const row = page.locator('tr', { hasText: 'bob' });
  await expect(row).toBeVisible();
  await row.locator('[data-act=toggle]').click();
  await expect(row).toContainText('已停用');
  expect((await page.request.post('/api/auth/login', { data: { username: 'bob', password: 'bob-pass-123' } })).status()).toBe(403);
  await login(page);
  await page.goto('/#/admin');
  await page.locator('tr', { hasText: 'bob' }).locator('[data-act=toggle]').click();
  await expect(page.locator('tr', { hasText: 'bob' })).toContainText('正常');
  // 关闭注册
  await page.locator('.toggle').click();
  await expect(page.locator('#reg')).not.toBeChecked();
  const ctx = await browser.newContext();
  const r = await ctx.request.post(page.url().replace(/#.*/, '') + 'api/auth/register', { data: { username: 'carol', password: 'carol-pass-1' } });
  expect(r.status()).toBe(403);
  await ctx.close();
  await page.locator('.toggle').click();
  await expect(page.locator('#reg')).toBeChecked();
  // 修改密码后用新密码登录，再改回来
  await page.goto('/#/account');
  await page.fill('[name=oldPassword]', ADMIN.password);
  await page.fill('[name=newPassword]', 'new-pass-456');
  await page.fill('[name=newPassword2]', 'new-pass-456');
  await page.click('#save');
  await expect(page.locator('.toast').last()).toContainText('密码已修改');
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'new-pass-456' } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/auth/password', { data: { oldPassword: 'new-pass-456', newPassword: ADMIN.password } })).ok()).toBeTruthy();
});
