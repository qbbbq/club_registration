"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// 导入路由
const register_1 = __importDefault(require("./src/routes/register"));
const stats_1 = __importDefault(require("./src/routes/stats"));
const registrations_1 = __importDefault(require("./src/routes/registrations"));
const export_1 = __importDefault(require("./src/routes/export"));
const clubs_1 = __importDefault(require("./src/routes/clubs"));
const students_1 = __importDefault(require("./src/routes/students"));
const student_registration_1 = __importDefault(require("./src/routes/student-registration"));
const settings_1 = __importDefault(require("./src/routes/settings"));
const mysql_client_1 = require("./src/storage/database/mysql-client");
const static_cache_1 = require("./src/http/static-cache");
const concurrency_limiter_1 = require("./src/http/concurrency-limiter");
const server_config_1 = require("./src/http/server-config");
const request_context_1 = require("./src/http/request-context");
const default_clubs_1 = require("./src/storage/database/default-clubs");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
// 初始化社团数据
async function initClubs() {
    try {
        // 检查是否已有数据
        const existingClubs = await (0, mysql_client_1.query)('SELECT id FROM clubs LIMIT 1');
        if (existingClubs.length > 0) {
            console.log('社团数据已存在，跳过初始化');
            return;
        }
        // 插入数据
        for (const club of default_clubs_1.DEFAULT_CLUBS) {
            await (0, mysql_client_1.query)(`INSERT INTO clubs (name, description, grade, total_quota, remaining_quota)
         VALUES (?, ?, ?, ?, ?)`, [club.name, club.description, club.grade, club.total_quota, club.remaining_quota]);
        }
        console.log('✅ 社团数据初始化成功！');
    }
    catch (error) {
        console.error('初始化社团数据异常:', error.message);
    }
}
// 中间件
app.use((0, cors_1.default)());
app.use('/api', (0, request_context_1.createRequestAbortContext)());
app.use('/api', (0, concurrency_limiter_1.createConcurrencyLimiter)((0, server_config_1.getApiConcurrencyLimits)()));
app.use(express_1.default.json());
// API 路由
app.use('/api/register', register_1.default);
app.use('/api/stats', stats_1.default);
app.use('/api/registrations', registrations_1.default);
app.use('/api/export', export_1.default);
app.use('/api/clubs', clubs_1.default);
app.use('/api/students', students_1.default);
app.use('/api/admin/student-registration', student_registration_1.default);
app.use('/api/settings', settings_1.default);
// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// 生产环境：提供静态文件服务
const distPath = path_1.default.join(process.cwd(), 'dist');
app.use(express_1.default.static(distPath, {
    setHeaders: static_cache_1.setStaticFileCacheHeaders,
}));
// SPA 路由支持 - 所有非 API 请求返回 index.html
app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
        (0, static_cache_1.setSpaEntryCacheHeaders)(res);
        res.sendFile(path_1.default.join(distPath, 'index.html'));
    }
    else {
        next();
    }
});
// 错误处理中间件
app.use((err, req, res, next) => {
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
    (0, server_config_1.configureHttpServer)(server);
}
startServer();
exports.default = app;
