"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mysql_client_1 = require("../storage/database/mysql-client");
const router = express_1.default.Router();
const OPEN_TIME_KEY = 'registration_open_at';
router.get('/registration-open-time', async (req, res) => {
    try {
        const rows = await (0, mysql_client_1.query)('SELECT `value` FROM settings WHERE `key` = ? LIMIT 1', [OPEN_TIME_KEY]);
        res.json({ success: true, data: { openAt: rows.length > 0 ? rows[0].value : null } });
    }
    catch (error) {
        console.error('获取报名开放时间错误:', error);
        res.status(500).json({ success: false, message: '服务器内部错误' });
    }
});
router.put('/registration-open-time', async (req, res) => {
    try {
        const { openAt } = req.body;
        if (openAt === null || openAt === undefined) {
            await (0, mysql_client_1.query)('DELETE FROM settings WHERE `key` = ?', [OPEN_TIME_KEY]);
            return res.json({ success: true, message: '已清除报名开放时间，学生可随时报名' });
        }
        if (typeof openAt !== 'string' || Number.isNaN(Date.parse(openAt))) {
            return res.status(400).json({ success: false, message: '开放时间格式不正确' });
        }
        await (0, mysql_client_1.query)('INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [OPEN_TIME_KEY, openAt]);
        res.json({ success: true, message: '报名开放时间设置成功' });
    }
    catch (error) {
        console.error('设置报名开放时间错误:', error);
        res.status(500).json({ success: false, message: '服务器内部错误' });
    }
});
exports.default = router;
