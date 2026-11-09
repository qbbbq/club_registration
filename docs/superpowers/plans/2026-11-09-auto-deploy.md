# 推送自动部署实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现本地 push 到 `main` 后，GitHub Actions 自动触发服务器拉取、构建、数据库迁移、PM2 重载，并在失败时回滚代码。

**Architecture:** GitHub Actions 通过受限 SSH 密钥触发服务器上的 `deploy/deploy-bt.sh`。脚本负责 `git pull`、构建前后端、调用 `deploy/migrate.sh` 执行未应用的迁移、重载 PM2、轮询 `/health`，失败时回滚到上一个提交。迁移状态记录在数据库 `schema_migrations` 表。

**Tech Stack:** GitHub Actions、OpenSSH、Bash、Node.js 24、pnpm、PM2、MySQL CLI、Vite、TypeScript。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `deploy/migrate.sh` | 数据库迁移执行器：`schema_migrations`、`--status`、按文件名顺序执行 |
| `deploy/deploy-bt.sh` | 完整部署流程：锁、拉取、构建、迁移、重载、健康检查、回滚 |
| `.github/workflows/deploy.yml` | push `main` / 手动触发，SSH 执行部署 |
| `docs/deploy/ubuntu24-baota.md` | 增加自动部署、密钥、Secrets、迁移规范、回滚说明 |
| `README.md` | 增加自动部署入口 |

---

### Task 1: 新增数据库迁移执行器

**Files:**
- Create: `deploy/migrate.sh`

- [ ] **Step 1: 写入 `deploy/migrate.sh`**

```bash
#!/usr/bin/env bash
# 数据库迁移执行器：只执行 schema_migrations 中未记录的迁移。
# 用法：
#   bash deploy/migrate.sh           执行待应用迁移
#   bash deploy/migrate.sh --status  查看迁移状态
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

MODE="apply"
case "${1:-}" in
  --status) MODE="status" ;;
  "") ;;
  *)
    echo "用法：bash deploy/migrate.sh [--status]" >&2
    exit 2
    ;;
esac

if [ ! -f .env ]; then
  echo "错误：$APP_DIR/.env 不存在，请先按 docs/deploy/ubuntu24-baota.md 第 4 节创建。" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${MYSQL_HOST:?缺少 MYSQL_HOST}"
: "${MYSQL_USER:?缺少 MYSQL_USER}"
: "${MYSQL_PASSWORD:?缺少 MYSQL_PASSWORD}"
: "${MYSQL_DATABASE:?缺少 MYSQL_DATABASE}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

if [ -n "${MYSQL_BIN:-}" ]; then
  :
elif command -v mysql >/dev/null 2>&1; then
  MYSQL_BIN="$(command -v mysql)"
elif [ -x /www/server/mysql/bin/mysql ]; then
  MYSQL_BIN="/www/server/mysql/bin/mysql"
else
  echo "错误：找不到 mysql 客户端。请安装 mysql-client，或设置 MYSQL_BIN。" >&2
  exit 1
fi

MYSQL_CNF="$(mktemp)"
cleanup() {
  rm -f "$MYSQL_CNF"
}
trap cleanup EXIT
chmod 600 "$MYSQL_CNF"

{
  printf '[client]\n'
  printf 'host=%s\n' "$MYSQL_HOST"
  printf 'port=%s\n' "$MYSQL_PORT"
  printf 'user=%s\n' "$MYSQL_USER"
  printf 'password=%s\n' "$MYSQL_PASSWORD"
  printf 'default-character-set=utf8mb4\n'
} > "$MYSQL_CNF"

mysql_run() {
  "$MYSQL_BIN" --defaults-extra-file="$MYSQL_CNF" --database="$MYSQL_DATABASE" "$@"
}

echo "==> 确认迁移记录表"
mysql_run <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
SQL

MIGRATIONS_DIR="$APP_DIR/server/src/storage/database/migrations"
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "错误：迁移目录不存在：$MIGRATIONS_DIR" >&2
  exit 1
fi

if [ "$MODE" = "apply" ]; then
  CLUBS_EXISTS="$(mysql_run --batch --skip-column-names -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'clubs';")"
  if [ "$CLUBS_EXISTS" = "0" ]; then
    echo "错误：数据库中没有 clubs 表。请先执行 server/src/storage/database/init.sql 初始化数据库。" >&2
    exit 1
  fi
fi

mapfile -t MIGRATION_FILES < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort)

if [ "${#MIGRATION_FILES[@]}" -eq 0 ]; then
  echo "没有迁移文件。"
  exit 0
fi

APPLIED=0
SKIPPED=0
PENDING=0

for file in "${MIGRATION_FILES[@]}"; do
  name="$(basename "$file")"
  escaped_name="${name//\'/\'\'}"
  count="$(mysql_run --batch --skip-column-names -e \
    "SELECT COUNT(*) FROM schema_migrations WHERE name = '$escaped_name';")"

  if [ "$count" != "0" ]; then
    if [ "$MODE" = "status" ]; then
      printf '已应用  %s\n' "$name"
    fi
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$MODE" = "status" ]; then
    printf '待应用  %s\n' "$name"
    PENDING=$((PENDING + 1))
    continue
  fi

  echo "==> 应用迁移：$name"
  mysql_run < "$file"
  mysql_run -e "INSERT INTO schema_migrations (name) VALUES ('$escaped_name');"
  APPLIED=$((APPLIED + 1))
done

if [ "$MODE" = "status" ]; then
  echo "迁移状态：已应用 $SKIPPED 个，待应用 $PENDING 个。"
else
  echo "迁移完成：新应用 $APPLIED 个，跳过 $SKIPPED 个。"
fi
```

