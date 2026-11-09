import express from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import {
  GradeSelectionError,
  parseGradeSelection,
  parseStoredGrades,
  serializeGrades,
} from '../constants/grades';
import { query, withTransaction } from '../storage/database/mysql-client';
import {
  clearClubsCache,
  getCachedClubs,
  getClubsCacheVersion,
  setCachedClubs,
} from './clubs-cache';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

interface ClubRow extends RowDataPacket {
  id: number;
  name: string;
  grade: string | null;
  description: string | null;
  total_quota: number;
  remaining_quota: number;
  manager: string | null;
  manager_contact: string | null;
  created_at: Date;
  updated_at: Date | null;
}

interface CountRow extends RowDataPacket {
  count: number;
}

function formatClub<T extends { grade: string | null }>(club: T): T & {
  grade: string | null;
  grades: string[];
} {
  const rawGrade = club.grade ?? null;
  const grades = parseStoredGrades(rawGrade);
  return {
    ...club,
    grade: grades.length > 0 ? serializeGrades(grades) : rawGrade,
    grades,
  };
}

function readClubGrades(body: Record<string, unknown>): string {
  const sources = ['grades', 'grade']
    .filter((key) => Object.prototype.hasOwnProperty.call(body, key))
    .map((key) => parseGradeSelection(body[key]));

  if (sources.length === 0) {
    throw new GradeSelectionError();
  }

  const serialized = sources.map(serializeGrades);
  if (serialized.some((value) => value !== serialized[0])) {
    throw new GradeSelectionError('grade 和 grades 表达的年级不一致');
  }

  return serialized[0];
}

function readImportedClubGrades(row: Record<string, unknown>): string {
  const aliases = ['年级', '可报名年级', 'grades', 'grade'];
  const sources = aliases
    .filter((key) => Object.prototype.hasOwnProperty.call(row, key))
    .map((key) => parseGradeSelection(row[key]));

  if (sources.length === 0) {
    throw new GradeSelectionError();
  }

  const serialized = sources.map(serializeGrades);
  if (serialized.some((value) => value !== serialized[0])) {
    throw new GradeSelectionError('年级字段表达的年级不一致');
  }

  return serialized[0];
}

function formatStoredGrade(grade: string | null): string {
  const grades = parseStoredGrades(grade);
  return grades.length > 0 ? serializeGrades(grades) : grade || '';
}

function parseUploadedClubs(buffer: Buffer): Record<string, unknown>[] {
  const workbook = xlsx.read(buffer, { type: 'buffer', codepage: 65001 });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
}

