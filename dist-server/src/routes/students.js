"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const xlsx = __importStar(require("xlsx"));
const grades_1 = require("../constants/grades");
const mysql_client_1 = require("../storage/database/mysql-client");
const id_card_1 = require("../utils/id-card");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});
router.post('/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '请上传文件' });
        }
        const originalName = req.file.originalname.toLowerCase();
        let data = [];
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
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index]?.trim() || '';
                });
                data.push(row);
            }
        }
        else {
            const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            data = xlsx.utils.sheet_to_json(worksheet);
        }
        if (!data || data.length === 0) {
            return res.status(400).json({ success: false, message: '文件为空或格式不正确' });
        }
        let successCount = 0;
        let skipCount = 0;
        const errors = [];
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const idCard = (0, id_card_1.normalizeIdCard)(String(row['身份证号'] || row['身份证'] || row['idCard'] || row['id_card'] || ''));
            const name = String(row['姓名'] || row['name'] || '').trim();
            const grade = String(row['年级'] || row['grade'] || '').trim();
            const className = String(row['班级'] || row['class'] || row['className'] || '').trim();
            if (!idCard || !name || !grade || !className) {
                errors.push(`第${i + 2}行: 姓名、身份证号、年级、班级均不能为空`);
                skipCount++;
                continue;
            }
            if (!(0, grades_1.isGrade)(grade)) {
                errors.push(`第${i + 2}行: 年级必须是初一、初二或初三`);
                skipCount++;
                continue;
            }
            if (!/^\d{17}[\dXx]$/.test(idCard)) {
                errors.push(`第${i + 2}行: 身份证号格式不正确`);
                skipCount++;
                continue;
            }
            const existing = await (0, mysql_client_1.query)('SELECT id FROM students WHERE id_card = ? LIMIT 1', [idCard]);
            if (existing.length > 0) {
                try {
                    await (0, mysql_client_1.query)('UPDATE students SET name = ?, grade = ?, class_name = ? WHERE id_card = ?', [name, grade, className, idCard]);
                    successCount++;
                }
                catch (error) {
                    errors.push(`第${i + 2}行: 更新失败 - ${error.message}`);
                    skipCount++;
                }
            }
            else {
                try {
                    await (0, mysql_client_1.query)('INSERT INTO students (id_card, name, grade, class_name) VALUES (?, ?, ?, ?)', [idCard, name, grade, className]);
                    successCount++;
                }
                catch (error) {
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
    }
    catch (error) {
        console.error('导入学生信息错误:', error);
        res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
    }
});
router.get('/', async (req, res) => {
    try {
        const rows = await (0, mysql_client_1.query)('SELECT * FROM students ORDER BY created_at DESC');
        res.json(rows);
    }
    catch (error) {
        console.error('获取学生列表错误:', error);
        res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
    }
});
router.delete('/', async (req, res) => {
    try {
        await (0, mysql_client_1.query)('DELETE FROM students');
        res.json({ success: true, message: '学生信息已清空' });
    }
    catch (error) {
        console.error('清空学生信息错误:', error);
        res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
    }
});
router.post('/verify', async (req, res) => {
    try {
        const { idCard, name } = req.body;
        if (!idCard || !name) {
            return res.json({ valid: false, message: '请输入身份证号和姓名' });
        }
        const normalizedIdCard = (0, id_card_1.normalizeIdCard)(String(idCard));
        const rows = await (0, mysql_client_1.query)('SELECT class_name, grade FROM students WHERE id_card = ? AND name = ? LIMIT 1', [normalizedIdCard, name]);
        if (rows.length > 0) {
            res.json({
                valid: true,
                message: '验证通过',
                className: rows[0].class_name,
                grade: rows[0].grade,
            });
        }
        else {
            res.json({ valid: false, message: '学生信息不存在，请确认身份证号和姓名是否正确' });
        }
    }
    catch (error) {
        console.error('验证学生信息错误:', error);
        res.status(500).json({ valid: false, message: error.message || '服务器内部错误' });
    }
});
router.post('/lookup', async (req, res) => {
    try {
        const { idCard } = req.body;
        const normalizedIdCard = (0, id_card_1.normalizeIdCard)(String(idCard || ''));
        if (!normalizedIdCard || !/^\d{17}[\dXx]$/.test(normalizedIdCard)) {
            return res.status(400).json({ success: false, message: '身份证号格式不正确' });
        }
        const rows = await (0, mysql_client_1.query)('SELECT name, class_name, grade FROM students WHERE id_card = ? LIMIT 1', [normalizedIdCard]);
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
    }
    catch (error) {
        console.error('查询学生信息错误:', error);
        res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
    }
});
exports.default = router;
