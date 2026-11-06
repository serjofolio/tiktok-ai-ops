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

const PAGES = [['dashboard', '总览'], ['products', '智能选品'], ['pipeline', '自动上品'], ['scripts', '视频脚本'], ['knowledge', '知识库'], ['providers', '接入配置'], ['chat', 'Agent']];

test('导航与所有页面', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.nav a')).toHaveCount(7);
  // Agent 位于知识库、接入配置下面
  await expect(page.locator('.nav a').nth(6)).toHaveText('Agent');
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

test('智能选品：导入 FastMoss 真实导出 → 六维评分 → AI 选品报告 → 逐个研判', async ({ page }) => {
  await page.goto('/#/products');
  await expect(page.locator('.onboard')).toBeVisible();
  await page.click('#import');
  await page.setInputFiles('#file', path.join(__dirname, 'fixtures', 'fastmoss-my-3c.xlsx'));
  await expect(page.locator('#imp')).toContainText('自动识别了 22 列');
  await expect(page.locator('#imp')).toContainText('关键字段齐全');
  await page.click('#commit');
  await expect(page.locator('.prow')).toHaveCount(8);
  // 规则研判：定邀类目、品牌、刷单数据、客单价太低都直接判「不建议上」
  await expect(page.locator('.prow', { hasText: 'Bank Kuasa' })).toContainText('充电宝需定邀');
  await expect(page.locator('.prow', { hasText: 'UGREEN' })).toContainText('不建议上');
  await expect(page.locator('.prow', { hasText: 'Tali anti-hilang' })).toContainText('数据可疑');
  await expect(page.locator('.prow', { hasText: 'Handheld Fan' })).toContainText('客单价太低');
  const ear = page.locator('.prow', { hasText: 'Mini Sleep Earbuds' });
  await expect(ear).toContainText('RM34.57');
  await expect(ear).toContainText('2.41×');
  await expect(ear).toContainText('可以上');
  await expect(ear.locator('a[href*="detail/1730000000000000001"]')).toHaveCount(1);
  // 导入后自动生成 AI 选品报告（前面的用例已接入模拟大模型）
  await expect(page.locator('.rp-summary')).toContainText('睡眠耳机', { timeout: 20000 });
  await expect(page.locator('.opp')).toHaveCount(1);
  await expect(page.locator('.opp')).toContainText('RM29–35');
  await expect(page.locator('.seg-table')).toContainText('无线耳机');
  await expect(page.locator('.band').first()).toBeVisible();
  await expect(page.locator('.avoid')).toContainText('充电宝');
  await expect(page.locator('.prow .ai-dot')).toHaveCount(8, { timeout: 20000 });
  await expect(page.locator('.rv.v-go b')).toHaveText('2');
  await expect(page.locator('.rv.v-drop b')).toHaveText('4');
  // 点报告里的「不建议上」只看这一类
  await page.locator('.rv.v-drop').click();
  await expect(page.locator('.prow')).toHaveCount(4);
  await expect(page.locator('.rv.v-drop b')).toHaveText('4');
});

test('智能选品：商品详情 → 六维证据 → 人民币利润测算 → 评论 → 深度分析 → 生成脚本', async ({ page }) => {
  await page.goto('/#/products');
  await page.locator('.prow', { hasText: 'Mini Sleep Earbuds' }).click();
  await expect(page.locator('.dim')).toHaveCount(6);
  await expect(page.locator('.dim', { hasText: '增长趋势' })).toContainText('2.41 倍');
  await expect(page.locator('.dim', { hasText: '达人带货验证' })).toContainText('出单率 100%');
  await expect(page.locator('.ai-box')).toContainText('¥18–25');
  await expect(page.locator('.ext-links a', { hasText: '1688' })).toHaveAttribute('href', /keywords=%E7%9D%A1%E7%9C%A0.*&charset=utf8/); // 不带 charset 1688 会按 GBK 解码成乱码
  await expect(page.locator('.profit-table')).toContainText('采购 + 物流最多');
  // 1688 采购价 ¥20 + 物流 ¥5：RM34.57 扣平台 14% + 每单 RM0.54、佣金 8%、退货 5%、广告 10% → 净利率 17.6%
  await page.fill('#cost', '20');
  await page.fill('#ship', '5');
  await expect(page.locator('.profit-table')).toContainText('17.6%');
  await page.fill('#reviews', 'Sakit telinga bila tidur mengiring. 侧睡压耳朵，戴久了疼');
  await page.locator('#reviews').blur();
  await expect(page.locator('.toast').last()).toContainText('评论已保存');
  await page.locator('[data-j=visual] [data-v=true]').click();
  await page.locator('[data-j=wantBuy] [data-v=true]').click();
  await page.click('#ai');
  await expect(page.locator('.analysis')).toContainText('理由');
  await expect(page.locator('.analysis')).toContainText('止损线');
  await page.locator('[data-st=testing]').click();
  await page.locator('#pf a', { hasText: '生成视频脚本' }).click();
  await expect(page).toHaveURL(/#\/scripts\/new\//);
  await expect(page.locator('#pid option:checked')).toContainText('Mini Sleep Earbuds');
  await expect(page.locator('#manual')).toBeHidden();
  await page.locator('details.more summary').click();
  await page.fill('#bench', 'POV: you finally sleep on your side...');
  await page.locator('#count').selectOption('1');
  await page.click('#gen');
  await expect(page.locator('.scene2')).toHaveCount(3);
  await expect(page.locator('.hook-box')).toContainText('Stop sweating');
  await expect(page.locator('#hist .list-item')).toHaveCount(1);
});

test('智能选品：粘贴美区表格（$ 售价）与利润测算参数', async ({ page }) => {
  await page.goto('/#/products');
  await page.click('#import');
  await page.fill('#paste', '商品名称\t售价\t近7天销量\t7天销售额\t28天销量\t带货达人数\t带货视频数\t佣金率\t类目\t店铺\nLED Strip Lights\t$12.50\t5000\t62500\t16000\t300\t900\t15%\tHome\tGlowShop');
  await page.click('#parse');
  await expect(page.locator('[data-f=gmv]')).toHaveValue('3');
  await page.locator('#autoai').uncheck();
  await page.click('#commit');
  const row = page.locator('.prow', { hasText: 'LED Strip Lights' });
  await expect(row).toContainText('$12.50');
  await expect(row).toContainText('1.25×');
  await page.click('#assume');
  await expect(page.locator('.modal')).toContainText('马来西亚');
  await page.fill('#af [name=targetMargin]', '30');
  await page.locator('#af [name=inv_charger]').check();
  await page.click('.modal #ok');
  await expect(page.locator('.toast').last()).toContainText('重新评估');
  // 有了充电类定邀资质，UGREEN 充电器不再因定邀拦截（但仍是品牌商品）
  await expect(page.locator('.prow', { hasText: 'UGREEN' })).not.toContainText('充电类目需定邀');
  await expect(page.locator('.prow', { hasText: 'UGREEN' })).toContainText('品牌商品');
});

test('数据源与 ERP：添加第三方 1688 接口和 Webhook、测试连接、生成插件令牌', async ({ page }) => {
  await page.goto('/#/providers');
  await expect(page.locator('#conns')).toContainText('浏览器插件采集');
  // 第三方 1688 数据接口（官方 API 申请不下来时的替代）
  await page.click('#add-conn');
  await expect(page.locator('.conn-pick')).toHaveCount(3);
  await expect(page.locator('.modal')).toContainText('妙手 ERP');
  await expect(page.locator('.modal')).toContainText('店小秘');
  await page.locator('.preset-card[data-v=onebound1688]').click();
  await page.fill('[data-cred=key]', 'k1688');
  await page.fill('[data-cred=secret]', 's1688');
  await page.fill('[data-opt=baseUrl]', `${UP}/1688`);
  await page.click('.modal #ok');
  const c1 = page.locator('.conn[data-id]', { hasText: '1688 数据接口' });
  await c1.locator('[data-act=test]').click();
  await expect(c1.locator('[data-result]')).toContainText('返回 4 个货源');
  // 密钥只显示脱敏值
  await c1.locator('[data-act=edit]').click();
  await expect(page.locator('[data-cred=secret]')).toHaveValue(/••/);
  await page.locator('.modal [data-close]').first().click();
  // 通用 Webhook（n8n / 影刀 / 自研 ERP）
  await page.click('#add-conn');
  await page.locator('.preset-card[data-v=webhook]').click();
  await page.fill('[data-cred=url]', `${UP}/webhook`);
  await page.fill('[data-cred=secret]', 'whsec');
  await page.click('.modal #ok');
  const c2 = page.locator('.conn[data-id]', { hasText: '通用 Webhook' });
  await c2.locator('[data-act=test]').click();
  await expect(c2.locator('[data-result]')).toContainText('连接成功');
  // 插件令牌只显示一次
  await page.click('#new-token');
  await expect(page.locator('#new-token-box .pw-box')).toContainText('tk_');
  await expect(page.locator('.token-row')).toHaveCount(1);
  const zip = await page.request.get('/extension.zip');
  expect(zip.status()).toBe(200);
  expect((await zip.body()).subarray(0, 2).toString()).toBe('PK');
});

test('1688 找货 → 比价矩阵 → 选定供应商 → 上架包 → 违禁词检查 → 推送 Webhook 上品', async ({ page }) => {
  await page.goto('/#/products');
  await page.locator('.prow', { hasText: 'Mini Sleep Earbuds' }).click();
  await page.locator('#pdtabs [data-tab=source]').click();
  await page.click('#src-go');
  await expect(page.locator('.src-table tbody tr')).toHaveCount(4, { timeout: 15000 });
  // 同款度最高、利润成立的排第一；详情接口补全了阶梯价、库存、重量
  const first = page.locator('.src-table tbody tr').first();
  await expect(first).toContainText('睡眠耳机无线蓝牙隐形');
  await expect(first).toContainText('96');
  await expect(first).toContainText('45g');
  await expect(first).toContainText('≥50：¥18.5');
  await expect(first).toContainText('广东 深圳');
  await first.locator('[data-choose]').click();
  await expect(page.locator('.toast').last()).toContainText('已选定供应商');
  await expect(first).toContainText('已选');
  // 上架包
  await page.locator('#pdtabs [data-tab=listing]').click();
  await page.click('#pk-build');
  await expect(page.locator('#pkf [name=titleLocal]')).toHaveValue(/Fon Telinga Tidur/, { timeout: 15000 });
  await expect(page.locator('.pk .flag-list')).toContainText('绝对化用语');
  await expect(page.locator('.pk .flag-list')).toContainText('100%');
  await expect(page.locator('#pkf [name=price]')).not.toHaveValue('');
  await expect(page.locator('#pk-push')).toBeDisabled();
  await page.fill('#pkf [name=titleEn]', 'Mini Sleep Earbuds Wireless for Side Sleepers');
  await page.click('#pk-approve');
  await expect(page.locator('.toast').last()).toContainText('上架包已确认');
  await page.click('#pk-push');
  await expect(page.locator('.toast').last()).toContainText('已推送到 ERP');
  const hook = await (await page.request.get(`${UP}/webhook/last`)).json();
  expect(hook.last.body.listing.titleEn).toBe('Mini Sleep Earbuds Wireless for Side Sleepers');
  expect(hook.last.body.source.offerId).toBe('880000001');
  expect(hook.last.signature).toMatch(/^sha256=/);
});

test('浏览器插件接口：用 API 令牌把 1688 页面上的货源发给商品', async ({ page, browser }) => {
  await page.goto('/#/providers');
  const t = await (await page.request.post('/api/tokens', { data: { name: '测试插件' } })).json();
  const ctx = await browser.newContext();
  const headers = { Authorization: `Bearer ${t.token}` };
  expect((await ctx.request.get('/api/ext/products')).status()).toBe(401);
  const list = await (await ctx.request.get('/api/ext/products', { headers })).json();
  const target = list.items.find((x) => /Titan Anti Habuk/.test(x.name));
  expect(target).toBeTruthy();
  const r = await ctx.request.post('/api/ext/offers', { headers: { ...headers, Origin: 'chrome-extension://abc' }, data: { productId: target.id, offers: [{ num_iid: '990001', detail_url: 'https://detail.1688.com/offer/990001.html', title: '防尘钢化膜 iPhone17 透明', price: '2.30', min_num: 10, location: '广东 广州' }] } });
  expect(r.ok()).toBeTruthy();
  expect((await r.json()).count).toBe(1);
  await ctx.close();
  await page.goto(`/#/products/${target.id}/source`);
  await expect(page.locator('.src-table')).toContainText('防尘钢化膜');
  await expect(page.locator('.src-table')).toContainText('浏览器插件');
});

test('自动上品流水线：研判 → 找货 → 选供应商 → 上架包 → 自动确认 → 推送', async ({ page }) => {
  await page.goto('/#/pipeline');
  await expect(page.locator('.rd.ok')).toHaveCount(4);
  await page.selectOption('#cf [name=scope]', 'all');
  await page.fill('#cf [name=topN]', '2');
  await page.locator('#cf .toggle').click();
  await page.click('#go');
  await expect(page.locator('.pl h3')).toHaveText('已完成', { timeout: 30000 });
  await expect(page.locator('.pl-st.ok')).toHaveCount(7);
  await expect(page.locator('.pl tbody tr')).toHaveCount(2);
  await expect(page.locator('.pl tbody')).toContainText('已推送到');
  const hook = await (await page.request.get(`${UP}/webhook/last`)).json();
  expect(hook.count).toBeGreaterThanOrEqual(3);
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
  for (const p of ['home', 'dashboard', 'products', 'pipeline', 'scripts', 'knowledge', 'providers', 'chat', 'account', 'admin']) {
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

test('智能选品：兼容其他格式的 Excel（标题行 + 百分比单元格 + 日期）', async ({ page }) => {
  await page.goto('/#/products');
  await page.click('#import');
  await page.setInputFiles('#file', path.join(__dirname, 'fixtures', 'fastmoss-sample.xlsx'));
  await page.locator('.map-details summary').click();
  for (const f of ['productId', 'price', 'sales7d', 'growth', 'creatorCount', 'videoCount', 'commissionRate', 'shop', 'category']) await expect(page.locator(`[data-f=${f}]`), f).not.toHaveValue('');
  await page.locator('#autoai').uncheck();
  await page.click('#commit');
  const row = page.locator('.prow', { hasText: 'Product 3 迷你风扇' });
  await expect(row).toContainText('0.93×');
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
