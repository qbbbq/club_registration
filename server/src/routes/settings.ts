import express from 'express';
import { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { query } from '../storage/database/mysql-client';

const router = express.Router();

const OPEN_TIME_KEY = 'registration_open_at';
const REGISTRATION_TITLE_KEY = 'registration_title';
const DEFAULT_REGISTRATION_TITLE = '社团报名系统';
const MAX_REGISTRATION_TITLE_LENGTH = 30;

interface SettingRow extends RowDataPacket {
  value: string | null;
}

router.get('/registration-title', async (req, res) => {
  try {
    const rows = await query<SettingRow[]>(
      'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
      [REGISTRATION_TITLE_KEY]
    );
    const storedTitle = rows[0]?.value?.trim();
    res.json({
      success: true,
      data: { title: storedTitle || DEFAULT_REGISTRATION_TITLE },
    });
  } catch (error: any) {
    console.error('获取报名入口标题错误:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.put('/registration-title', async (req, res) => {
  try {
    const rawTitle = req.body?.title;

    if (rawTitle !== null && rawTitle !== undefined && typeof rawTitle !== 'string') {
      return res.status(400).json({
        success: false,
        message: '报名入口标题格式不正确',
      });
    }

    const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';

    if (title.length === 0) {
      await query<ResultSetHeader>('DELETE FROM settings WHERE `key` = ?', [REGISTRATION_TITLE_KEY]);
      return res.json({
        success: true,
        message: '已恢复默认报名入口标题',
        data: { title: DEFAULT_REGISTRATION_TITLE },
      });
    }

    if ([...title].length > MAX_REGISTRATION_TITLE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: '报名入口标题不能超过30个字符',
      });
    }

    await query<ResultSetHeader>(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [REGISTRATION_TITLE_KEY, title]
    );

    res.json({
      success: true,
      message: '报名入口标题设置成功',
      data: { title },
    });
  } catch (error: any) {
    console.error('设置报名入口标题错误:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.get('/registration-open-time', async (req, res) => {
  try {
    const rows = await query<SettingRow[]>(
      'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
      [OPEN_TIME_KEY]
    );
    res.json({ success: true, data: { openAt: rows.length > 0 ? rows[0].value : null } });
  } catch (error: any) {
    console.error('获取报名开放时间错误:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.put('/registration-open-time', async (req, res) => {
  try {
    const { openAt } = req.body;

    if (openAt === null || openAt === undefined) {
      await query<ResultSetHeader>('DELETE FROM settings WHERE `key` = ?', [OPEN_TIME_KEY]);
      return res.json({ success: true, message: '已清除报名开放时间，学生可随时报名' });
    }

    if (typeof openAt !== 'string' || Number.isNaN(Date.parse(openAt))) {
      return res.status(400).json({ success: false, message: '开放时间格式不正确' });
    }

    await query<ResultSetHeader>(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [OPEN_TIME_KEY, openAt]
    );

    res.json({ success: true, message: '报名开放时间设置成功' });
  } catch (error: any) {
    console.error('设置报名开放时间错误:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

export default router;
