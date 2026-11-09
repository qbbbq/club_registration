# 宝塔面板 Ubuntu 24 部署设计

日期：2026-11-09
状态：已确认，待编写实现计划

## 目标

将现有社团报名系统（Vue 3 + Express + MySQL）部署到一台 Ubuntu 24 服务器，通过宝塔面板管理站点和 HTTPS，使用 Nginx 输出静态文件、PM2 集群运行后端，对外域名为 `club.whysss.cn`。

## 已确认前提

- 服务器为 Ubuntu 24，已安装宝塔面板、Node.js、MySQL、PM2。
- 对外域名使用 `club.whysss.cn`，SSL 证书通过宝塔申请 Let's Encrypt 免费证书，并开启强制 HTTPS。
- 数据库继续使用现有远程 MySQL：`85.137.245.82:3306`，库名 `club_registration`，用户 `club_registration`。
- 代码通过服务器 `git clone` / `git pull` 获取，构建也在服务器上执行。
- 采用方案 A：Nginx 托管前端静态文件，只把 `/api/` 和 `/health` 反代到本机 Node；PM2 以集群模式运行后端。

## 目标架构

```text
用户浏览器 ──HTTPS(443)──> 宝塔 Nginx (club.whysss.cn)
                              ├── /assets/*  ──> /www/wwwroot/club_registration/dist
                              ├── /*         ──> dist/index.html（SPA 回退）
                              └── /api/*、/health ──> 127.0.0.1:3001
                                                        │
                                              PM2 集群 4 进程
                                              dist-server/index.js
                                                        │
                                              远程 MySQL 85.137.245.82:3306
```

## 服务器目录与文件

| 路径 | 说明 |
| --- | --- |
| `/www/wwwroot/club_registration` | git 仓库根目录 |
| `/www/wwwroot/club_registration/.env` | 手工创建，被 `.gitignore` 忽略，不入库 |
| `/www/wwwroot/club_registration/dist` | 前端构建产物，Nginx 站点根目录 |
| `/www/wwwroot/club_registration/dist-server` | 后端编译产物 |
| `/www/wwwroot/club_registration/logs` | PM2 日志目录，启动前创建 |

## 运行参数

沿用现有 `ecosystem.config.cjs`：

- 进程数：4，`exec_mode: cluster`。
- 监听：`127.0.0.1:3001`，仅本机可访问。
- 每进程 MySQL 连接上限：40，合计 160。
- 内存重启阈值：1G。
- 日志：`./logs/out.log`、`./logs/error.log`，合并输出并带时间戳。

远程 MySQL 的 `max_connections` 必须大于 160，否则需要下调每进程连接数或进程数。

## 环境变量

服务器上手工创建 `.env`，内容与当前本地开发环境一致，但不提交到 git：

```env
MYSQL_HOST=85.137.245.82
MYSQL_PORT=3306
MYSQL_USER=club_registration
MYSQL_PASSWORD=<现有数据库密码>
MYSQL_DATABASE=club_registration
```

仓库提供不含真实密码的样例文件 `deploy/env.production.example`。

## 首次部署流程

### 1. 前置检查

- `node -v` 必须满足 Vite 8 要求（`^20.19.0 || >=22.12.0`），推荐 Node 24。若宝塔当前 Node 版本过低，通过宝塔 Node 版本管理器安装并切换到 Node 24。
- 确认 `git`、`pm2`、`corepack` 可用；`corepack pnpm -v` 能输出版本。
- 确认服务器能访问 GitHub 仓库 `https://github.com/qbbbq/club_registration.git`。
- 确认服务器能连接 `85.137.245.82:3306`，且远程账号允许本服务器出口 IP。
- 确认远程库已是最新结构：`clubs.grade` 为 `VARCHAR(20) NULL`，`students.grade` 存在。
- `3001` 端口不对外开放，宝塔安全组只放行 80/443 和 SSH。

### 2. 宝塔建站

1. 宝塔面板新增站点，域名为 `club.whysss.cn`，根目录可先使用默认目录。
2. 在站点“SSL”中申请 Let's Encrypt 证书，并开启强制 HTTPS。
3. 记录证书的实际路径，后续写入 Nginx 配置。

### 3. 代码、依赖与构建

在宝塔终端执行：

