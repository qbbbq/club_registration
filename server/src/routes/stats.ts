import express from 'express';
import { RegistrationService } from '../services/registrationService';

const router = express.Router();

/**
 * GET /api/stats
 * 获取统计数据
 */
router.get('/', async (req, res) => {
  try {
    const stats = await RegistrationService.getStats();
    res.json(stats);
  } catch (error: any) {
    console.error('获取统计错误:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || '服务器内部错误' 
    });
  }
});

export default router;