function valueOf(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

router.get('/', async (req, res) => {
  try {
    const cached = getCachedClubs();
    if (cached !== null) {
      return res.json(cached);
    }

    const cacheVersion = getClubsCacheVersion();
    const rows = await query<ClubRow[]>('SELECT * FROM clubs ORDER BY id');
    const formattedRows = rows.map(formatClub);
    setCachedClubs(formattedRows, cacheVersion);
    res.json(formattedRows);
  } catch (error: any) {
    console.error('获取社团列表错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

router.post('/import', upload.single('file'), async (req, res) => {
  let hasMutations = false;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传社团文件' });
    }

    const originalName = req.file.originalname.toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].some((extension) => originalName.endsWith(extension))) {
      return res.status(400).json({ success: false, message: '仅支持 xlsx、xls、csv 文件' });
    }

    const rows = parseUploadedClubs(req.file.buffer);
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: '文件内容为空或格式不正确' });
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skipCount = 0;
    const errors: string[] = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const line = index + 2;
      const name = valueOf(row, '社团名称', 'name');
      const description = valueOf(row, '社团描述', 'description');
      let grade: string;
      try {
        grade = readImportedClubGrades(row);
      } catch (error) {
        errors.push(`第${line}行: ${error instanceof GradeSelectionError ? error.message : '可报名年级填写不正确'}`);
        skipCount++;
        continue;
      }
      const totalQuota = Number(valueOf(row, '最大报名人数', 'total_quota'));
      const manager = valueOf(row, '社团负责人', 'manager');
      const managerContact = valueOf(row, '负责人联系方式', 'manager_contact');

      if (!name || !Number.isInteger(totalQuota) || totalQuota < 1) {
        errors.push(`第${line}行: 社团名称、年级和最大报名人数必须填写正确`);
        skipCount++;
        continue;
      }

      const existing = await query<ClubRow[]>(
        'SELECT id, total_quota, remaining_quota FROM clubs WHERE name = ? LIMIT 1',
        [name]
      );

      if (existing.length === 0) {
        await query<ResultSetHeader>(
          `INSERT INTO clubs
             (name, description, grade, total_quota, remaining_quota, manager, manager_contact)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [name, description, grade, totalQuota, totalQuota, manager || null, managerContact || null]
        );
        createdCount++;
        hasMutations = true;
        continue;
      }

      const updateResult = await withTransaction(async (connection) => {
        const [lockedClubs] = await connection.execute<ClubRow[]>(
          'SELECT id, total_quota, remaining_quota FROM clubs WHERE id = ? LIMIT 1 FOR UPDATE',
          [existing[0].id]
        );

        if (lockedClubs.length === 0) {
          return { status: 'not-found' as const };
        }

        const currentClub = lockedClubs[0];
        const registered = Number(currentClub.total_quota) - Number(currentClub.remaining_quota);
        const newRemaining = totalQuota - registered;
        if (newRemaining < 0) {
          return { status: 'quota-too-small' as const };
        }

        await connection.execute<ResultSetHeader>(
          `UPDATE clubs
           SET description = ?, grade = ?, total_quota = ?, remaining_quota = ?,
               manager = ?, manager_contact = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [description, grade, totalQuota, newRemaining, manager || null, managerContact || null, existing[0].id]
        );
        return { status: 'updated' as const };
      });

      if (updateResult.status === 'updated') {
        updatedCount++;
        hasMutations = true;
      } else {
        errors.push(
          updateResult.status === 'quota-too-small'
            ? `第${line}行: 最大报名人数不能小于已报名人数`
            : `第${line}行: 社团已不存在`
        );
        skipCount++;
      }
    }

    if (createdCount > 0 || updatedCount > 0) {
      clearClubsCache();
    }

    res.json({
      success: true,
      message: `导入完成：新增 ${createdCount} 条，更新 ${updatedCount} 条，跳过 ${skipCount} 条`,
      data: { createdCount, updatedCount, skipCount, errors: errors.slice(0, 10) },
    });
  } catch (error: any) {
    if (hasMutations) {
      clearClubsCache();
    }
    console.error('导入社团数据错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const rows = await query<ClubRow[]>(
      `SELECT name, description, grade, total_quota, remaining_quota,
              manager, manager_contact, created_at, updated_at
       FROM clubs ORDER BY id`
    );
    const worksheet = xlsx.utils.json_to_sheet(rows.map((club) => ({
      社团名称: club.name,
      社团描述: club.description || '',
       年级: formatStoredGrade(club.grade),
      最大报名人数: club.total_quota,
      剩余名额: club.remaining_quota,
      社团负责人: club.manager || '',
      负责人联系方式: club.manager_contact || '',
      创建时间: club.created_at,
      更新时间: club.updated_at || '',
    })));
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, '社团数据');
    const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=clubs_${Date.now()}.xlsx`);
    res.end(buffer);
  } catch (error: any) {
    console.error('导出社团数据错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, total_quota, manager, manager_contact } = req.body;
    const quota = Number(total_quota);
    let normalizedGrade: string;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: '社团名称不能为空' });
    }

    if (!Number.isInteger(quota) || quota < 1) {
      return res.status(400).json({ success: false, message: '最大报名人数必须大于0' });
    }

    try {
      normalizedGrade = readClubGrades(req.body);
    } catch (error) {
      if (error instanceof GradeSelectionError) {
        return res.status(400).json({ success: false, message: error.message });
      }
      throw error;
    }

    const existing = await query<RowDataPacket[]>(
      'SELECT id FROM clubs WHERE name = ? LIMIT 1',
      [name.trim()]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '社团名称已存在' });
    }

    const result = await query<ResultSetHeader>(
      `INSERT INTO clubs (name, description, grade, total_quota, remaining_quota, manager, manager_contact)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        description?.trim() || '',
        normalizedGrade,
        quota,
        quota,
        manager?.trim() || null,
        manager_contact?.trim() || null,
      ]
    );

    clearClubsCache();
    const insertedRows = await query<ClubRow[]>(
      'SELECT * FROM clubs WHERE id = ? LIMIT 1',
      [result.insertId]
    );

    res.json({
      success: true,
      message: '社团创建成功',
      data: insertedRows[0] ? formatClub(insertedRows[0]) : insertedRows[0],
    });
  } catch (error: any) {
    console.error('创建社团错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { total_quota, manager, manager_contact } = req.body;
    const quota = Number(total_quota);
    let grade: string;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '社团参数不正确' });
    }

    if (!Number.isInteger(quota) || quota < 1) {
      return res.status(400).json({ success: false, message: '最大报名人数必须大于0' });
    }

    try {
      grade = readClubGrades(req.body);
    } catch (error) {
      if (error instanceof GradeSelectionError) {
        return res.status(400).json({ success: false, message: error.message });
      }
      throw error;
    }

    const updateResult = await withTransaction(async (connection) => {
      const [clubs] = await connection.execute<ClubRow[]>(
        'SELECT * FROM clubs WHERE id = ? LIMIT 1 FOR UPDATE',
        [id]
      );

      if (clubs.length === 0) {
        return { status: 'not-found' as const };
      }

      const currentClub = clubs[0];
      const registered = currentClub.total_quota - currentClub.remaining_quota;
      const newRemaining = quota - registered;

      if (newRemaining < 0) {
        return { status: 'quota-too-small' as const };
      }

      await connection.execute<ResultSetHeader>(
        `UPDATE clubs
         SET grade = ?,
             total_quota = ?,
             remaining_quota = ?,
             manager = ?,
             manager_contact = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [grade, quota, newRemaining, manager || null, manager_contact || null, id]
      );

      return { status: 'updated' as const };
    });

    if (updateResult.status === 'not-found') {
      return res.status(404).json({ success: false, message: '社团不存在' });
    }

    if (updateResult.status === 'quota-too-small') {
      return res.status(400).json({ success: false, message: '最大报名人数不能小于已报名人数' });
    }

    clearClubsCache();
    res.json({ success: true, message: '更新成功' });
  } catch (error: any) {
    console.error('更新社团错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '社团参数不正确' });
    }

    const clubs = await query<ClubRow[]>(
      'SELECT id, name FROM clubs WHERE id = ? LIMIT 1',
      [id]
    );

    if (clubs.length === 0) {
      return res.status(404).json({ success: false, message: '社团不存在' });
    }

    const countRows = await query<CountRow[]>(
      'SELECT COUNT(*) AS count FROM registrations WHERE club_id = ?',
      [id]
    );
    const count = Number(countRows[0]?.count || 0);

    if (count > 0) {
      return res.status(400).json({
        success: false,
        message: `该社团已有 ${count} 条报名记录，无法删除。请先清空报名记录。`,
      });
    }

    await query<ResultSetHeader>('DELETE FROM clubs WHERE id = ?', [id]);

    clearClubsCache();
    res.json({ success: true, message: `社团「${clubs[0].name}」已删除` });
  } catch (error: any) {
    console.error('删除社团错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

export default router;