```bash
cd /www/wwwroot
git clone https://github.com/qbbbq/club_registration.git
cd club_registration
mkdir -p logs
# 创建 .env 并写入环境变量
corepack pnpm install
corepack pnpm run deploy:build
```

`deploy:build` 依次执行 `pnpm install`、前端构建 `vue-tsc -b && vite build`、后端构建 `tsc -p server/tsconfig.json`。

### 4. 启动 PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` 输出的命令需要按提示再执行一次，确保服务器重启后自动拉起进程。

### 5. 替换 Nginx 站点配置

将 `deploy/bt-nginx-site.conf` 内容粘贴到宝塔站点的配置文件，按服务器实际路径修改：

- `server_name` 保持 `club.whysss.cn`。
- `root` 指向 `/www/wwwroot/club_registration/dist`。
- `ssl_certificate` 和 `ssl_certificate_key` 使用宝塔实际生成的证书路径。

然后检查并重载：

```bash
nginx -t
nginx -s reload
```

### 6. 验收

- `curl http://127.0.0.1:3001/health` 返回 `{"status":"ok",...}`。
- 浏览器访问 `https://club.whysss.cn/` 首页正常，HTTP 自动跳转 HTTPS。
- 报名流程、后台列表、导出、系统设置接口正常。
- `curl -I https://club.whysss.cn/assets/<某个文件>` 返回一年 `Cache-Control`。
- `curl -I https://club.whysss.cn/` 或 `/index.html` 不被长期缓存。
- `pm2 status` 显示 4 个进程均为 `online`。
- `pm2 logs club-registration` 无持续报错。

## 日常更新流程

```bash
cd /www/wwwroot/club_registration
git pull
corepack pnpm install
corepack pnpm run deploy:build
pm2 reload club-registration
```

如需改数据库结构，在构建前按顺序执行 `server/src/storage/database/migrations/` 中尚未应用的脚本。

## 交付物

- 部署文档：`docs/deploy/ubuntu24-baota.md`，包含可复制命令、配置路径和验收清单。
- 构建与重启脚本：`deploy/deploy-bt.sh`，串行执行安装、构建和 `pm2 reload`，失败即退出。
- 环境变量样例：`deploy/env.production.example`，不含真实密码。
- 按需补充 `deploy/bt-nginx-site.conf` 的路径与证书说明。
- 本设计文档。

## 错误处理与风险

- **Node 版本过低**：Vite 8 构建会失败。前置检查阶段必须确认版本，必要时用宝塔 Node 版本管理器切换。
- **远程数据库不可达**：先 `nc -vz 85.137.245.82 3306` 验证；若被防火墙拦截，需要在数据库侧放行服务器 IP，或改为本机 MySQL 方案（本次不默认执行）。
- **远程数据库连接数不足**：4 进程 × 40 连接 = 160，需确认远程 `max_connections` 大于该值。
- **证书路径不匹配**：`nginx -t` 会报错，按宝塔实际路径修正后再 reload。
- **PM2 日志目录不存在**：启动前创建 `logs` 目录。
- **管理后台无真实鉴权**：当前后台登录是前端模拟登录（`admin/admin`），README 已警告勿直接暴露公网。本次默认不加额外访问控制；如需保护，可在 Nginx 层增加 Basic Auth 或 IP 白名单（作为可选后续项）。
- **密钥泄漏**：`.env` 与数据库密码不写入 git；样例文件只保留占位符。

## 不在本次范围内

- 不新增 Docker 部署方式。
- 不迁移数据库到服务器本机。
- 不改造后台真实登录鉴权。
- 不修改业务代码、接口和数据库结构。
- 不配置 CDN、监控告警和自动备份。

## 测试与验收

- 在服务器上验证 Node、pnpm、PM2、git 版本和网络连通性。
- `corepack pnpm run deploy:build` 成功产出 `dist/` 和 `dist-server/`。
- `pm2 status` 四个进程在线，`/health` 正常。
- Nginx `nginx -t` 通过，HTTPS 访问正常，HTTP 跳转 HTTPS。
- 前端主要页面、报名接口、导出接口可用。
- 静态资源长缓存、`index.html` 不缓存符合预期。
- 服务器重启后 PM2 进程自动恢复。
