"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistrationService = void 0;
exports.formatOpenTime = formatOpenTime;
const grades_1 = require("../constants/grades");
const clubs_cache_1 = require("../routes/clubs-cache");
const mysql_client_1 = require("../storage/database/mysql-client");
const id_card_1 = require("../utils/id-card");
class DuplicateRegistrationError extends Error {
    constructor() {
        super('Duplicate registration');
        this.name = 'DuplicateRegistrationError';
    }
}
function formatOpenTime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    return `${utc8.getUTCFullYear()}年${pad(utc8.getUTCMonth() + 1)}月${pad(utc8.getUTCDate())}日 ${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}`;
}
class RegistrationService {
    static async register(data, signal) {
        const idCard = (0, id_card_1.normalizeIdCard)(data.idCard);
        const idCardHash = (0, id_card_1.hashIdCard)(idCard);
        const settingRows = await (0, mysql_client_1.query)('SELECT `value` FROM settings WHERE `key` = ? LIMIT 1', ['registration_open_at'], signal);
        if (settingRows.length > 0 && settingRows[0].value) {
            const openAt = new Date(settingRows[0].value);
            if (!Number.isNaN(openAt.getTime()) && openAt.getTime() > Date.now()) {
                return {
                    success: false,
                    message: `报名尚未开始，开放时间：${formatOpenTime(openAt)}`,
                };
            }
        }
        const clubRows = await (0, mysql_client_1.query)('SELECT id, name, grade, total_quota, remaining_quota FROM clubs WHERE id = ? LIMIT 1', [data.clubId], signal);
        if (clubRows.length === 0) {
            return { success: false, message: '社团不存在' };
        }
        if (clubRows[0].remaining_quota <= 0 && clubRows[0].grade) {
            return { success: false, message: '该社团名额已满' };
        }
        try {
            const result = await (0, mysql_client_1.withTransaction)(async (connection) => {
                const [studentRows] = await connection.execute(`SELECT id, name, grade, class_name
           FROM students
           WHERE id_card = ? AND name = ?
           LIMIT 1
           FOR UPDATE`, [idCard, data.name]);
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
                const [registrationRows] = await connection.execute(`SELECT id
           FROM registrations
           WHERE id_card_hash = ?
           LIMIT 1
           FOR UPDATE`, [idCardHash]);
                if (registrationRows.length > 0) {
                    throw new DuplicateRegistrationError();
                }
                const [lockedClubRows] = await connection.execute(`SELECT id, name, grade, total_quota, remaining_quota
           FROM clubs
           WHERE id = ?
           LIMIT 1
           FOR UPDATE`, [data.clubId]);
                if (lockedClubRows.length === 0) {
                    return { success: false, message: '社团不存在' };
                }
                const lockedClub = lockedClubRows[0];
                if (!lockedClub.grade) {
                    return { success: false, message: '该社团暂未设置可报名年级' };
                }
                if (!(0, grades_1.clubAllowsGrade)(lockedClub.grade, student.grade)) {
                    return { success: false, message: '该社团不面向您的年级' };
                }
                const [quotaResult] = await connection.execute(`UPDATE clubs
           SET remaining_quota = remaining_quota - 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND remaining_quota > 0`, [data.clubId]);
                if (quotaResult.affectedRows === 0) {
                    return { success: false, message: '该社团名额已满' };
                }
                let insertResult;
                try {
                    [insertResult] = await connection.execute(`INSERT INTO registrations (name, id_card_hash, class_name, club_id)
             VALUES (?, ?, ?, ?)`, [student.name, idCardHash, student.class_name, data.clubId]);
                }
                catch (error) {
                    if (error?.code === 'ER_DUP_ENTRY') {
                        throw new DuplicateRegistrationError();
                    }
                    throw error;
                }
                const [createdRows] = await connection.execute('SELECT created_at FROM registrations WHERE id = ?', [insertResult.insertId]);
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
                (0, clubs_cache_1.clearClubsCache)();
            }
            return result;
        }
        catch (error) {
            if (error instanceof DuplicateRegistrationError) {
                return { success: false, message: '该身份证号已报名过社团' };
            }
            throw error;
        }
    }
    static async getAllRegistrations() {
        const rows = await (0, mysql_client_1.query)(`SELECT r.id,
              r.name,
              r.class_name,
              r.club_id,
              r.created_at,
              c.name AS club_name
       FROM registrations r
       LEFT JOIN clubs c ON c.id = r.club_id
       ORDER BY r.created_at DESC`);
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
        const rows = await (0, mysql_client_1.query)(`SELECT c.name,
              COUNT(r.id) AS registered,
              c.remaining_quota AS remaining,
              c.total_quota AS total
       FROM clubs c
       LEFT JOIN registrations r ON r.club_id = c.id
       GROUP BY c.id, c.name, c.total_quota, c.remaining_quota
       ORDER BY c.name`);
        const stats = {};
        for (const row of rows) {
            stats[row.name] = {
                registered: Number(row.registered),
                remaining: Number(row.remaining),
                total: Number(row.total),
            };
        }
        return stats;
    }
    static async clearAllRegistrations() {
        const result = await (0, mysql_client_1.withTransaction)(async (connection) => {
            const [countRows] = await connection.execute('SELECT COUNT(*) AS count FROM registrations');
            const clearedCount = Number(countRows[0]?.count || 0);
            await connection.execute('DELETE FROM registrations');
            await connection.execute(`UPDATE clubs
         SET remaining_quota = total_quota,
             updated_at = CURRENT_TIMESTAMP`);
            return {
                success: true,
                message: `已清空 ${clearedCount} 条报名记录，所有社团名额已重置`,
                clearedCount,
            };
        });
        (0, clubs_cache_1.clearClubsCache)();
        return result;
    }
}
exports.RegistrationService = RegistrationService;
