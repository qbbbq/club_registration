import express from 'express';
import { RegistrationService } from '../services/registrationService';

const router = express.Router();

/**
 * GET /api/registrations
 * 获取所有报名记录
 */
router.get('/', async (req, res) => {
  try {
    const registrations = await RegistrationService.getAllRegistrations();
    res.json(registrations);
  } catch (error: any) {
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
    const result = await RegistrationService.clearAllRegistrations();
    res.json(result);
  } catch (error: any) {
    console.error('清空报名记录错误:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || '服务器内部错误' 
    });
  }
});

export default router;
