# 推送自动部署设计

日期：2026-11-09
状态：已确认，待编写实现计划

## 背景

当前部署流程需要登录服务器手动执行 `git pull`、构建、数据库迁移和 PM2 重载。希望改为本地 `git push` 到 `main` 后，服务器自动完成应用更新和数据库变更。

## 目标

- 本地推送到 GitHub `main` 后，GitHub Actions 自动触发服务器部署。
- 服务器自动拉取代码、安装依赖、构建前端和后端、执行未应用的数据库迁移、重载 PM2。
- 部署后自动检查 `/health`，失败时自动回滚代码。
- 数据库迁移有执行记录，只运行一次，可查询状态。
- 整个流程不需要服务器暴露 Webhook 端口。

## 已确认前提

- 仓库为公开仓库 `https://github.com/qbbbq/club_registration.git`。
- 服务器为 Ubuntu 24，已安装宝塔、Node.js、MySQL、PM2，项目目录为 `/www/wwwroot/club_registration`。
- 数据库继续使用远程 MySQL `85.137.245.82:3306`。
- 采用 GitHub Actions SSH 触发，不使用 webhook 或 cron 轮询。
- 采用方案 A：SSH 触发后在服务器构建，不采用 CI 构建产物 + release 目录。
- 使用 root 账号的受限部署密钥：`authorized_keys` 中通过 `restrict,command=...` 只允许执行部署脚本。

## 目标流程

```text
本地 git push origin main
        │
        ▼
GitHub Actions (.github/workflows/deploy.yml)
        │  SSH（受限密钥，只能触发部署脚本）
        ▼
/www/wwwroot/club_registration
        │
        ▼
bash deploy/deploy-bt.sh
  1. flock 防止并发部署
  2. 切回 main，记录上一个提交 PREV
  3. git pull --ff-only
  4. 检查 .env、Node、pnpm、PM2、mysql 客户端
  5. pnpm install + 前端构建 + 后端构建
  6. bash deploy/migrate.sh：只执行未记录的迁移
  7. pm2 startOrReload + pm2 save
  8. 轮询 /health
  9. 失败则回滚到 PREV，重新构建并重载
```

## 文件变更

| 文件 | 类型 | 职责 |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | 新增 | push 到 `main` 或手动触发，SSH 执行部署 |
| `deploy/migrate.sh` | 新增 | 数据库迁移执行器，维护 `schema_migrations` |
| `deploy/deploy-bt.sh` | 改造 | 完整部署流程：拉取、构建、迁移、重载、健康检查、回滚 |
| `docs/deploy/ubuntu24-baota.md` | 修改 | 增加 GitHub Actions、Secrets、服务器密钥和迁移规范 |
| `README.md` | 修改 | 增加自动部署入口说明 |

不修改 `ecosystem.config.cjs`、Nginx 配置和业务代码。

## GitHub Actions 设计

### 触发条件

- `push` 到 `main`。
- `workflow_dispatch` 手动触发，便于首次验证和重试。

### 并发与超时

- `concurrency.group: production-deploy`，`cancel-in-progress: false`，避免两个部署同时执行。
- `timeout-minutes: 15`。

### 认证

使用 GitHub Secrets：

| Secret | 必填 | 说明 |
| --- | --- | --- |
| `SSH_HOST` | 是 | 服务器 IP 或域名 |
| `SSH_USER` | 是 | 固定为 `root` |
| `SSH_PRIVATE_KEY` | 是 | 专用部署私钥全文 |
| `SSH_PORT` | 否 | SSH 端口，默认 22 |

工作流使用系统自带 `ssh`，不引入第三方 Action。步骤：

1. 创建 `~/.ssh`，写入私钥，权限 600。
2. `ssh-keyscan -p "$PORT" -H "$SSH_HOST" >> ~/.ssh/known_hosts`。
3. `ssh -i ~/.ssh/deploy_key -p "$PORT" "$SSH_USER@$SSH_HOST"` 触发部署。
4. 服务器返回非零时 Actions 失败。

## 服务器受限部署密钥

在服务器生成专用密钥：

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f /root/.ssh/github_actions_deploy -N ""
```

把公钥写入 `/root/.ssh/authorized_keys`：

```text
restrict,command="cd /www/wwwroot/club_registration && bash deploy/deploy-bt.sh" ssh-ed25519 AAAA... github-actions-deploy
```

`restrict` 禁用 PTY、端口转发、agent 转发等能力，`command=` 固定只能执行部署脚本。GitHub 上保存私钥全文到 `SSH_PRIVATE_KEY`。

前置条件：GitHub Actions 出口 IP 必须能访问服务器 SSH 端口。如果宝塔防火墙只放行特定 IP，需要放行 GitHub Actions IP 段或调整 SSH 端口策略。部署密钥验证通过后，建议关闭 root 密码登录。

## 部署脚本设计

`deploy/deploy-bt.sh` 负责完整流程：

1. 计算项目根目录，检查 `.env` 存在。
2. 创建 `logs/`，用 `flock -n logs/deploy.lock` 防止并发部署。
3. 检查 Node.js 版本满足 Vite 8 要求，选择 `corepack pnpm` 或 `pnpm`。
4. 切回 `main`，记录 `PREV=$(git rev-parse HEAD)`。
5. `git fetch origin main`、`git pull --ff-only origin main`。
6. 安装依赖，执行 `pnpm run build` 和 `pnpm run build:server`。
7. 执行 `bash deploy/migrate.sh`。
8. `pm2 startOrReload ecosystem.config.cjs --update-env`、`pm2 save`。
9. 轮询 `http://127.0.0.1:3001/health`，默认 30 次、每秒一次。
10. 任一步失败触发回滚。

