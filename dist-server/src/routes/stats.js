"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const registrationService_1 = require("../services/registrationService");
const router = express_1.default.Router();
/**
 * GET /api/stats
 * 获取统计数据
 */
router.get('/', async (req, res) => {
    try {
        const stats = await registrationService_1.RegistrationService.getStats();
        res.json(stats);
    }
    catch (error) {
        console.error('获取统计错误:', error);
        res.status(500).json({
            success: false,
            message: error.message || '服务器内部错误'
        });
    }
});
exports.default = router;
