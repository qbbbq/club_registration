import express, { type Request, type Response } from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { isGrade } from '../constants/grades';
import { query } from '../storage/database/mysql-client';
import { normalizeIdCard } from '../utils/id-card';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

interface StudentRow extends RowDataPacket {
  id: number;
  name: string;
  id_card: string;
  class_name: string;
  grade: string | null;
  created_at: Date;
}

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传文件' });
    }

    const originalName = req.file.originalname.toLowerCase();
    let data: any[] = [];

    if (originalName.endsWith('.csv') || originalName.endsWith('.tsv') || originalName.endsWith('.txt')) {
      const content = req.file.buffer.toString('utf-8');
      const lines = content.split(/\r?\n/).filter((line) => line.trim());

      if (lines.length < 2) {
        return res.status(400).json({ success: false, message: '文件内容为空或格式不正确' });
      }

      const firstLine = lines[0];
      const separator = firstLine.includes('\t') ? '\t' : ',';
      const headers = lines[0].split(separator).map((header) => header.trim());

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(separator);
        const row: any = {};
        headers.forEach((header, index) => {
          row[header] = values[index]?.trim() || '';
        });
        data.push(row);
      }
    } else {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = xlsx.utils.sheet_to_json(worksheet) as any[];
    }

    if (!data || data.length === 0) {
      return res.status(400).json({ success: false, message: '文件为空或格式不正确' });
    }

    let successCount = 0;
    let skipCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const row: any = data[i];
      const idCard = normalizeIdCard(String(row['身份证号'] || row['身份证'] || row['idCard'] || row['id_card'] || ''));
      const name = String(row['姓名'] || row['name'] || '').trim();
      const grade = String(row['年级'] || row['grade'] || '').trim();
      const className = String(row['班级'] || row['class'] || row['className'] || '').trim();

      if (!idCard || !name || !grade || !className) {
        errors.push(`第${i + 2}行: 姓名、身份证号、年级、班级均不能为空`);
        skipCount++;
        continue;
      }

      if (!isGrade(grade)) {
        errors.push(`第${i + 2}行: 年级必须是初一、初二或初三`);
        skipCount++;
        continue;
      }

      if (!/^\d{17}[\dXx]$/.test(idCard)) {
        errors.push(`第${i + 2}行: 身份证号格式不正确`);
        skipCount++;
        continue;
      }

      const existing = await query<StudentRow[]>(
        'SELECT id FROM students WHERE id_card = ? LIMIT 1',
        [idCard]
      );

      if (existing.length > 0) {
        try {
          await query<ResultSetHeader>(
            'UPDATE students SET name = ?, grade = ?, class_name = ? WHERE id_card = ?',
            [name, grade, className, idCard]
          );
          successCount++;
        } catch (error: any) {
          errors.push(`第${i + 2}行: 更新失败 - ${error.message}`);
          skipCount++;
        }
      } else {
        try {
          await query<ResultSetHeader>(
            'INSERT INTO students (id_card, name, grade, class_name) VALUES (?, ?, ?, ?)',
            [idCard, name, grade, className]
          );
          successCount++;
        } catch (error: any) {
          errors.push(`第${i + 2}行: 插入失败 - ${error.message}`);
          skipCount++;
        }
      }
    }

    res.json({
      success: true,
      message: `导入完成：成功 ${successCount} 条，跳过 ${skipCount} 条`,
      data: {
        successCount,
        skipCount,
        errors: errors.slice(0, 10),
      },
    });
  } catch (error: any) {
    console.error('导入学生信息错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await query<StudentRow[]>(
      'SELECT * FROM students ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (error: any) {
    console.error('获取学生列表错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

router.delete('/', async (req: Request, res: Response) => {
  try {
    await query<ResultSetHeader>('DELETE FROM students');
    res.json({ success: true, message: '学生信息已清空' });
  } catch (error: any) {
    console.error('清空学生信息错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { idCard, name } = req.body;

    if (!idCard || !name) {
      return res.json({ valid: false, message: '请输入身份证号和姓名' });
    }

    const normalizedIdCard = normalizeIdCard(String(idCard));
    const rows = await query<StudentRow[]>(
      'SELECT class_name, grade FROM students WHERE id_card = ? AND name = ? LIMIT 1',
      [normalizedIdCard, name]
    );

    if (rows.length > 0) {
      res.json({
        valid: true,
        message: '验证通过',
        className: rows[0].class_name,
        grade: rows[0].grade,
      });
    } else {
      res.json({ valid: false, message: '学生信息不存在，请确认身份证号和姓名是否正确' });
    }
  } catch (error: any) {
    console.error('验证学生信息错误:', error);
    res.status(500).json({ valid: false, message: error.message || '服务器内部错误' });
  }
});

router.post('/lookup', async (req: Request, res: Response) => {
  try {
    const { idCard } = req.body;
    const normalizedIdCard = normalizeIdCard(String(idCard || ''));

    if (!normalizedIdCard || !/^\d{17}[\dXx]$/.test(normalizedIdCard)) {
      return res.status(400).json({ success: false, message: '身份证号格式不正确' });
    }

    const rows = await query<StudentRow[]>(
      'SELECT name, class_name, grade FROM students WHERE id_card = ? LIMIT 1',
      [normalizedIdCard]
    );

    if (rows.length === 0) {
      return res.json({ success: true, data: null, message: '学生信息不存在，请联系管理员导入' });
    }

    res.json({
      success: true,
      data: {
        name: rows[0].name,
        className: rows[0].class_name,
        grade: rows[0].grade,
      },
    });
  } catch (error: any) {
    console.error('查询学生信息错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

export default router;
