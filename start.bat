@echo off
chcp 65001 >nul
setlocal
title TikTok AI 运营智能体平台
cd /d "%~dp0"

echo.
echo   ==============================================
echo     TikTok AI 全能运营智能体平台 - Windows 启动
echo   ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 18 或更高版本：
  echo        https://nodejs.org/zh-cn/download
  echo.
  start "" "https://nodejs.org/zh-cn/download"
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_VER=%%v
set NODE_VER=%NODE_VER:v=%
if %NODE_VER% LSS 18 (
  echo [错误] Node.js 版本过低，当前版本：
  node -v
  echo        需要 18 或更高版本。
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo [1/2] 首次运行，正在安装依赖（使用国内镜像加速）...
  call npm install --omit=dev --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

if "%PORT%"=="" set PORT=3800
echo [2/2] 正在启动服务: http://localhost:%PORT%
echo       关闭此窗口即可停止服务。
echo.
node server\index.js --open
pause