- [ ] **Step 2: 检查脚本语法**

Run: `bash -n deploy/migrate.sh`
Expected: 无输出、退出码 0。

- [ ] **Step 3: 提交**

```bash
git add deploy/migrate.sh
git commit -m "feat: add database migration runner"
```

---

### Task 2: 改造部署脚本

**Files:**
- Modify: `deploy/deploy-bt.sh`

- [ ] **Step 1: 用以下内容替换 `deploy/deploy-bt.sh`**

```bash
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
```

- [ ] **Step 2: 检查脚本语法**

Run: `bash -n deploy/deploy-bt.sh`
Expected: 无输出、退出码 0。

- [ ] **Step 3: 提交**

```bash
git add deploy/deploy-bt.sh
git commit -m "feat: pull, migrate, and roll back in deploy script"
```

---

### Task 3: 新增 GitHub Actions 工作流

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: 写入工作流**

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: production-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Deploy over SSH
        env:
          SSH_HOST: ${{ secrets.SSH_HOST }}
          SSH_USER: ${{ secrets.SSH_USER }}
          SSH_PORT: ${{ secrets.SSH_PORT }}
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
        run: |
          set -euo pipefail

          if [ -z "${SSH_HOST:-}" ] || [ -z "${SSH_USER:-}" ] || [ -z "${SSH_PRIVATE_KEY:-}" ]; then
            echo "缺少 SSH_HOST / SSH_USER / SSH_PRIVATE_KEY secrets" >&2
            exit 1
          fi

          PORT="${SSH_PORT:-22}"
          install -m 700 -d ~/.ssh
          printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -p "$PORT" -H "$SSH_HOST" >> ~/.ssh/known_hosts

          ssh -T -i ~/.ssh/deploy_key -p "$PORT" \
            -o IdentitiesOnly=yes \
            -o BatchMode=yes \
            -o ConnectTimeout=10 \
            -o ServerAliveInterval=30 \
            "$SSH_USER@$SSH_HOST" \
            "cd /www/wwwroot/club_registration && bash deploy/deploy-bt.sh"
```

- [ ] **Step 2: 校验 YAML 可解析**

Run: `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('.github/workflows/deploy.yml').read_text(encoding='utf-8')); print('yaml ok')"`
Expected: `yaml ok`

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy main via SSH"
```

---

### Task 4: 更新部署文档和 README

**Files:**
- Modify: `docs/deploy/ubuntu24-baota.md`
- Modify: `README.md`

- [ ] **Step 1: 替换部署手册第 11 节**

把原来的：

````markdown
## 11. 日常更新

```bash
cd /www/wwwroot/club_registration
git pull
bash deploy/deploy-bt.sh
```

脚本会检查 Node 版本、安装依赖、构建前后端、重载或启动 PM2，并调用 `/health` 做健康检查。
````

替换为：

````markdown
## 11. 日常更新

推荐直接推送，GitHub Actions 会自动部署：

```bash
git push origin main
```

手动部署兜底（脚本会拉取 `origin/main`、构建、迁移并重载）：

```bash
cd /www/wwwroot/club_registration
bash deploy/deploy-bt.sh
```

自动部署的首次配置见第 14 节。
````

- [ ] **Step 2: 替换部署手册第 13 节（回滚）**

把原来的：

````markdown
## 13. 回滚

```bash
cd /www/wwwroot/club_registration
git log --oneline -5
git checkout <上一个可用提交>
bash deploy/deploy-bt.sh
```

回滚后执行 `git switch main` 回到最新代码。
````

替换为：

````markdown
## 13. 回滚

自动部署失败时，`deploy/deploy-bt.sh` 会自动回滚运行中的代码。

人工回滚推荐用 `git revert` 产生一个新提交，让自动部署重新发布：

```bash
git revert <有问题的提交>
git push origin main
```

如果需要在服务器上临时还原运行版本（不改变 git 历史）：

```bash
cd /www/wwwroot/club_registration
git log --oneline -5
git checkout --force <上一个可用提交>
corepack pnpm run build
corepack pnpm run build:server
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

注意：下一次自动部署会重新切回 `main` 并发布最新提交。
````

- [ ] **Step 3: 在部署手册末尾追加第 14 节**

````markdown
## 14. 自动部署（GitHub Actions）

本地推送到 `main` 后，GitHub Actions 会 SSH 到服务器执行 `deploy/deploy-bt.sh`，自动完成拉取、构建、数据库迁移和 PM2 重载。

