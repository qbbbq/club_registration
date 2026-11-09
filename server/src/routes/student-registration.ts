import express from 'express';
import {
  StudentRegistrationNotFoundError,
  StudentRegistrationService,
  StudentRegistrationValidationError,
} from '../services/studentRegistrationService';
import { getRequestAbortSignal } from '../http/request-context';

const router = express.Router();

function handleStudentRegistrationError(
  error: unknown,
  res: express.Response,
  signal?: AbortSignal
): void {
  if (signal?.aborted || res.headersSent) return;

  if (error instanceof StudentRegistrationNotFoundError) {
    res.status(404).json({ success: false, message: error.message });
    return;
  }

  if (error instanceof StudentRegistrationValidationError) {
    res.status(400).json({ success: false, message: error.message });
    return;
  }

  console.error('后台修改学生报名信息错误:', error);
  res.status(500).json({ success: false, message: '服务器内部错误' });
}

router.post('/lookup', async (req, res) => {
  const signal = getRequestAbortSignal(req);

  try {
    const idCard = String(req.body?.idCard || '').trim();
    if (!/^\d{17}[\dXx]$/.test(idCard)) {
      return res.status(400).json({ success: false, message: '身份证号格式不正确' });
    }

    const data = await StudentRegistrationService.lookup(idCard, signal);
    return res.json({ success: true, data });
  } catch (error) {
    handleStudentRegistrationError(error, res, signal);
  }
});

router.put('/:studentId', async (req, res) => {
  const signal = getRequestAbortSignal(req);

  try {
    const rawClubId = req.body?.clubId;
    const clubId = rawClubId === null || rawClubId === '' || rawClubId === undefined
      ? null
      : Number(rawClubId);

    const data = await StudentRegistrationService.update({
      studentId: Number(req.params.studentId),
      idCard: String(req.body?.idCard || '').trim(),
      name: String(req.body?.name || '').trim(),
      grade: String(req.body?.grade || '').trim(),
      className: String(req.body?.className || '').trim(),
      clubId,
    }, signal);

    return res.json({ success: true, data });
  } catch (error) {
    handleStudentRegistrationError(error, res, signal);
  }
});

export default router;