约定：

- `HEALTH_URL` 可通过环境变量覆盖，默认 `http://127.0.0.1:3001/health`，用于回滚测试。
- 部署日志追加到 `logs/deploy.log`，同时输出到 GitHub Actions。
- `git pull` 失败时旧应用保持运行，不做回滚。
- `git pull` 成功后才置 `DEPLOY_STARTED=1`，后续失败才回滚。

## 回滚设计

失败时：

1. `git checkout --force "$PREV"`。
2. 重新安装依赖并构建前后端。
3. `pm2 startOrReload ecosystem.config.cjs --update-env`、`pm2 save`。
4. 再请求一次 `/health`，失败也继续退出。
5. 以原始非零退出码结束，GitHub Actions 标记部署失败。

回滚后仓库处于 detached HEAD，下一次部署开始时执行 `git checkout main` 回到主分支。数据库迁移不回滚；MySQL DDL 会隐式提交，迁移必须设计为幂等和向前兼容。

## 数据库迁移执行器设计

### 记录表

首次运行创建：

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 执行逻辑

1. 从 `.env` 读取 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。
2. 将连接信息写入临时 `--defaults-extra-file`，权限 600，退出时删除，避免密码出现在命令行。
3. 自动探测 `mysql` 或 `/www/server/mysql/bin/mysql`。
4. 检查 `clubs` 表是否存在；不存在则报错并提示先执行 `server/src/storage/database/init.sql`。
5. 按文件名排序扫描 `server/src/storage/database/migrations/*.sql`。
6. 对每个文件查询 `schema_migrations`：
   - 已记录：跳过。
   - 未记录：用 mysql 客户端执行，成功后插入记录。
7. 任一迁移失败立即退出，不记录该文件，部署脚本随后回滚代码。
8. `--status` 参数只输出已应用和待应用的迁移，不执行迁移。

使用 mysql CLI 而不是 mysql2，是为了兼容现有迁移中的 `DELIMITER` 存储过程语法。

### 迁移规范

- 文件名格式 `YYYY-MM-DD-描述.sql`，按文件名顺序执行。
- 已执行过的迁移永不修改；新增变更写新文件。
- 迁移尽量幂等；MySQL DDL 隐式提交，执行器无法用事务整体回滚。
- 迁移必须向前兼容：PM2 reload 期间新旧进程短暂共存，旧代码要能读取新结构。优先加列、加表、加索引；删列、改语义分两次发布。
- `init.sql` 用于全新库初始化；已有库的表结构变更必须提供迁移文件。
- 重要迁移执行前建议手工备份；自动流程不包含数据库备份。
- 现有两个迁移在首次自动部署时会被执行一次；它们本身是幂等的。

## 错误处理

- `.env` 缺失、Node 版本不满足、pnpm/PM2/mysql 客户端缺失：部署开始前退出，旧应用不受影响。
- `git pull` 失败：退出，不重载。
- 构建失败：回滚到 `PREV`，重新构建并重载。
- 迁移失败：回滚代码；数据库可能部分变更，通过新增迁移修复。
- PM2 重载失败或健康检查失败：回滚代码并重载。
- 回滚自身失败：保留日志，Actions 失败，需要人工登录处理。
- 并发部署：`flock` 让后一个部署直接退出。

## 安全设计

- GitHub Secrets 不打印、不写入仓库。
- 服务器部署密钥使用 `restrict,command=...`，即使私钥泄露也只能触发部署。
- `.env` 继续只存在于服务器，不进入 git。
- 数据库密码通过临时配置文件传递给 mysql，不出现在进程命令行。
- GitHub Actions 的出口 IP 需要在服务器防火墙放行。
- 建议关闭 root 密码登录，仅保留密钥登录。

## 测试与验收

- `bash -n deploy/deploy-bt.sh deploy/migrate.sh` 通过。
- `corepack pnpm test` 和 `corepack pnpm run build` 通过，确认没有破坏现有应用。
- 在服务器执行 `bash deploy/migrate.sh --status`，能正确列出已应用和待应用迁移。
- 在服务器手动执行一次 `bash deploy/deploy-bt.sh`，构建、迁移、重载、健康检查全部通过。
- 用 `HEALTH_URL=http://127.0.0.1:1/health bash deploy/deploy-bt.sh` 验证回滚流程。
- 在 GitHub Actions 使用 `workflow_dispatch` 触发一次，确认成功。
- 本地推送一个普通提交到 `main`，确认服务器自动更新。
- 新增一个测试迁移并推送，确认 `schema_migrations` 记录新增，再次部署时跳过。

## 不在本次范围

- 不做 CI 构建产物上传和 release 目录切换。
- 不做数据库自动备份。
- 不做钉钉、邮件、企业微信通知。
- 不做预发布环境和灰度发布。
- 不修改业务代码、接口和现有数据库结构。
