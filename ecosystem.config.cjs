// PM2 集群配置：4 进程 × 每进程 40 个 MySQL 连接 = 160 连接（max_connections=500 安全余量）
// 使用前先在项目目录执行 `corepack pnpm run deploy:build` 编译前端和后端
// 使用：pm2 start ecosystem.config.cjs
// 停止：pm2 stop club-registration
// 日志：pm2 logs club-registration
module.exports = {
  apps: [
    {
      name: 'club-registration',
      script: './dist-server/index.js',
      exec_mode: 'cluster',
      instances: 4,
      autorestart: true,
      max_memory_restart: '1G',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '127.0.0.1',
        MYSQL_CONNECTION_LIMIT: '40',
        MYSQL_MAX_IDLE: '20',
        MYSQL_QUEUE_LIMIT: '1000',
        MYSQL_CONNECT_TIMEOUT_MS: '10000',
        MYSQL_IDLE_TIMEOUT_MS: '60000',
        API_MAX_CONCURRENT: '200',
        API_MAX_QUEUE: '1000',
      },
    },
  ],
};
