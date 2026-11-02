<div align="center">

# TikTok 运营台

**AI 驱动的 TikTok 跨境电商全链路运营系统**

选品研判 · 1688 找货比价 · AI 上架 · ERP 推送 · 带货脚本：一条多 Agent 流水线跑完

一个人，做完一个跨境团队的活。

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Chrome-MV3_插件-4285F4?logo=googlechrome&logoColor=white)
![Playwright](https://img.shields.io/badge/E2E-Playwright_24_用例-2EAD33?logo=playwright&logoColor=white)
![LLM](https://img.shields.io/badge/大模型-GLM_/_DeepSeek_/_Kimi_/_通义_/_Claude-8A2BE2)

<img src="docs/images/home.jpg" alt="TikTok 运营台首页" width="900">

</div>

---

## 为什么做这个

做 TikTok 东南亚跨境，一个商品从「看到数据」到「挂上店铺」要经过：数据工具里筛品、算利润、查侵权，在 1688 上反复搜索比价，写马来语 / 泰语上架资料，录进 ERP，再写带货视频脚本。这些工作通常要选品、采购、运营、内容 **4～5 个岗位、十几个人** 配合完成，大部分时间都花在重复判断和搬运上。

**TikTok 运营台把这条链路交给 AI Agent 接力完成**：人只在关键节点做决定，其他交给系统。

```mermaid
flowchart LR
    A[FastMoss<br>选品数据] --> B[研判 Agent<br>六维评分 + AI 结论]
    B --> C[找货 Agent<br>1688 关键词 + 以图搜]
    C --> D[采购 Agent<br>比价矩阵 + 同款判断]
    D --> E[上架 Agent<br>本地语言资料 + 定价]
    E --> F{人工确认}
    F --> G[上品 Agent<br>推送 ERP]
    B -.-> H[脚本 Agent<br>带货视频分镜]
```

## 核心能力

| | 能力 | 说明 |
|---|---|---|
| 🎯 | **多维度智能选品** | 导入 FastMoss 导出数据，从需求规模、增长趋势、达人带货、竞争格局、利润空间、风险六个维度打分，给出「可以上 / 谨慎测试 / 不建议上」和理由 |
| 🧠 | **AI 研判报告** | 整批商品的市场概览、机会方向、品型地图、价格带分析；逐个商品给出能不能做、怎么做、下一步 |
| 🛡️ | **硬性风险拦截** | 邀约类目、带电商品、品牌 / IP 侵权、疑似刷单数据自动识别；**规则优先，AI 不能把有硬伤的商品判成能上** |
| 💰 | **利润倒推** | 按站点平台费率、达人佣金、退货、广告费和汇率，算出单件净利和「采购 + 物流最多能花多少」 |
| 🔍 | **1688 找货比价** | AI 提炼中文搜索词，关键词 + 主图以图搜，比价矩阵排序，AI 判断同款度，标出利润是否成立 |
| ✍️ | **AI 上架包** | 本地语言 + 英文标题、5 条卖点、描述、搜索词、SKU、按目标利润定价；自动检查违禁词 |
| 🔗 | **ERP 一键推送** | 妙手 ERP、通用 Webhook（n8n / 影刀 / 自研 ERP）、CSV 导出；店小秘、马帮等预留接入 |
| ⚙️ | **多 Agent 流水线** | 7 个环节自动接力，每一步有状态和日志；缺接口时停下提示，可选全自动 |
| 🧩 | **浏览器插件** | 没有 1688 官方接口也能跑：插件自动搜索、上传主图以图搜、采集货源、补全详情 |
| 🎬 | **带货视频脚本** | 「钩子 → 痛点 → 演示 → 证明 → 行动号召」分镜脚本 + 3 个 A/B 测试钩子 |
| 📚 | **知识库 + Agent** | 上传运营资料切片检索，对话式 Agent 引用来源回答 |
| 👥 | **多账号与数据隔离** | 管理员 + 注册用户，商品、知识库、模型密钥按账号完全隔离，适合对外演示 |

---

## 功能详解

### 1. 智能选品：导入数据，AI 告诉你哪些能上、为什么

<img src="docs/images/products.jpg" alt="智能选品与 AI 研判报告" width="900">

- **零配置导入**：拖入 FastMoss 导出的 Excel / CSV，自动识别全部 22 个字段，兼容 `RM` 等币种前缀和区间价格。
- **六维评分**：
  - **需求规模**：近 7 天销量、销售额排名。
  - **增长趋势**：动销倍数，即近 7 天销量 ÷ 28 天周均。
  - **达人带货**：达人数、出单率、视频与直播数。
  - **竞争格局**：品牌垄断度。
  - **利润空间**：实际成交均价，并倒推成本上限。
  - **风险**：侵权、类目、带电、数据异常。
- **AI 研判报告**：
  - 市场一句话总结、机会方向（建议售价、差异化打法、1688 搜索词）。
  - 品型地图、价格带分布、品牌集中度、新品占比。
  - 每个商品的 AI 结论和理由。
- **数据可信度**：销量远超同类但达人很少、销量来源不明等异常数据标记为「数据可疑」，不计入市场统计。
- **工程上的稳健性**：AI 分批研判、并发调用；模型输出被截断时自动修复 JSON，失败时拆半重试；服务重启后任务可以恢复。

<img src="docs/images/product-analysis.jpg" alt="单品 AI 研判与维度评分" width="900">

### 2. 1688 找货：比价矩阵 + AI 同款判断

<img src="docs/images/product-sourcing.jpg" alt="1688 找货与比价矩阵" width="900">

| 维度 | 权重 | 看什么 |
|---|---|---|
| 阶梯价 | 30% | 起批价、批量价 |
| 库存深度 | 20% | 能不能稳定供货 |
| 发货地 | 15% | 广东、浙江等产业带优先 |
| 单件重量 | 15% | 决定跨境物流成本 |
| SKU 丰富度 | 10% | 款式、颜色可选 |
| 商品状态 | 10% | 是否在售 |

- AI 判断每个货源与 TikTok 商品的同款度（0～100），**同款优先，价格再低不是同款也没用**。
- 到手成本 = 采购价 + 估算跨境物流，直接和成本上限比较，红绿标出利润是否成立。
- 选定供应商后，采购价和物流自动写回利润测算。

### 3. AI 上架包：本地化资料 + 违禁词检查

<img src="docs/images/product-listing.jpg" alt="AI 上架包与违禁词检查" width="900">

- 按站点生成本地语言（马来语 / 泰语 / 越南语…）和英文标题、5 条卖点、分段描述、搜索词、SKU。
- 按目标利润率倒推售价。
- 违禁词检查：
  - 绝对化用语（best / No.1）、绝对承诺（100% / guaranteed）。
  - 医疗功效、站外引流。
  - 品牌名误用：自动识别 `for iPhone` 这类兼容写法，不误报。
- 人工确认后才能推送，推送成功后商品自动进入「测款中」。

### 4. 自动上品流水线：多 Agent 接力

<img src="docs/images/pipeline.jpg" alt="多 Agent 自动上品流水线" width="900">

- 7 个环节：选品数据 → AI 研判 → 1688 找货 → 选定供应商 → 生成上架包 → 人工确认 → 推送 ERP。
- 运行前检查大模型、选品数据、1688 找货、ERP 四项是否就绪，缺什么、去哪补一目了然。
- 可配置范围（最近一次导入 / 整个选品库）、取前 N 个「可以上」、同款度门槛、推送目标；人工确认可改为全自动。
- 中断后可以从断点继续。

### 5. 浏览器插件「运营台助手」：没有官方接口也能自动找货

1688 开放平台接口申请门槛高，妙手等 ERP 接口要审核。插件在你**自己已登录的浏览器**里完成采集：

- **自动关键词搜**：选好商品，插件打开 1688 搜索，像人一样浏览页面，采集结果卡片送回运营台。
- **自动以图搜**：插件把商品主图传进 1688「以图搜款」，自动点击「搜索」并采集结果。
- **自动补详情**：在后台依次打开排名靠前的详情页，补全阶梯价、库存、单件重量、发货地、SKU。
- **识别不依赖页面样式**：从详情链接、商品 ID 属性、埋点数据、页面内嵌数据多路识别，1688 改版也能工作；识别失败时自动把页面结构上报到运营台，便于快速修正。
- **防风控**：操作节奏随机，详情页间隔 8～15 秒，两次找货间隔至少 15 秒；弹出人机验证时暂停等你处理，之后 20 分钟内不再自动打开详情页。
- 插件和 n8n、影刀等外部程序统一用 API 令牌（`Authorization: Bearer tk_…`）调用 `/api/ext/*`。

### 6. 接入配置：多模型、多数据源、多 ERP

<img src="docs/images/providers.jpg" alt="接入配置" width="900">

| 类别 | 支持 |
|---|---|
| 大模型 | 智谱 GLM（按量 / 编码套餐 / Anthropic 协议）、DeepSeek、Kimi、通义千问、豆包、OpenAI、Claude、任意 OpenAI 兼容接口 |
| 1688 数据 | 1688 开放平台（官方签名调用）、第三方数据接口（关键词搜 / 以图搜 / 商品详情）、浏览器插件 |
| ERP | 妙手 ERP、通用 Webhook（HMAC 签名）、CSV 导出；店小秘、马帮、芒果店长、通途、领星、积加预留 |

---

## 系统架构

```mermaid
flowchart TB
    subgraph Client[客户端]
        W[运营台 Web<br>原生 ES Modules SPA]
        X[Chrome 插件<br>Manifest V3]
    end
    subgraph Server[服务端 Node.js 22 + Express 5]
        R[路由 / 鉴权 / 数据隔离<br>AsyncLocalStorage]
        S1[选品 · 研判]
        S2[找货 · 比价]
        S3[上架 · 推送]
        S4[流水线编排]
        S5[脚本 · 知识库 · Agent]
        DB[(JSON 存储<br>按账号隔离)]
    end
    subgraph External[外部服务]
        L[大模型 API]
        A[1688 接口]
        E[ERP / Webhook]
    end
    W --> R
    X -->|API 令牌| R
    X -->|自动采集| A1688[1688 网页]
    R --> S1 & S2 & S3 & S4 & S5
    S1 & S2 & S3 & S4 & S5 --> DB
    S1 & S2 & S3 & S5 --> L
    S2 --> A
    S3 --> E
```

| 目录 | 内容 |
|---|---|
| `server/services/selection.js` | 选品规则：站点费率、品型识别、六维评分、风险标记 |
| `server/services/report.js` | AI 研判报告：分批、并发、截断修复、重试、断点恢复 |
| `server/services/sourcing.js` | 1688 找货：搜索词、比价矩阵、同款判断、到手成本 |
| `server/services/listing.js` | 上架包、违禁词、定价、推送 |
| `server/services/pipeline.js` | 多 Agent 流水线编排 |
| `server/connectors.js` | 数据源 / ERP 连接器、签名、防内网访问 |
| `extension/` | 浏览器插件：任务调度、页面识别、自动操作 |
| `tests/` | Playwright 端到端测试 + 本地模拟上游（大模型 / 1688 / Webhook） |

## 安全设计

- **账号隔离**：商品、脚本、知识库、模型密钥、连接器全部按账号隔离；第一个注册的账号自动成为管理员。管理员可以开关注册、停用账号、重置密码、删除账号（连同数据）。
- **密码与会话**：scrypt 加盐哈希；HttpOnly 会话 Cookie；同一 IP 连续输错 10 次锁定 15 分钟；跨站请求来源校验。
- **API 令牌**：只显示一次，服务端只存哈希，可随时撤销。
- **防内网访问**：普通用户配置的接口地址不能指向服务器内网。
- **部署隔离**：服务只监听 `127.0.0.1`，外网只能经 Cloudflare 隧道和域名访问，IP 直连一律 403。
- **密钥不入库**：隧道令牌、服务器地址只放在被 git 忽略的 `deploy/deploy.env`。

---

## 快速开始

### Windows 本机
安装 [Node.js 18+](https://nodejs.org/zh-cn/download)，双击 `start.bat`，浏览器打开 `http://localhost:3800`，注册第一个账号（自动成为管理员）。

### macOS / Linux
```bash
npm install
npm start          # http://localhost:3800
```

### 接入大模型（以智谱 GLM 为例）
「接入配置 → 添加供应商」选择预设即可：
- OpenAI 兼容（按量计费）：`https://open.bigmodel.cn/api/paas/v4`
- GLM 编码套餐：`https://open.bigmodel.cn/api/coding/paas/v4`
- Anthropic 协议：`https://open.bigmodel.cn/api/anthropic`（协议选 Anthropic，地址不要再加 /v1）

### 安装浏览器插件
1. 「接入配置 → 浏览器插件与 API 令牌」：下载插件压缩包，生成令牌。
2. 解压得到 `tiktok-ops-helper` 文件夹（里面直接是 `manifest.json`）。
3. Chrome 打开 `chrome://extensions`，开启开发者模式，点 **「加载未打包的扩展程序」**（不是「打包扩展程序」），选择该文件夹。
4. 点插件图标，粘贴令牌，「保存并测试连接」。

## 部署（Cloudflare 隧道）

```bash
# deploy/deploy.env（已被 git 忽略）
CF_TUNNEL_TOKEN=...
DEPLOY_SERVER=root@你的服务器IP
ADMIN_USER=admin

./deploy/deploy.sh                                              # macOS / Linux
powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1    # Windows
```

一条命令完成：打包 → 上传 → 备份旧数据 → 安装 Node 运行时与依赖 → systemd 服务 → Cloudflare 隧道 → 健康检查。
- 数据目录 `/var/lib/tkagent`，备份在 `/var/backups/tkagent`，日志 `journalctl -u tkagent -f`。
- 忘记管理员密码：停止服务后执行 `node server/cli.js admin <用户名> [新密码]`；`node server/cli.js users` 列出所有账号。

## 测试

```bash
npm install && npx playwright install chromium
npm test
```

24 个 Playwright 端到端用例，覆盖注册登录与数据隔离、导入与评分、AI 研判报告、找货比价、上架包与违禁词、Webhook 签名推送、流水线，以及**在真实 Chromium 中加载插件**完成自动关键词搜、自动以图搜、采集新版 1688 卡片、补详情的全过程。大模型、1688、ERP 由本地模拟服务提供，测试走真实调用链路，结果稳定可重复。

## 路线图

- [x] 多维度选品 + AI 研判报告
- [x] 1688 找货比价 + AI 同款判断
- [x] AI 上架包 + 违禁词检查 + Webhook / ERP 推送
- [x] 多 Agent 自动上品流水线
- [x] 浏览器插件自动关键词搜 / 以图搜 / 补详情
- [ ] 妙手 ERP 官方接口审核通过后完成真实上品联调
- [ ] FastMoss 开放接口自动拉取选品数据
- [ ] 上架后数据回流：跟踪测款销量，自动建议加推或下架
- [ ] 团队协作：商品分配与审核流
