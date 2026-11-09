import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';

// 导入路由
import registerRouter from './src/routes/register';
import statsRouter from './src/routes/stats';
import registrationsRouter from './src/routes/registrations';
import exportRouter from './src/routes/export';
import clubsRouter from './src/routes/clubs';
import studentsRouter from './src/routes/students';
import studentRegistrationRouter from './src/routes/student-registration';
import settingsRouter from './src/routes/settings';
import { query } from './src/storage/database/mysql-client';
import { setSpaEntryCacheHeaders, setStaticFileCacheHeaders } from './src/http/static-cache';
import { createConcurrencyLimiter } from './src/http/concurrency-limiter';
import { configureHttpServer, getApiConcurrencyLimits } from './src/http/server-config';
import { createRequestAbortContext } from './src/http/request-context';
import { DEFAULT_CLUBS } from './src/storage/database/default-clubs';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';

interface ExistingClubRow extends RowDataPacket {
  id: number;
}

// 初始化社团数据
async function initClubs() {
  try {
    // 检查是否已有数据
    const existingClubs = await query<ExistingClubRow[]>('SELECT id FROM clubs LIMIT 1');

    if (existingClubs.length > 0) {
      console.log('社团数据已存在，跳过初始化');
      return;
    }

    // 插入数据
    for (const club of DEFAULT_CLUBS) {
      await query<ResultSetHeader>(
        `INSERT INTO clubs (name, description, grade, total_quota, remaining_quota)
         VALUES (?, ?, ?, ?, ?)`,
        [club.name, club.description, club.grade, club.total_quota, club.remaining_quota]
      );
    }

    console.log('✅ 社团数据初始化成功！');
  } catch (error: any) {
    console.error('初始化社团数据异常:', error.message);
  }
}

// 中间件
app.use(cors());
app.use('/api', createRequestAbortContext());
app.use('/api', createConcurrencyLimiter(getApiConcurrencyLimits()));
app.use(express.json());

// API 路由
app.use('/api/register', registerRouter);
app.use('/api/stats', statsRouter);
app.use('/api/registrations', registrationsRouter);
app.use('/api/export', exportRouter);
app.use('/api/clubs', clubsRouter);
app.use('/api/students', studentsRouter);
app.use('/api/admin/student-registration', studentRegistrationRouter);
app.use('/api/settings', settingsRouter);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 生产环境：提供静态文件服务
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath, {
  setHeaders: setStaticFileCacheHeaders,
}));

// SPA 路由支持 - 所有非 API 请求返回 index.html
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    setSpaEntryCacheHeaders(res);
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    next();
  }
});

// 错误处理中间件
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 启动服务
async function startServer() {
  // 先初始化数据
  await initClubs();
  
  // 再启动服务
  const server = app.listen(PORT, HOST, () => {
    console.log(`服务器运行在 http://${HOST}:${PORT}`);
  });
  configureHttpServer(server);
}

startServer();

export default app;
