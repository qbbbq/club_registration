"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const registrationService_1 = require("../services/registrationService");
const router = express_1.default.Router();
/**
 * GET /api/registrations
 * 获取所有报名记录
 */
router.get('/', async (req, res) => {
    try {
        const registrations = await registrationService_1.RegistrationService.getAllRegistrations();
        res.json(registrations);
    }
    catch (error) {
        console.error('获取报名记录错误:', error);
        res.status(500).json({
            success: false,
            message: error.message || '服务器内部错误'
        });
    }
});
/**
 * DELETE /api/registrations
 * 清空所有报名数据并重置社团名额
 */
router.delete('/', async (req, res) => {
    try {
        const result = await registrationService_1.RegistrationService.clearAllRegistrations();
        res.json(result);
    }
    catch (error) {
        console.error('清空报名记录错误:', error);
        res.status(500).json({
            success: false,
            message: error.message || '服务器内部错误'
        });
    }
});
exports.default = router;
