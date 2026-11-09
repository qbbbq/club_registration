import express from 'express';
import { RegistrationService } from '../services/registrationService';

const router = express.Router();

/**
 * GET /api/export
 * 导出报名数据为 CSV 格式
 */
router.get('/', async (req, res) => {
  try {
    const registrations = await RegistrationService.getAllRegistrations();

    // 生成 CSV 内容
    const headers = ['序号', '姓名', '班级', '社团', '报名时间'];
    const csvRows = [headers.join(',')];

    registrations.forEach((reg: any, index: number) => {
      const row = [
        index + 1,
        reg.name,
        reg.className,
        reg.clubName,
        // 显式指定香港时区，避免依赖服务器进程时区（服务器系统时区可能是 UTC，
        // 直接用 toLocaleString 会把 UTC 时间当成本地时间输出，导致 CSV 时间慢 8 小时）
        new Date(reg.time).toLocaleString('zh-CN', { timeZone: 'Asia/Hong_Kong' })
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');

    // 设置响应头
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=registrations_${Date.now()}.csv`);
    
    // 添加 BOM 以支持中文
    res.send('\ufeff' + csvContent);
  } catch (error: any) {
    console.error('导出数据错误:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || '服务器内部错误' 
    });
  }
});

export default router;