### 14.1 服务器生成受限部署密钥

在服务器执行：

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" \
  -f /root/.ssh/github_actions_deploy -N ""

PUB="$(cat /root/.ssh/github_actions_deploy.pub)"
echo "restrict,command=\"cd /www/wwwroot/club_registration && bash deploy/deploy-bt.sh\" $PUB" \
  >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

查看私钥内容，稍后填入 GitHub Secret：

```bash
cat /root/.ssh/github_actions_deploy
```

私钥只保存在 GitHub Secrets，不要提交到仓库。

### 14.2 配置 GitHub Secrets

GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret：

| Secret | 值 |
| --- | --- |
| `SSH_HOST` | 服务器 IP 或域名 |
| `SSH_USER` | `root` |
| `SSH_PRIVATE_KEY` | 上一步 `cat` 出来的完整私钥 |
| `SSH_PORT` | SSH 端口，默认 22，可省略 |

如果宝塔防火墙限制了 SSH 来源 IP，需要放行 GitHub Actions 的出口 IP，否则工作流会连接失败。

### 14.3 触发部署

- 本地 `git push origin main` 自动触发。
- 也可以在 GitHub → Actions → Deploy → Run workflow 手动触发。
- 查看 Actions 日志和服务器 `/www/wwwroot/club_registration/logs/deploy.log`。

### 14.4 数据库迁移规范

- 新迁移放在 `server/src/storage/database/migrations/`，文件名 `YYYY-MM-DD-描述.sql`。
- 已执行过的迁移不要修改，新增变更写新文件。
- 迁移必须幂等、向前兼容，优先加列/加表/加索引；删列和改语义分两次发布。
- 查看迁移状态：

```bash
cd /www/wwwroot/club_registration
bash deploy/migrate.sh --status
```

- 执行状态记录在数据库 `schema_migrations` 表中。
- 全新数据库仍然先执行 `server/src/storage/database/init.sql`；迁移执行器检测不到 `clubs` 表会报错退出。

### 14.5 部署失败与回滚

- `git pull` 失败：旧应用继续运行，不重载。
- 构建、迁移、PM2 重载或健康检查失败：自动回滚到上一个提交并重新构建、重载。
- 数据库迁移不会自动回滚，需要新增迁移修复。
- 服务器日志：

```bash
tail -n 200 /www/wwwroot/club_registration/logs/deploy.log
pm2 logs club-registration --lines 100
```

- 人工回滚见第 13 节。
````

- [ ] **Step 4: 在 README 增加自动部署章节**

在 `README.md` 中 `## PM2 多进程部署（推荐）` 章节之后插入：

```markdown
## 自动部署（GitHub Actions）

推送到 `main` 后，GitHub Actions 通过受限 SSH 密钥触发服务器部署，自动完成拉取、构建、数据库迁移和 PM2 重载，健康检查失败时自动回滚代码。

首次配置见 `docs/deploy/ubuntu24-baota.md` 第 14 节。
```

- [ ] **Step 5: 提交**

```bash
git add docs/deploy/ubuntu24-baota.md README.md
git commit -m "docs: document push-to-deploy workflow"
```

---

### Task 5: 交付前验证

**Files:**
- Verify: `deploy/migrate.sh`
- Verify: `deploy/deploy-bt.sh`
- Verify: `.github/workflows/deploy.yml`
- Verify: `docs/deploy/ubuntu24-baota.md`
- Verify: `README.md`

- [ ] **Step 1: 两个脚本语法检查**

Run: `bash -n deploy/migrate.sh deploy/deploy-bt.sh`
Expected: 无输出、退出码 0。

- [ ] **Step 2: 工作流 YAML 可解析**

Run: `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('.github/workflows/deploy.yml').read_text(encoding='utf-8')); print('yaml ok')"`
Expected: `yaml ok`

- [ ] **Step 3: 确认没有密码或占位符进入新文件**

Run: `git grep -nE "12345|TBD|TODO|FIXME" -- deploy .github docs/deploy README.md`
Expected: 无输出

- [ ] **Step 4: 确认工作区干净**

Run: `git status --short`
Expected: 无输出

- [ ] **Step 5: 运行现有测试和构建**

Run: `corepack pnpm test`
Expected: 全部测试通过。

Run: `corepack pnpm run build`
Expected: 前端构建成功。

- [ ] **Step 6: 服务器侧验证（人工执行，不提交）**

在服务器项目目录执行：

```bash
bash -n deploy/migrate.sh deploy/deploy-bt.sh
bash deploy/migrate.sh --status
```

预期：`--status` 能列出两个现有迁移为待应用或已应用，不报数据库连接错误。

配置好 GitHub Secrets 后，用 `workflow_dispatch` 触发一次部署，确认：

```bash
tail -n 200 /www/wwwroot/club_registration/logs/deploy.log
pm2 status
curl http://127.0.0.1:3001/health
```

预期：4 个 PM2 进程 online，健康检查返回 ok，日志显示迁移结果和部署成功提交。
