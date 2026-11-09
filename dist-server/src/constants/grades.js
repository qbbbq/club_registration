"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GradeSelectionError = exports.GRADES = void 0;
exports.isGrade = isGrade;
exports.parseGradeSelection = parseGradeSelection;
exports.parseStoredGrades = parseStoredGrades;
exports.serializeGrades = serializeGrades;
exports.clubAllowsGrade = clubAllowsGrade;
exports.GRADES = ['初一', '初二', '初三'];
function isGrade(value) {
    return typeof value === 'string' && exports.GRADES.includes(value);
}
class GradeSelectionError extends Error {
    constructor(message = '可报名年级必须至少选择一个，且只能选择初一、初二或初三') {
        super(message);
        this.name = 'GradeSelectionError';
    }
}
exports.GradeSelectionError = GradeSelectionError;
function splitGradeValue(value) {
    const parts = value.split(/[,，、]/).map((item) => item.trim());
    if (parts.some((item) => !item)) {
        throw new GradeSelectionError();
    }
    return parts;
}
function sortGrades(grades) {
    const selected = new Set(grades);
    return exports.GRADES.filter((grade) => selected.has(grade));
}
function parseGradeSelection(value) {
    let values;
    if (typeof value === 'string') {
        values = splitGradeValue(value);
    }
    else if (Array.isArray(value)) {
        values = value.map((item) => typeof item === 'string' ? item.trim() : item);
        if (values.some((item) => typeof item === 'string' && /[,，、]/.test(item))) {
            throw new GradeSelectionError();
        }
    }
    else {
        values = [];
    }
    if (values.length === 0) {
        throw new GradeSelectionError();
    }
    if (values.some((valueItem) => !isGrade(valueItem))) {
        throw new GradeSelectionError();
    }
    const grades = values;
    if (new Set(grades).size !== grades.length) {
        throw new GradeSelectionError('可报名年级不能重复');
    }
    return sortGrades(grades);
}
function parseStoredGrades(value) {
    if (typeof value !== 'string')
        return [];
    try {
        return parseGradeSelection(value);
    }
    catch {
        return [];
    }
}
function serializeGrades(grades) {
    return parseGradeSelection([...grades]).join(',');
}
function clubAllowsGrade(clubGrade, studentGrade) {
    return isGrade(studentGrade) && parseStoredGrades(clubGrade).includes(studentGrade);
}
