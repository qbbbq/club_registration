"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudentRegistrationService = exports.StudentRegistrationValidationError = exports.StudentRegistrationNotFoundError = void 0;
const grades_1 = require("../constants/grades");
const clubs_cache_1 = require("../routes/clubs-cache");
const mysql_client_1 = require("../storage/database/mysql-client");
const id_card_1 = require("../utils/id-card");
const ID_CARD_REGEX = /^\d{17}[\dXx]$/;
class StudentRegistrationNotFoundError extends Error {
    statusCode = 404;
    constructor(message = '学生不存在') {
        super(message);
        this.name = 'StudentRegistrationNotFoundError';
    }
}
exports.StudentRegistrationNotFoundError = StudentRegistrationNotFoundError;
class StudentRegistrationValidationError extends Error {
    statusCode = 400;
    constructor(message) {
        super(message);
        this.name = 'StudentRegistrationValidationError';
    }
}
exports.StudentRegistrationValidationError = StudentRegistrationValidationError;
function assertValidIdCard(idCard) {
    if (!ID_CARD_REGEX.test(idCard)) {
        throw new StudentRegistrationValidationError('身份证号格式不正确');
    }
}
function assertValidUpdateInput(input) {
    const idCard = (0, id_card_1.normalizeIdCard)(input.idCard);
    const name = input.name.trim();
    const grade = input.grade.trim();
    const className = input.className.trim();
    if (!Number.isInteger(input.studentId) || input.studentId <= 0) {
        throw new StudentRegistrationValidationError('学生参数不正确');
    }
    if (!name || !className) {
        throw new StudentRegistrationValidationError('姓名和班级不能为空');
    }
    assertValidIdCard(idCard);
    if (!(0, grades_1.isGrade)(grade)) {
        throw new StudentRegistrationValidationError('年级必须是初一、初二或初三');
    }
    if (input.clubId !== null &&
        (!Number.isInteger(input.clubId) || input.clubId <= 0)) {
        throw new StudentRegistrationValidationError('社团参数不正确');
    }
    return {
        studentId: input.studentId,
        idCard,
        name,
        grade,
        className,
        clubId: input.clubId,
    };
}
function toView(student, registration) {
    return {
        student: {
            id: student.id,
            name: student.name,
            idCard: (0, id_card_1.normalizeIdCard)(student.id_card),
            grade: student.grade,
            className: student.class_name,
        },
        registration: registration
            ? {
                id: registration.id,
                clubId: registration.club_id,
                clubName: registration.club_name,
                time: registration.created_at,
            }
            : null,
    };
}
class StudentRegistrationService {
    static async lookup(idCard, signal) {
        const normalizedIdCard = (0, id_card_1.normalizeIdCard)(idCard);
        assertValidIdCard(normalizedIdCard);
        const studentRows = await (0, mysql_client_1.query)('SELECT id, name, id_card, grade, class_name FROM students WHERE id_card = ? LIMIT 1', [normalizedIdCard], signal);
        if (studentRows.length === 0) {
            throw new StudentRegistrationNotFoundError();
        }
        const registrationRows = await (0, mysql_client_1.query)(`SELECT r.id, r.club_id, r.created_at, c.name AS club_name
       FROM registrations r
       JOIN clubs c ON c.id = r.club_id
       WHERE r.id_card_hash = ?
       LIMIT 1`, [(0, id_card_1.hashIdCard)(normalizedIdCard)], signal);
        return toView(studentRows[0], registrationRows[0] ?? null);
    }
    static async update(input, signal) {
        const normalized = assertValidUpdateInput(input);
        let transactionResult;
        try {
            // Keep the student -> registration -> club order aligned with public registration.
            transactionResult = await (0, mysql_client_1.withTransaction)(async (connection) => {
                const [studentRows] = await connection.execute(`SELECT id, name, id_card, grade, class_name
         FROM students
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`, [normalized.studentId]);
                if (studentRows.length === 0) {
                    throw new StudentRegistrationNotFoundError();
                }
                const currentStudent = studentRows[0];
                // Duplicate probes stay non-locking; the unique keys are the final guard,
                // which avoids reverse waits when two admins swap identities.
                const [duplicateStudentRows] = await connection.execute(`SELECT id FROM students
          WHERE id_card = ? AND id <> ?
          LIMIT 1`, [normalized.idCard, currentStudent.id]);
                if (duplicateStudentRows.length > 0) {
                    throw new StudentRegistrationValidationError('身份证号已被其他学生使用');
                }
                const oldIdCardHash = (0, id_card_1.hashIdCard)(currentStudent.id_card);
                const newIdCardHash = (0, id_card_1.hashIdCard)(normalized.idCard);
                const [registrationRows] = await connection.execute(`SELECT id, name, id_card_hash, class_name, club_id, created_at
         FROM registrations
         WHERE id_card_hash = ?
         LIMIT 1
         FOR UPDATE`, [oldIdCardHash]);
                const currentRegistration = registrationRows[0] ?? null;
                if (normalized.idCard !== (0, id_card_1.normalizeIdCard)(currentStudent.id_card)) {
                    const [duplicateHashRows] = await connection.execute(`SELECT id FROM registrations
           WHERE id_card_hash = ? AND id <> ?
            LIMIT 1`, [newIdCardHash, currentRegistration?.id ?? 0]);
                    if (duplicateHashRows.length > 0) {
                        throw new StudentRegistrationValidationError('身份证号已存在报名记录');
                    }
                }
                if (currentRegistration && normalized.clubId === null) {
                    throw new StudentRegistrationValidationError('已有报名记录不能清空社团');
                }
                const currentClubId = currentRegistration?.club_id ?? null;
                const clubIds = [...new Set([currentClubId, normalized.clubId]
                        .filter((id) => id !== null))]
                    .sort((left, right) => left - right);
                let clubRows = [];
                if (clubIds.length > 0) {
                    const placeholders = clubIds.map(() => '?').join(', ');
                    const [lockedClubRows] = await connection.execute(`SELECT id, name, grade, total_quota, remaining_quota
           FROM clubs
           WHERE id IN (${placeholders})
           ORDER BY id
           FOR UPDATE`, clubIds);
                    clubRows = lockedClubRows;
                }
                const currentClub = currentClubId === null
                    ? null
                    : clubRows.find((club) => club.id === currentClubId) ?? null;
                const targetClub = normalized.clubId === null
                    ? null
                    : clubRows.find((club) => club.id === normalized.clubId) ?? null;
                if (normalized.clubId !== null) {
                    if (!targetClub) {
                        throw new StudentRegistrationValidationError('社团不存在');
                    }
                    const targetGrades = (0, grades_1.parseStoredGrades)(targetClub.grade);
                    // A legacy registration may point to a club whose grade was never set.
                    const keepingLegacyClub = currentRegistration !== null &&
                        currentClubId === targetClub.id &&
                        targetClub.grade === null;
                    if (targetGrades.length === 0 && !keepingLegacyClub) {
                        throw new StudentRegistrationValidationError('该社团暂未设置可报名年级');
                    }
                    if (targetGrades.length > 0 && !(0, grades_1.clubAllowsGrade)(targetClub.grade, normalized.grade)) {
                        throw new StudentRegistrationValidationError('该社团不面向学生所在年级');
                    }
                    const switchingClub = currentClubId === null || currentClubId !== targetClub.id;
                    if (switchingClub && targetClub.remaining_quota <= 0) {
                        throw new StudentRegistrationValidationError('该社团名额已满');
                    }
                }
                const [studentUpdateResult] = await connection.execute(`UPDATE students
         SET name = ?, id_card = ?, grade = ?, class_name = ?
         WHERE id = ?`, [normalized.name, normalized.idCard, normalized.grade, normalized.className, currentStudent.id]);
                if (studentUpdateResult.affectedRows === 0) {
                    throw new StudentRegistrationValidationError('学生信息未更新');
                }
                let clubsChanged = false;
                let resultRegistration = null;
                if (currentRegistration) {
                    if (currentClubId !== normalized.clubId) {
                        await connection.execute(`UPDATE clubs
             SET remaining_quota = remaining_quota + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`, [currentClubId]);
                        const [targetQuotaResult] = await connection.execute(`UPDATE clubs
             SET remaining_quota = remaining_quota - 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND remaining_quota > 0`, [normalized.clubId]);
                        if (targetQuotaResult.affectedRows === 0) {
                            throw new StudentRegistrationValidationError('该社团名额已满');
                        }
                        clubsChanged = true;
                    }
                    if (currentClubId !== normalized.clubId) {
                        await connection.execute(`UPDATE registrations
             SET name = ?, id_card_hash = ?, class_name = ?, club_id = ?
             WHERE id = ?`, [
                            normalized.name,
                            newIdCardHash,
                            normalized.className,
                            normalized.clubId,
                            currentRegistration.id,
                        ]);
                    }
                    else {
                        await connection.execute(`UPDATE registrations
             SET name = ?, id_card_hash = ?, class_name = ?
             WHERE id = ?`, [normalized.name, newIdCardHash, normalized.className, currentRegistration.id]);
                    }
                    resultRegistration = {
                        id: currentRegistration.id,
                        clubId: normalized.clubId,
                        clubName: targetClub?.name ?? currentClub?.name ?? '未知社团',
                        time: currentRegistration.created_at,
                    };
                }
                else if (targetClub) {
                    const [targetQuotaResult] = await connection.execute(`UPDATE clubs
           SET remaining_quota = remaining_quota - 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND remaining_quota > 0`, [targetClub.id]);
                    if (targetQuotaResult.affectedRows === 0) {
                        throw new StudentRegistrationValidationError('该社团名额已满');
                    }
                    const [insertResult] = await connection.execute(`INSERT INTO registrations (name, id_card_hash, class_name, club_id)
           VALUES (?, ?, ?, ?)`, [normalized.name, newIdCardHash, normalized.className, targetClub.id]);
                    const [createdRows] = await connection.execute('SELECT created_at FROM registrations WHERE id = ?', [insertResult.insertId]);
                    clubsChanged = true;
                    resultRegistration = {
                        id: insertResult.insertId,
                        clubId: targetClub.id,
                        clubName: targetClub.name,
                        time: createdRows[0]?.created_at ?? new Date(),
                    };
                }
                return {
                    clubsChanged,
                    view: {
                        student: {
                            id: currentStudent.id,
                            name: normalized.name,
                            idCard: normalized.idCard,
                            grade: normalized.grade,
                            className: normalized.className,
                        },
                        registration: resultRegistration,
                    },
                };
            }, signal);
        }
        catch (error) {
            if (error?.code === 'ER_DUP_ENTRY') {
                throw new StudentRegistrationValidationError('身份证号已被其他学生或报名记录使用');
            }
            throw error;
        }
        if (transactionResult.clubsChanged) {
            (0, clubs_cache_1.clearClubsCache)();
        }
        return transactionResult.view;
    }
}
exports.StudentRegistrationService = StudentRegistrationService;
