# TikTok 跨境电商运营台

面向 TikTok Shop 卖家的选品与内容工具：**FastMoss 数据选品 → 硬指标与利润测算 → AI 选品分析与测款方案 → 一键带货视频脚本**，配套 TikTok 官方文档知识库和可对话的 Agent。

## 功能

| 模块 | 能做什么 |
|---|---|
| 智能选品 | 页面写明选品思路（找潜力趋势 → 数据工具筛选 → 竞品分析 → 判断能否卖 → 测试方案 → 视频脚本）。导入 FastMoss 导出的 Excel/CSV 或直接粘贴表格，自动识别列；逐项检查「销量在增长、利润够、对标视频足够多、价格带、竞争分布、卖点能拍出来、自己也想买」；填入 1688 采购价和物流即算出单件净利；AI 说明为什么选、目标人群、卖点拍法、竞品切入点、风险、测款方案；附 FastMoss / TikTok / 1688 找货源链接 |
| 视频脚本 | 从选品库选商品（测款中、推荐测款优先），可贴对标视频文案，生成按「钩子 → 痛点 → 演示 → 证明 → 行动号召」组织的分镜脚本，含 3 个备选钩子用于 A/B 测款 |
| 知识库 | 上传 Word / PDF / Markdown / 网页，切片检索；飞书文档需先「下载为」Word/PDF 再上传 |
| 接入配置 | 类似 CC Switch：添加多个模型供应商（智谱 GLM、GLM 编码套餐、GLM Anthropic 协议、DeepSeek、Kimi、通义、豆包、OpenAI、Claude、自定义），一键启用、测试、从上游获取模型列表；FastMoss / 1688 接口凭证预留位 |
| Agent | 普通 AI 聊天界面，流式输出，可引用知识库并标注来源，显示思考过程，可随时停止 |

所有 AI 功能都调用你在「接入配置」里启用的真实模型，没有离线假数据。

### 自动上品：选品 → 1688 找货 → 上架包 → ERP
| 环节 | 有接口时 | 接口没申请下来时 |
|---|---|---|
| 选品数据 | FastMoss 开放接口（待官方文档） | 在「智能选品」导入 FastMoss 导出的 Excel |
| 1688 找货 | 1688 开放平台（官方）或第三方数据接口（万邦等 item_search / item_search_img / item_get） | 浏览器插件「运营台助手」：在 1688 搜索 / 以图搜 / 详情页一键发送货源；或手动添加 |
| 上品 | 妙手 ERP 开放平台（测试版，审核通过后核对接口路径） | 通用 Webhook：把上架包 POST 给 n8n、影刀 RPA 或自研 ERP；或导出 CSV |

- **找货**：AI 把 TikTok 标题提炼成 1688 中文搜索词，关键词 + 主图以图搜合并去重，补全详情后按比价矩阵排序（阶梯价 30%、库存深度 20%、发货地 15%、单件重量 15%、SKU 丰富度 10%、商品状态 10%），AI 判断同款度，按「采购 + 估算物流 ≤ 成本上限」标出利润是否成立。选定供应商后采购价和物流自动填进利润测算。
- **上架包**：站点本地语言 + 英文标题、5 条卖点、分段描述、搜索词、SKU、按目标利润倒推的定价；违禁词（绝对化、医疗功效、100%/guaranteed、站外引流、品牌名误用）和商品风险检查。人工确认后推送 ERP。
- **自动上品流水线**（导航「自动上品」）：选品数据 → AI 研判 → 1688 找货 → 选定供应商 → 上架包 → 人工确认（可设为全自动）→ 推送 ERP，每一步有状态和日志，缺接口的环节会停下来提示怎么补。
- **浏览器插件**：「接入配置 → 浏览器插件与 API 令牌」下载并生成令牌。插件和 n8n / 影刀等程序都用 `Authorization: Bearer tk_…` 调用 `/api/ext/*` 接口。

### 账号与数据隔离
- 首页无需登录；其他页面需要登录。**第一个注册的账号自动成为管理员**，并接管旧版单用户的数据和模型配置。
- 每个账号的商品、脚本、知识库、模型 Key、对话互相不可见；「运营参考（平台内置）」知识库所有人只读共享。
- 管理员在右上角菜单 →「用户管理」可开关注册、停用 / 启用账号、重置密码、设为管理员、删除账号（连同其数据）。
- 忘记管理员密码：停止服务后在服务器上执行 `node server/cli.js admin <用户名> [新密码]`（不填密码则随机生成），`node server/cli.js users` 列出所有账号。
- 密码用 scrypt 加盐哈希保存；登录凭证为 HttpOnly Cookie，30 天有效；同一 IP 连续输错 10 次锁定 15 分钟。

### 智谱 GLM 接入
- OpenAI 兼容（按量计费）：`https://open.bigmodel.cn/api/paas/v4`
- GLM 编码套餐（和 Codex 等工具同一套额度）：`https://open.bigmodel.cn/api/coding/paas/v4`
- Anthropic 协议：`https://open.bigmodel.cn/api/anthropic`（协议选 Anthropic，地址不要再加 /v1）

模型名填 `glm-4.6`、`glm-4.5-air` 等，以智谱控制台为准。

## Windows 启动

安装 [Node.js 18+](https://nodejs.org/zh-cn/download)，双击 `start.bat`，浏览器打开 `http://localhost:3800`。

## 测试

```bash
npm install && npx playwright install chromium
npm test   # Playwright 无头；使用本地模拟大模型上游（tests/fake-upstream.js）验证真实调用链路
```

## ☁️ 服务器部署（Cloudflare 隧道）

在你自己的电脑上执行一条命令即可完成：打包 → 上传 → 安装 Node.js 运行时与生产依赖 → systemd 服务 → Cloudflare 隧道。

```powershell
# Windows（项目根目录）
powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1
# macOS / Linux
./deploy/deploy.sh root@你的服务器IP
```

- 服务以 `tkagent` 账户运行，**只监听 `127.0.0.1:5100`**，外网无法通过 IP+端口访问；防火墙再额外拦截 5100。
- `ALLOWED_HOSTS` 只放行隧道域名，其它 Host 头一律 403。
- 隧道 token 放在 `deploy/deploy.env`（`CF_TUNNEL_TOKEN=...`，已被 git 忽略），部署时上传并在服务器上读取后删除。
- 在 Cloudflare Zero Trust → Tunnels → Public Hostname 中把域名指向 `http://127.0.0.1:5100`。
- 数据目录 `/var/lib/tkagent`，日志 `journalctl -u tkagent -f`，重新部署直接再次运行脚本（数据保留）。

