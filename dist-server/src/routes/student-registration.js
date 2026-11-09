"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const studentRegistrationService_1 = require("../services/studentRegistrationService");
const request_context_1 = require("../http/request-context");
const router = express_1.default.Router();
function handleStudentRegistrationError(error, res, signal) {
    if (signal?.aborted || res.headersSent)
        return;
    if (error instanceof studentRegistrationService_1.StudentRegistrationNotFoundError) {
        res.status(404).json({ success: false, message: error.message });
        return;
    }
    if (error instanceof studentRegistrationService_1.StudentRegistrationValidationError) {
        res.status(400).json({ success: false, message: error.message });
        return;
    }
    console.error('后台修改学生报名信息错误:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
}
router.post('/lookup', async (req, res) => {
    const signal = (0, request_context_1.getRequestAbortSignal)(req);
    try {
        const idCard = String(req.body?.idCard || '').trim();
        if (!/^\d{17}[\dXx]$/.test(idCard)) {
            return res.status(400).json({ success: false, message: '身份证号格式不正确' });
        }
        const data = await studentRegistrationService_1.StudentRegistrationService.lookup(idCard, signal);
        return res.json({ success: true, data });
    }
    catch (error) {
        handleStudentRegistrationError(error, res, signal);
    }
});
router.put('/:studentId', async (req, res) => {
    const signal = (0, request_context_1.getRequestAbortSignal)(req);
    try {
        const rawClubId = req.body?.clubId;
        const clubId = rawClubId === null || rawClubId === '' || rawClubId === undefined
            ? null
            : Number(rawClubId);
        const data = await studentRegistrationService_1.StudentRegistrationService.update({
            studentId: Number(req.params.studentId),
            idCard: String(req.body?.idCard || '').trim(),
            name: String(req.body?.name || '').trim(),
            grade: String(req.body?.grade || '').trim(),
            className: String(req.body?.className || '').trim(),
            clubId,
        }, signal);
        return res.json({ success: true, data });
    }
    catch (error) {
        handleStudentRegistrationError(error, res, signal);
    }
});
exports.default = router;
