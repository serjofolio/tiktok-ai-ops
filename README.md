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

