# 在你自己的 Windows 电脑上运行：打包当前代码 → 上传到服务器 → 远程执行安装
# 用法（PowerShell）：  powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1
# 过程中会提示两次输入服务器密码（上传一次、执行一次）
param(
  [string]$Server = "root@你的服务器IP",
  [int]$SshPort = 22,
  [int]$AppPort = 5100,
  [string]$Domain = "tkagent.hyff.cc.cd"
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path $PSScriptRoot -Parent
$bundle = Join-Path $env:TEMP 'tkagent.tar.gz'

foreach ($cmd in 'tar', 'scp', 'ssh') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "缺少 $cmd 命令：请在「设置 → 应用 → 可选功能」中安装 OpenSSH 客户端（Windows 10 1809+ 自带 tar）" }
}

Write-Host "[1/3] 打包代码..." -ForegroundColor Cyan
if (Test-Path $bundle) { Remove-Item $bundle }
tar -czf $bundle --exclude=node_modules --exclude=data --exclude=test-results --exclude=playwright-report --exclude=.git --exclude=design --exclude=deploy.env -C $root .
Write-Host ("      {0:N1} MB" -f ((Get-Item $bundle).Length / 1MB))

Write-Host "[2/3] 上传到 $Server（输入服务器密码）..." -ForegroundColor Cyan
$files = @($bundle, (Join-Path $root 'deploy\install.sh'))
$envFile = Join-Path $root 'deploy\deploy.env'
if (Test-Path $envFile) { $tmpEnv = Join-Path $env:TEMP 'tkagent.env'; Copy-Item $envFile $tmpEnv -Force; $files += $tmpEnv; Write-Host '      含 Cloudflare 隧道配置' }
scp -P $SshPort -o StrictHostKeyChecking=accept-new @files "${Server}:/tmp/"

Write-Host "[3/3] 远程安装（再次输入服务器密码）..." -ForegroundColor Cyan
ssh -p $SshPort -t $Server "sed -i 's/\r$//' /tmp/install.sh && PORT=$AppPort DOMAIN=$Domain bash /tmp/install.sh /tmp/tkagent.tar.gz && rm -f /tmp/tkagent.tar.gz"
