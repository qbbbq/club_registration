"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const registrationService_1 = require("../services/registrationService");
const mysql_client_1 = require("../storage/database/mysql-client");
const request_context_1 = require("../http/request-context");
const id_card_1 = require("../utils/id-card");
const router = express_1.default.Router();
router.post('/', async (req, res) => {
    const signal = (0, request_context_1.getRequestAbortSignal)(req);
    try {
        const { name, idCard, className, clubId } = req.body;
        const normalizedIdCard = (0, id_card_1.normalizeIdCard)(String(idCard || ''));
        if (!name || !normalizedIdCard || !className || !clubId) {
            return res.status(400).json({
                success: false,
                message: '请填写完整信息',
            });
        }
        if (!/^\d{17}[\dXx]$/.test(normalizedIdCard)) {
            return res.status(400).json({
                success: false,
                message: '身份证号格式不正确',
            });
        }
        const studentRows = await (0, mysql_client_1.query)('SELECT class_name, grade FROM students WHERE id_card = ? AND name = ? LIMIT 1', [normalizedIdCard, name], signal);
        if (studentRows.length === 0) {
            return res.status(400).json({
                success: false,
                message: '学生信息不存在，请确认姓名和身份证号是否正确，或联系管理员导入学生信息',
            });
        }
        const parsedClubId = Number(clubId);
        if (!Number.isInteger(parsedClubId) || parsedClubId <= 0) {
            return res.status(400).json({
                success: false,
                message: '社团参数不正确',
            });
        }
        const result = await registrationService_1.RegistrationService.register({
            name,
            idCard: normalizedIdCard,
            className: studentRows[0].class_name,
            studentGrade: studentRows[0].grade,
            clubId: parsedClubId,
        }, signal);
        res.json(result);
    }
    catch (error) {
        if (signal?.aborted || res.headersSent)
            return;
        console.error('报名错误:', error);
        res.status(500).json({
            success: false,
            message: error.message || '服务器内部错误',
        });
    }
});
exports.default = router;
