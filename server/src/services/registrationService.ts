import { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { clubAllowsGrade } from '../constants/grades';
import { clearClubsCache } from '../routes/clubs-cache';
import { query, withTransaction } from '../storage/database/mysql-client';
import { hashIdCard, normalizeIdCard } from '../utils/id-card';

interface RegistrationData {
  name: string;
  idCard: string;
  className: string;
  studentGrade: string | null;
  clubId: number;
}

interface RegistrationResult {
  success: boolean;
  message: string;
  data?: {
    id: number;
    name: string;
    className: string;
    clubId: number;
    clubName: string;
    time: string;
  };
}

interface ClubRow extends RowDataPacket {
  id: number;
  name: string;
  grade: string | null;
  total_quota: number;
  remaining_quota: number;
}

interface StudentRow extends RowDataPacket {
  id: number;
  name: string;
  grade: string | null;
  class_name: string;
}

interface RegistrationHashRow extends RowDataPacket {
  id: number;
}

interface RegistrationRow extends RowDataPacket {
  id: number;
  name: string;
  class_name: string;
  club_id: number;
  club_name: string | null;
  created_at: Date;
}

interface CountRow extends RowDataPacket {
  count: number;
}

interface StatRow extends RowDataPacket {
  name: string;
  registered: number;
  remaining: number;
  total: number;
}

class DuplicateRegistrationError extends Error {
  constructor() {
    super('Duplicate registration');
    this.name = 'DuplicateRegistrationError';
  }
}

export function formatOpenTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${utc8.getUTCFullYear()}年${pad(utc8.getUTCMonth() + 1)}月${pad(utc8.getUTCDate())}日 ${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}`;
}

export class RegistrationService {
  static async register(
    data: RegistrationData,
    signal?: AbortSignal
  ): Promise<RegistrationResult> {
    const idCard = normalizeIdCard(data.idCard);
    const idCardHash = hashIdCard(idCard);

    const settingRows = await query<RowDataPacket[]>(
      'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
      ['registration_open_at'],
      signal
    );

    if (settingRows.length > 0 && settingRows[0].value) {
      const openAt = new Date(settingRows[0].value as string);
      if (!Number.isNaN(openAt.getTime()) && openAt.getTime() > Date.now()) {
        return {
          success: false,
          message: `报名尚未开始，开放时间：${formatOpenTime(openAt)}`,
        };
      }
    }

    const clubRows = await query<ClubRow[]>(
      'SELECT id, name, grade, total_quota, remaining_quota FROM clubs WHERE id = ? LIMIT 1',
      [data.clubId],
      signal
    );

    if (clubRows.length === 0) {
      return { success: false, message: '社团不存在' };
    }

    if (clubRows[0].remaining_quota <= 0 && clubRows[0].grade) {
      return { success: false, message: '该社团名额已满' };
    }

    try {
      const result = await withTransaction(async (connection) => {
        const [studentRows] = await connection.execute<StudentRow[]>(
          `SELECT id, name, grade, class_name
           FROM students
           WHERE id_card = ? AND name = ?
           LIMIT 1
           FOR UPDATE`,
          [idCard, data.name]
        );

        if (studentRows.length === 0) {
          return {
            success: false,
            message: '学生信息不存在，请确认姓名和身份证号是否正确，或联系管理员导入学生信息',
          };
        }

        const student = studentRows[0];
        if (!student.grade) {
          return { success: false, message: '学生年级未设置，请联系管理员' };
        }

        const [registrationRows] = await connection.execute<RegistrationHashRow[]>(
          `SELECT id
           FROM registrations
           WHERE id_card_hash = ?
           LIMIT 1
           FOR UPDATE`,
          [idCardHash]
        );

        if (registrationRows.length > 0) {
          throw new DuplicateRegistrationError();
        }

        const [lockedClubRows] = await connection.execute<ClubRow[]>(
          `SELECT id, name, grade, total_quota, remaining_quota
           FROM clubs
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`,
          [data.clubId]
        );

        if (lockedClubRows.length === 0) {
          return { success: false, message: '社团不存在' };
        }

        const lockedClub = lockedClubRows[0];
        if (!lockedClub.grade) {
          return { success: false, message: '该社团暂未设置可报名年级' };
        }

        if (!clubAllowsGrade(lockedClub.grade, student.grade)) {
          return { success: false, message: '该社团不面向您的年级' };
        }

        const [quotaResult] = await connection.execute<ResultSetHeader>(
          `UPDATE clubs
           SET remaining_quota = remaining_quota - 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND remaining_quota > 0`,
          [data.clubId]
        );

        if (quotaResult.affectedRows === 0) {
          return { success: false, message: '该社团名额已满' };
        }

        let insertResult: ResultSetHeader;
        try {
          [insertResult] = await connection.execute<ResultSetHeader>(
            `INSERT INTO registrations (name, id_card_hash, class_name, club_id)
             VALUES (?, ?, ?, ?)`,
            [student.name, idCardHash, student.class_name, data.clubId]
          );
        } catch (error: any) {
          if (error?.code === 'ER_DUP_ENTRY') {
            throw new DuplicateRegistrationError();
          }
          throw error;
        }

        const [createdRows] = await connection.execute<RowDataPacket[]>(
          'SELECT created_at FROM registrations WHERE id = ?',
          [insertResult.insertId]
        );

        return {
          success: true,
          message: '报名成功',
          data: {
            id: insertResult.insertId,
            name: student.name,
            className: student.class_name,
            clubId: data.clubId,
            clubName: lockedClub.name,
            time: (createdRows[0]?.created_at ?? new Date()).toISOString(),
          },
        };
      }, signal);
      if (result.success) {
        clearClubsCache();
      }
      return result;
    } catch (error) {
      if (error instanceof DuplicateRegistrationError) {
        return { success: false, message: '该身份证号已报名过社团' };
      }
      throw error;
    }
  }

  static async getAllRegistrations() {
    const rows = await query<RegistrationRow[]>(
      `SELECT r.id,
              r.name,
              r.class_name,
              r.club_id,
              r.created_at,
              c.name AS club_name
       FROM registrations r
       LEFT JOIN clubs c ON c.id = r.club_id
       ORDER BY r.created_at DESC`
    );

    return rows.map((item) => ({
      id: item.id,
      name: item.name,
      className: item.class_name,
      clubId: item.club_id,
      clubName: item.club_name || '未知社团',
      time: item.created_at,
    }));
  }

  static async getStats() {
    const rows = await query<StatRow[]>(
      `SELECT c.name,
              COUNT(r.id) AS registered,
              c.remaining_quota AS remaining,
              c.total_quota AS total
       FROM clubs c
       LEFT JOIN registrations r ON r.club_id = c.id
       GROUP BY c.id, c.name, c.total_quota, c.remaining_quota
       ORDER BY c.name`
    );

    const stats: Record<string, any> = {};
    for (const row of rows) {
      stats[row.name] = {
        registered: Number(row.registered),
        remaining: Number(row.remaining),
        total: Number(row.total),
      };
    }

    return stats;
  }

  static async clearAllRegistrations(): Promise<{ success: boolean; message: string; clearedCount: number }> {
    const result = await withTransaction(async (connection) => {
      const [countRows] = await connection.execute<CountRow[]>(
        'SELECT COUNT(*) AS count FROM registrations'
      );
      const clearedCount = Number(countRows[0]?.count || 0);

      await connection.execute<ResultSetHeader>('DELETE FROM registrations');
      await connection.execute<ResultSetHeader>(
        `UPDATE clubs
         SET remaining_quota = total_quota,
             updated_at = CURRENT_TIMESTAMP`
      );

      return {
        success: true,
        message: `已清空 ${clearedCount} 条报名记录，所有社团名额已重置`,
        clearedCount,
      };
    });
    clearClubsCache();
    return result;
  }
}
