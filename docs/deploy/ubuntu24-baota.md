# Ubuntu 24 + 宝塔面板部署手册

适用于：域名 `club.whysss.cn`，Nginx 输出静态文件，PM2 集群运行后端，远程 MySQL `85.137.245.82:3306`。

## 0. 准备清单

- 服务器公网 IP，SSH 或宝塔面板可登录。
- 域名 `club.whysss.cn` 的 DNS A 记录已指向服务器。
- 服务器能访问 GitHub 仓库 `https://github.com/qbbbq/club_registration.git`。
- 远程 MySQL 账号可用：库 `club_registration`，用户 `club_registration`，密码见本地 `.env`。
- 防火墙只放行 22/80/443，不要对外放行 3001。

## 1. 检查 Node 和命令

宝塔 → 终端（或 SSH 登录）执行：

```bash
node -v
corepack pnpm -v
pm2 -v
git --version
```

要求：

- Node.js 为 `20.19+`、`22.12+` 或 `24.x`，推荐 24。
- `corepack pnpm -v`、`pm2 -v`、`git --version` 都有版本输出。

如果 Node 版本不满足：

1. 宝塔 → 软件商店 → 搜索并安装「Node.js版本管理器」。
2. 在其中安装 Node 24，并把「命令行版本」设为 24。
3. 重新打开终端，确认 `node -v` 输出 `v24.x`。

如果 `corepack` 不存在（Node 25+ 已移除）：

```bash
npm install -g pnpm
```

## 2. 检查网络和数据库

```bash
getent hosts club.whysss.cn
getent hosts github.com
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/85.137.245.82/3306' && echo "MySQL 端口可达"
```

最后一条应输出 `MySQL 端口可达`。如果失败，需要在远程 MySQL 侧放行本服务器公网 IP。

如果服务器有 mysql 客户端，再验证表结构：

```bash
mysql -h 85.137.245.82 -P 3306 -u club_registration -p -D club_registration \
  -e "SHOW COLUMNS FROM clubs LIKE 'grade'; SHOW COLUMNS FROM students LIKE 'grade';"
```

两条都应返回 `grade` 列。没有 mysql 客户端可跳过，网页报名和后台列表正常一般说明数据库可用。

## 3. 拉取代码

```bash
mkdir -p /www/wwwroot
cd /www/wwwroot
git clone https://github.com/qbbbq/club_registration.git
cd club_registration
git log --oneline -1
```

私有仓库需要先在服务器配置 Deploy Key 或 GitHub Token。

## 4. 创建 .env

```bash
cd /www/wwwroot/club-registration
cp deploy/env.production.example .env
vi .env
chmod 600 .env
```

把 `MYSQL_PASSWORD` 改为本地 `.env` 中的真实密码，保存退出。`.env` 已被 git 忽略，不要提交。

## 5. 安装依赖并构建

```bash
cd /www/wwwroot/club-registration
mkdir -p logs
corepack pnpm install
corepack pnpm run deploy:build
ls -l dist/index.html dist-server/index.js
```

最后一条能看到两个文件即构建成功。若 pnpm 首次运行询问是否下载，输入 `Y`。

## 6. 宝塔创建站点

1. 宝塔 → 网站 → 添加站点。
2. 域名填 `club.whysss.cn`。
3. 根目录填 `/www/wwwroot/club-registration/dist`。
4. PHP 版本选「纯静态」，不创建 FTP 和数据库。
5. 提交。

## 7. 申请 SSL 并强制 HTTPS

1. 网站 → `club.whysss.cn` → 设置 → SSL。
2. 选择 Let's Encrypt → 申请。
3. 申请成功后开启「强制 HTTPS」。

证书路径通常是：

```text
/www/server/panel/vhost/cert/club.whysss.cn/fullchain.pem
/www/server/panel/vhost/cert/club.whysss.cn/privkey.pem
```

以面板实际显示为准。

## 8. 启动 PM2

```bash
cd /www/wwwroot/club-registration
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` 会打印一条 `sudo env PATH=... pm2 startup ...` 命令，复制并执行它，保证服务器重启后自动拉起。

检查：

```bash
pm2 status
curl http://127.0.0.1:3001/health
```

预期：4 个 `club-registration` 进程为 `online`，健康检查返回 `{"status":"ok",...}`。

## 9. 替换 Nginx 配置

1. 宝塔 → 网站 → `club.whysss.cn` → 设置 → 配置文件。
2. 先复制备份原内容。
3. 用项目里的 `deploy/bt-nginx-site.conf` 全文替换。
4. 核对三处：
   - `server_name` 为 `club.whysss.cn`。
   - `root` 为 `/www/wwwroot/club-registration/dist`。
   - `ssl_certificate` 和 `ssl_certificate_key` 为第 7 步的实际路径。
5. 保存。

然后在终端执行：

```bash
nginx -t
nginx -s reload
```

`nginx -t` 必须输出 `syntax is ok` 和 `test is successful`。

注意：以后在宝塔里重新保存 SSL 设置可能覆盖这份配置，改完 SSL 后需要重新粘贴一次。

## 10. 验收

```bash
curl -I https://club.whysss.cn/
curl -I https://club.whysss.cn/index.html
curl https://club.whysss.cn/health
curl https://club.whysss.cn/api/stats
```

预期：

- 首页返回 200，`http://` 会自动跳转到 `https://`。
- `/health` 返回状态 ok。
- `/api/stats` 返回 JSON。
- 首页响应头包含 `Cache-Control: no-cache`。
- 从自己电脑访问 `http://服务器IP:3001/health` 应该连接失败，说明 3001 未对外暴露。

再验证静态资源缓存：

```bash
cd /www/wwwroot/club-registration
ls dist/assets | head -n 1
curl -I https://club.whysss.cn/assets/<上一步输出的文件名>
```

预期响应头包含 `Cache-Control: public, max-age=31536000, immutable`。

浏览器完整走一遍：首页二维码入口 → 报名页 → 提交报名 → 后台登录 → 社团管理 → 学生管理 → 导出 → 系统设置。

## 11. 日常更新

```bash
cd /www/wwwroot/club-registration
git pull
bash deploy/deploy-bt.sh
```

脚本会检查 Node 版本、安装依赖、构建前后端、重载或启动 PM2，并调用 `/health` 做健康检查。

## 12. 常见问题

| 现象 | 排查 |
| --- | --- |
| 502 Bad Gateway | `pm2 status`、`pm2 logs club-registration`、`curl http://127.0.0.1:3001/health` |
| 构建报 Node 版本错误 | 在宝塔 Node 版本管理器中切换 Node 24 后重试 |
| 数据库连接失败 | 检查 3306 连通、账号密码、远程授权 IP，以及远程 `max_connections` 大于 160 |
| `nginx -t` 证书报错 | 使用宝塔 SSL 页面显示的实际证书路径 |
| 页面 404 或仍是旧页面 | 检查 `root` 是否指向 `dist`，重新构建并 `nginx -s reload` |
| 修改后页面没变化 | 确认已执行 `bash deploy/deploy-bt.sh` 和 `nginx -s reload` |
| 后台 `admin/admin` 暴露风险 | 上线后尽快加 Nginx Basic Auth、IP 白名单，或实现真实登录 |

## 13. 回滚

```bash
cd /www/wwwroot/club-registration
git log --oneline -5
git checkout <上一个可用提交>
bash deploy/deploy-bt.sh
```

回滚后执行 `git switch main` 回到最新代码。
