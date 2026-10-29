# TikTok AI 全能运营智能体平台 - PowerShell 启动脚本
# 用法：右键 -> 使用 PowerShell 运行，或在终端执行  powershell -ExecutionPolicy Bypass -File .\start.ps1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[错误] 未检测到 Node.js，请先安装 18+ 版本：https://nodejs.org/zh-cn/download' -ForegroundColor Red
  Start-Process 'https://nodejs.org/zh-cn/download'
  Read-Host '按回车退出'; exit 1
}
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 18) { Write-Host "[错误] Node.js 版本过低：$(node -v)，需要 18+" -ForegroundColor Red; Read-Host '按回车退出'; exit 1 }

if (-not (Test-Path 'node_modules\express')) {
  Write-Host '[1/2] 首次运行，正在安装依赖...' -ForegroundColor Cyan
  npm install --omit=dev --registry=https://registry.npmmirror.com
}
if (-not $env:PORT) { $env:PORT = '3800' }
Write-Host "[2/2] 启动服务: http://localhost:$($env:PORT)" -ForegroundColor Green
node server\index.js --open
