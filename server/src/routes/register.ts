import express from 'express';
import { type RowDataPacket } from 'mysql2/promise';
import { RegistrationService } from '../services/registrationService';
import { query } from '../storage/database/mysql-client';
import { getRequestAbortSignal } from '../http/request-context';
import { normalizeIdCard } from '../utils/id-card';

const router = express.Router();

interface StudentClassRow extends RowDataPacket {
  class_name: string;
  grade: string | null;
}

router.post('/', async (req, res) => {
  const signal = getRequestAbortSignal(req);

  try {
    const { name, idCard, className, clubId } = req.body;
    const normalizedIdCard = normalizeIdCard(String(idCard || ''));

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

    const studentRows = await query<StudentClassRow[]>(
      'SELECT class_name, grade FROM students WHERE id_card = ? AND name = ? LIMIT 1',
      [normalizedIdCard, name],
      signal
    );

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

    const result = await RegistrationService.register({
      name,
      idCard: normalizedIdCard,
      className: studentRows[0].class_name,
      studentGrade: studentRows[0].grade,
      clubId: parsedClubId,
    }, signal);

    res.json(result);
  } catch (error: any) {
    if (signal?.aborted || res.headersSent) return;
    console.error('报名错误:', error);
    res.status(500).json({
      success: false,
      message: error.message || '服务器内部错误',
    });
  }
});

export default router;
