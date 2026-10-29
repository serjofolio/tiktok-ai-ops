# TikTok AI 全能运营智能体平台

面向 TikTok Shop 跨境卖家的一站式 AI 运营平台：**智能选品 → AI 脚本 → 文生图 → 图生视频 → 发布素材包**，并内置 RAG 知识库和可调用工具的 AI 智能体。

> 无需任何 API Key 即可在「离线演示模式」下跑通全部流程；在「系统设置」接入大模型后即为真实 AI 生产。

## ✨ 功能

| 模块 | 能力 |
|---|---|
| ⚡ 一键工作流 | 自动选品 → 选品分析 → 分镜脚本 → 每镜头文生图 → 图生视频 → 合成成片 → 标题/文案/话题/发布时间；支持选品池批量运行，实时进度 |
| 🤖 AI 智能体 | Function Calling 工具调用循环，可调用选品、分析、知识库、写脚本、生图、生视频、启动工作流 7 个工具；可自定义智能体（提示词 / 工具 / 绑定知识库）；可**接入外部智能体**（Dify、Coze、FastGPT 等 OpenAI 兼容端点） |
| 🔎 智能选品 | 六维评分模型（增长 30% · 销量 20% · 毛利 20% · 竞争 15% · 口碑 10% · 内容潜力 5%），S/A/B/C 分级、趋势图、AI 选品报告、选品池、CSV 导入 |
| 🎬 脚本工坊 | 6 种风格（痛点种草 PAS / 开箱 / 对比 / 剧情 / 教程 / 口播），多语言口播，RAG 增强；一键生成分镜图并合成视频 |
| 🖼️ 图片工坊 | 文生图、参考图生图、6 种风格预设、多尺寸，图库管理 |
| 🎞️ 视频工坊 | 图生视频（异步任务轮询）、6 种运镜模板；本地 Canvas 合成器（Ken Burns 运镜 + 字幕 + 转场），可导出 WebM |
| 📚 知识库 RAG | PDF / Word / Markdown / TXT / CSV / HTML 解析、智能切片、BM25 中文检索 + 向量混合检索、带引用的问答；内置 5 篇 TikTok 运营文档 |
| 🔗 开放接口 | `GET /api/tools`、`POST /api/tools/{name}`，供外部 Agent 框架把本平台当作工具使用 |

## 🚀 Windows 启动

1. 安装 [Node.js 18+](https://nodejs.org/zh-cn/download)（安装时保持默认选项）
2. 下载/克隆本项目
3. **双击 `start.bat`**：首次运行会自动安装依赖（使用 npmmirror 国内镜像），然后自动打开浏览器 `http://localhost:3800`

也可以使用 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

修改端口：`set PORT=8080 && start.bat`。macOS / Linux 使用 `./start.sh`。

## ⚙️ 模型接入

进入「系统设置」，点选预设后填写 API Key，平台会**自动调用上游 `/models` 接口拉取可用模型**（按用途排序、可输入筛选），点选即可，也可以手动输入模型名：

| 能力 | 支持的服务商 |
|---|---|
| 大语言模型 | DeepSeek、通义千问、豆包（火山方舟）、Kimi、硅基流动、OpenAI 等所有 OpenAI 兼容接口；Anthropic Claude |
| 向量模型 | OpenAI、硅基流动 bge-m3、通义 Embedding；不配置则使用本地 BM25 |
| 文生图 | 火山方舟 Seedream、OpenAI gpt-image、硅基流动 Kolors 等 `images/generations` 兼容接口 |
| 图生视频 | 火山方舟 Seedance；或「自定义异步接口」（可配置创建/查询路径和字段，适配可灵、海螺、Runway 等中转服务） |

配置与全部数据保存在本地 `data/` 目录（JSON 文件 + 媒体文件），无需安装数据库。

## 🧱 项目结构

```
server/
  index.js            Express 服务与 REST API
  db.js / settings.js JSON 文件存储与配置
  seed.js             演示商品、内置知识库、预设智能体
  providers/          llm.js（OpenAI 兼容 + Claude）· image.js · video.js
  services/           products · scripts · rag · agent · workflow
public/
  index.html  css/app.css
  js/app.js  lib.js  player.js  pages/*.js   无构建步骤的原生 ES Modules
tests/e2e.spec.js     Playwright 无头端到端测试
start.bat / start.ps1 / start.sh
```

## 🧪 测试

```bash
npm install
npx playwright install chromium
npm test            # Playwright 无头模式，使用独立的临时数据目录
```

16 个用例覆盖：所有页面、选品筛选/分析/导入、脚本→分镜图→成片、文生图、图片上传与图生视频播放、知识库上传/检索/问答、智能体工具调用与自定义、一键工作流全链路、设置（含用模拟上游测试模型自动获取）、主题与移动端布局、开放工具 API。

## 说明

- 演示商品数据为模拟数据，可通过 CSV 导入 TikTok Shop 后台或第三方数据工具（FastMoss、Kalodata 等）导出的真实数据。
- API Key 仅保存在本机 `data/settings.json`，前端只显示脱敏值。
