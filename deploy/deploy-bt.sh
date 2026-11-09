#!/usr/bin/env bash
# 宝塔服务器一键安装、构建并重载 PM2。
# 用法：在项目根目录执行 bash deploy/deploy-bt.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "错误：$APP_DIR/.env 不存在，请先按 docs/deploy/ubuntu24-baota.md 第 4 节创建。" >&2
  exit 1
fi

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
if (!ok) {
  console.error(`错误：需要 Node.js 20.19+ / 22.12+ / 24+，当前 ${process.versions.node}`);
  process.exit(1);
}
'

if command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  echo "错误：未找到 corepack 或 pnpm。请安装 Node 24，或执行 npm install -g pnpm。" >&2
  exit 1
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
mkdir -p logs

echo "==> 安装依赖"
"${PNPM[@]}" install

echo "==> 构建前端"
"${PNPM[@]}" run build

echo "==> 构建后端"
"${PNPM[@]}" run build:server

if [ ! -f dist/index.html ] || [ ! -f dist-server/index.js ]; then
  echo "错误：构建产物缺失（dist/index.html 或 dist-server/index.js）。" >&2
  exit 1
fi

echo "==> 启动或重载 PM2"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "==> 健康检查"
sleep 1
curl -fsS http://127.0.0.1:3001/health
echo
echo "部署完成。"
