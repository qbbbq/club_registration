# 社团报名系统

这是一个 Vue 3 + Express + MySQL 的社团报名系统。

## 技术栈

- 前端：Vue 3、TypeScript、Vite、Element Plus
- 后端：Express、TypeScript、tsx
- 数据库：MySQL

## 环境变量

创建 `.env` 文件：

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=club_registration
```

## 初始化数据库

使用 MySQL 客户端执行：

```bash
mysql -u root -p < server/src/storage/database/init.sql
```

如果数据库用户不是 `root`，请替换为实际用户。

## 安装依赖

```bash
corepack pnpm install
```

如果你的系统已直接安装 `pnpm`，也可以使用：

```bash
pnpm install
```

## 开发运行

```bash
corepack pnpm run dev
```

默认端口：

- 前端：`http://localhost:5000`
- 后端：`http://localhost:3001`

开发环境下，Vite 会把 `/api` 代理到后端。

## 测试

```bash
corepack pnpm test
```

## 生产构建

```bash
corepack pnpm run build
corepack pnpm start
```

生产环境中，Express 会提供 `dist` 静态文件和 `/api` 接口，默认监听 `127.0.0.1:3001`，由 Nginx 对外提供访问。

## Nginx 部署（推荐）

高并发场景建议让 Nginx 负责静态文件、gzip 压缩和缓存，Node 只处理 API：

1. 在服务器执行 `corepack pnpm run build`。
2. 将 `dist` 放到 Nginx 配置中的目录，并修改 `deploy/nginx-site.conf` 的 `server_name` 和 `root`。
3. 将配置复制到 Nginx 的 `conf.d` 目录，并确保 Node 服务只监听 `127.0.0.1:3001`。
4. 检查并加载配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

`/assets/` 会缓存一年，因为 Vite 文件名带内容 hash；`index.html` 不缓存，发布新版本后能立即生效。`/api/` 会转发到 Node，并限制连接和读取超时时间。

完整配置模板见 `deploy/nginx-site.conf`。

## 高并发运行参数

当前服务默认使用以下保护值，适合单个 Node 进程运行在 8 核 8GB 服务器上：

```env
MYSQL_CONNECTION_LIMIT=80
MYSQL_QUEUE_LIMIT=1000
MYSQL_CONNECT_TIMEOUT_MS=10000
MYSQL_MAX_IDLE=40
MYSQL_IDLE_TIMEOUT_MS=60000
API_MAX_CONCURRENT=200
API_MAX_QUEUE=1000
```

这些变量均可写入 `.env` 覆盖默认值。`max_connections=500` 时，不建议把单个 Node 进程的连接池直接设置为 500；如果使用多个 Node 进程，应按进程数分摊，例如 2 个进程各使用 `MYSQL_CONNECTION_LIMIT=40`。

当 API 活跃请求和等待队列都达到上限时，服务返回 HTTP 503「服务器繁忙，请稍后重试」，避免无限排队。Node 请求和数据库连接也有超时，避免连接长期占用。

## PM2 多进程部署（推荐）

Node 是单进程模型，只用一个 CPU 核。8 核服务器建议用 PM2 集群模式开 4 个进程：

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

配置文件 `ecosystem.config.cjs` 已内置 4 进程、每进程 40 个 MySQL 连接（共 160，低于 `max_connections=500`）、1G 内存重启阈值、日志输出和自动重启。

## 宝塔面板 Nginx 配置

宝塔面板默认把全部请求反代给 Node，静态页面也由 Node 输出，会浪费 Node 单核性能。建议使用 `deploy/bt-nginx-site.conf` 的配置：

1. 在服务器项目目录执行 `corepack pnpm run deploy:build`。
2. 宝塔面板 → 网站 → 站点设置 → 配置文件，替换为 `deploy/bt-nginx-site.conf` 内容（按注释调整证书路径和 dist 目录）。
3. 重新加载 Nginx。

这样 `/assets/` 静态文件由 Nginx 直接输出（一年缓存），Node 只处理 `/api/` 接口。

## 默认后台账号

当前后台登录仍是前端模拟登录：

```text
admin / admin
```

注意：后端管理接口暂未实现真实鉴权，请勿直接暴露到公网。
