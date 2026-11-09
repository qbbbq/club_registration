#!/usr/bin/env bash
# 宝塔服务器部署脚本：拉取、构建、迁移、重载、健康检查、失败回滚。
# 用法：bash deploy/deploy-bt.sh
# 测试回滚：HEALTH_URL=http://127.0.0.1:1/health bash deploy/deploy-bt.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_DIR/deploy.log") 2>&1

echo "===== $(date '+%F %T') 开始部署 ====="

if [ ! -f .env ]; then
  echo "错误：$APP_DIR/.env 不存在，请先按 docs/deploy/ubuntu24-baota.md 第 4 节创建。" >&2
  exit 1
fi

exec 9>"$LOG_DIR/deploy.lock"
if ! flock -n 9; then
  echo "错误：已有部署正在进行，本次退出。" >&2
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

command -v pm2 >/dev/null 2>&1 || { echo "错误：未找到 pm2。" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "错误：未找到 git。" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "错误：未找到 curl。" >&2; exit 1; }

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"

health_check() {
  local i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "健康检查通过（第 $i 次）：$HEALTH_URL"
      return 0
    fi
    sleep 1
  done
  echo "健康检查失败：$HEALTH_URL" >&2
  return 1
}

build_all() {
  echo "==> 安装依赖"
  "${PNPM[@]}" install
  echo "==> 构建前端"
  "${PNPM[@]}" run build
  echo "==> 构建后端"
  "${PNPM[@]}" run build:server
  if [ ! -f dist/index.html ] || [ ! -f dist-server/index.js ]; then
    echo "错误：构建产物缺失（dist/index.html 或 dist-server/index.js）。" >&2
    return 1
  fi
}

reload_app() {
  echo "==> 重载 PM2"
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
}

PREV=""
DEPLOY_STARTED=0

rollback() {
  local status=$?
  trap - EXIT
  if [ "$status" -eq 0 ] || [ "$DEPLOY_STARTED" -ne 1 ] || [ -z "$PREV" ]; then
    exit "$status"
  fi

  echo "===== 部署失败，回滚代码到 $PREV =====" >&2
  git checkout --force "$PREV"
  if build_all && reload_app; then
    health_check || true
    echo "已回滚到 $PREV；数据库迁移不会自动回滚。" >&2
  else
    echo "错误：回滚构建或重载失败，需要人工处理。" >&2
  fi
  exit "$status"
}
trap rollback EXIT

echo "==> 切换到 main"
git checkout main
PREV="$(git rev-parse HEAD)"

echo "==> 拉取最新代码"
git fetch origin main
git pull --ff-only origin main
DEPLOY_STARTED=1
echo "提交：$PREV -> $(git rev-parse HEAD)"

build_all

echo "==> 执行数据库迁移"
bash deploy/migrate.sh

reload_app
health_check

echo "===== 部署成功：$(git rev-parse HEAD) ====="
