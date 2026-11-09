# MySQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely replace Supabase with MySQL while keeping the existing Vue UI and Express API paths compatible.

**Architecture:** Add a focused MySQL connection layer using `mysql2/promise`, convert backend routes/services from Supabase query builders to SQL, and use MySQL transactions with row locks for registration consistency. Keep frontend contracts unchanged so Vue pages continue using the same `/api/*` endpoints and field names.

**Tech Stack:** Vue 3, TypeScript, Vite, Express 5, MySQL, `mysql2/promise`, `multer`, `xlsx`, `tsx`.

---

## File Structure

Create:

- `server/src/storage/database/mysql-client.ts` — owns environment loading, MySQL pool creation, query helper, and transaction helper.
- `server/src/storage/database/init.sql` — contains MySQL DDL for `clubs`, `students`, and `registrations`.

Modify:

- `package.json` — add `mysql2`, remove unused Supabase dependency if no imports remain after migration.
- `server/index.ts` — replace Supabase initialization with MySQL initialization queries.
- `server/src/services/registrationService.ts` — rewrite registration, stats, list, and clear logic using MySQL.
- `server/src/routes/register.ts` — replace student verification Supabase query with service-level MySQL registration flow.
- `server/src/routes/clubs.ts` — rewrite CRUD queries using MySQL.
- `server/src/routes/students.ts` — rewrite import/list/clear/verify queries using MySQL.
- `server/src/routes/registrations.ts` — keep route shape, call updated service.
- `server/src/routes/stats.ts` — keep route shape, call updated service.
- `server/src/routes/export.ts` — keep route shape, call updated service.
- `README.md` — document MySQL env vars and initialization.

Remove after all imports are gone:

- `server/src/storage/database/supabase-client.ts`

Leave in place but no longer use at runtime:

- `src/storage/database/shared/schema.ts`

---

### Task 1: Add MySQL Dependency and Schema SQL

**Files:**
- Modify: `package.json`
- Create: `server/src/storage/database/init.sql`

- [ ] **Step 1: Update dependencies**

Edit `package.json` dependencies so the database-related dependency block contains `mysql2` and no longer contains `@supabase/supabase-js`.

Expected dependency section after edit:

```json
"dependencies": {
  "@element-plus/icons-vue": "^2.3.2",
  "axios": "^1.13.6",
  "cors": "^2.8.6",
  "dotenv": "^17.3.1",
  "drizzle-orm": "^0.45.1",
  "element-plus": "^2.13.5",
  "express": "^5.2.1",
  "multer": "^2.1.1",
  "mysql2": "^3.15.3",
  "qrcode": "^1.5.4",
  "tsx": "^4.21.0",
  "vue": "^3.5.30",
  "vue-router": "^5.0.3",
  "xlsx": "^0.18.5"
}
```

- [ ] **Step 2: Install dependencies and update lockfile**

Run:

```powershell
pnpm install
```

Expected: command exits with code 0 and updates `pnpm-lock.yaml`.

- [ ] **Step 3: Create MySQL schema file**

Create `server/src/storage/database/init.sql` with this exact content:

```sql
CREATE DATABASE IF NOT EXISTS club_registration
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE club_registration;

CREATE TABLE IF NOT EXISTS clubs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  total_quota INT NOT NULL DEFAULT 50,
  remaining_quota INT NOT NULL DEFAULT 50,
  manager VARCHAR(50),
  manager_contact VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX clubs_name_idx (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  id_card VARCHAR(18) NOT NULL UNIQUE,
  class_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX students_name_idx (name),
  INDEX students_id_card_idx (id_card)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  id_card_hash CHAR(64) NOT NULL UNIQUE,
  class_name VARCHAR(100) NOT NULL,
  club_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX registrations_club_id_idx (club_id),
  CONSTRAINT registrations_club_fk FOREIGN KEY (club_id) REFERENCES clubs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Commit dependency and schema changes**

Run:

```powershell
git status
git add package.json pnpm-lock.yaml server/src/storage/database/init.sql docs/superpowers/specs/2026-06-28-mysql-migration-design.md docs/superpowers/plans/2026-06-28-mysql-migration.md
git commit -m "chore: add mysql schema and dependency"
```

Expected: commit succeeds. If this workspace is not a git repository, skip the commit and record that commit was skipped because `git status` reports no repository.

---

### Task 2: Add MySQL Client Layer

**Files:**
- Create: `server/src/storage/database/mysql-client.ts`

- [ ] **Step 1: Create MySQL client module**

Create `server/src/storage/database/mysql-client.ts` with this exact content:

```ts
import dotenv from 'dotenv';
import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

dotenv.config();

let pool: Pool | null = null;

interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function getMysqlConfig(): MysqlConfig {
  const portValue = process.env.MYSQL_PORT || '3306';
  const port = Number(portValue);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('MYSQL_PORT must be a positive integer');
  }

  return {
    host: requireEnv('MYSQL_HOST'),
    port,
    user: requireEnv('MYSQL_USER'),
    password: process.env.MYSQL_PASSWORD || '',
    database: requireEnv('MYSQL_DATABASE'),
  };
}

export function getPool(): Pool {
  if (!pool) {
    const config = getMysqlConfig();
    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      namedPlaceholders: false,
      charset: 'utf8mb4',
      timezone: '+00:00',
    });
  }

  return pool;
}

export async function query<T extends RowDataPacket[] | ResultSetHeader>(
  sql: string,
  params: unknown[] = []
): Promise<T> {
  const [rows] = await getPool().execute<T>(sql, params);
  return rows;
}

export async function withTransaction<T>(
  callback: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
```

- [ ] **Step 2: Run TypeScript build check**

Run:

```powershell
pnpm run build
```

Expected before later tasks: build may still pass because server files are not included in `tsconfig.node.json`; if dependency install is correct, no dependency resolution error should appear.

- [ ] **Step 3: Commit MySQL client**

Run:

```powershell
git status
git add server/src/storage/database/mysql-client.ts
git commit -m "feat: add mysql client layer"
```

Expected: commit succeeds. If not a git repository, skip and record why.

---

### Task 3: Rewrite Registration Service for MySQL

**Files:**
- Modify: `server/src/services/registrationService.ts`

- [ ] **Step 1: Replace service implementation**

Replace the full contents of `server/src/services/registrationService.ts` with:

```ts
import crypto from 'crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from '../storage/database/mysql-client';

interface RegistrationData {
  name: string;
  idCard: string;
  className: string;
  clubId: number;
}

interface ClubRow extends RowDataPacket {
  id: number;
  name: string;
  total_quota: number;
  remaining_quota: number;
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

export class RegistrationService {
  private static hashIdCard(idCard: string): string {
    return crypto.createHash('sha256').update(idCard).digest('hex');
  }

  static async checkDuplicateRegistration(idCardHash: string): Promise<boolean> {
    const rows = await query<RowDataPacket[]>(
      'SELECT id FROM registrations WHERE id_card_hash = ? LIMIT 1',
      [idCardHash]
    );

    return rows.length > 0;
  }

  static async checkQuota(clubId: number): Promise<{ available: boolean; remaining: number }> {
    const rows = await query<ClubRow[]>(
      'SELECT remaining_quota FROM clubs WHERE id = ? LIMIT 1',
      [clubId]
    );

    if (rows.length === 0) {
      throw new Error('社团不存在');
    }

    return {
      available: rows[0].remaining_quota > 0,
      remaining: rows[0].remaining_quota,
    };
  }

  static async register(data: RegistrationData): Promise<{ success: boolean; message: string }> {
    const idCardHash = this.hashIdCard(data.idCard);

    return withTransaction(async (connection) => {
      const [duplicateRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM registrations WHERE id_card_hash = ? LIMIT 1 FOR UPDATE',
        [idCardHash]
      );

      if (duplicateRows.length > 0) {
        return { success: false, message: '该身份证号已报名过社团' };
      }

      const [clubRows] = await connection.execute<ClubRow[]>(
        'SELECT id, name, total_quota, remaining_quota FROM clubs WHERE id = ? LIMIT 1 FOR UPDATE',
        [data.clubId]
      );

      if (clubRows.length === 0) {
        return { success: false, message: '社团不存在' };
      }

      const club = clubRows[0];
      if (club.remaining_quota <= 0) {
        return { success: false, message: '该社团名额已满' };
      }

      try {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO registrations (name, id_card_hash, class_name, club_id)
           VALUES (?, ?, ?, ?)`,
          [data.name, idCardHash, data.className, data.clubId]
        );
      } catch (error: any) {
        if (error?.code === 'ER_DUP_ENTRY') {
          return { success: false, message: '该身份证号已报名过社团' };
        }
        throw error;
      }

      await connection.execute<ResultSetHeader>(
        `UPDATE clubs
         SET remaining_quota = remaining_quota - 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [data.clubId]
      );

      return { success: true, message: '报名成功' };
    });
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
    return withTransaction(async (connection) => {
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
  }
}
```

- [ ] **Step 2: Run server syntax smoke check**

Run:

```powershell
npx tsx --no-watch server/index.ts
```

Expected: if MySQL env vars are not set, the command may fail with `MYSQL_HOST is not set`; that is acceptable at this stage and confirms the server is loading the MySQL path. Stop the process if it keeps running.

- [ ] **Step 3: Commit registration service rewrite**

Run:

```powershell
git status
git add server/src/services/registrationService.ts
git commit -m "feat: migrate registration service to mysql"
```

Expected: commit succeeds. If not a git repository, skip and record why.

---

### Task 4: Rewrite Register Route and Server Initialization

**Files:**
- Modify: `server/src/routes/register.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Replace register route implementation**

Replace `server/src/routes/register.ts` with:

```ts
import express from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { RegistrationService } from '../services/registrationService';
import { query } from '../storage/database/mysql-client';

const router = express.Router();

interface StudentClassRow extends RowDataPacket {
  class_name: string;
}

router.post('/', async (req, res) => {
  try {
    const { name, idCard, className, clubId } = req.body;

    if (!name || !idCard || !className || !clubId) {
      return res.status(400).json({
        success: false,
        message: '请填写完整信息',
      });
    }

    if (!/^\d{17}[\dXx]$/.test(idCard)) {
      return res.status(400).json({
        success: false,
        message: '身份证号格式不正确',
      });
    }

    const studentRows = await query<StudentClassRow[]>(
      'SELECT class_name FROM students WHERE id_card = ? AND name = ? LIMIT 1',
      [idCard, name]
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
      idCard,
      className: studentRows[0].class_name,
      clubId: parsedClubId,
    });

    res.json(result);
  } catch (error: any) {
    console.error('报名错误:', error);
    res.status(500).json({
      success: false,
      message: error.message || '服务器内部错误',
    });
  }
});

export default router;
```

- [ ] **Step 2: Update server initialization imports**

In `server/index.ts`, remove:

```ts
import { getSupabaseClient } from './src/storage/database/supabase-client';
```

Add:

```ts
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from './src/storage/database/mysql-client';
```

- [ ] **Step 3: Replace `initClubs()` in `server/index.ts`**

Replace the full `initClubs()` function with:

```ts
interface ExistingClubRow extends RowDataPacket {
  id: number;
}

async function initClubs() {
  try {
    const clubs = [
      { name: '编程社', description: '学习编程技术，参加竞赛', total_quota: 50, remaining_quota: 50 },
      { name: '篮球社', description: '篮球爱好者的聚集地', total_quota: 50, remaining_quota: 50 },
      { name: '足球社', description: '足球爱好者的聚集地', total_quota: 40, remaining_quota: 40 },
      { name: '音乐社', description: '音乐爱好者的聚集地', total_quota: 30, remaining_quota: 30 },
      { name: '摄影社', description: '学习摄影技术', total_quota: 25, remaining_quota: 25 },
      { name: '舞蹈社', description: '舞蹈爱好者的聚集地', total_quota: 35, remaining_quota: 35 },
      { name: '书法社', description: '传承书法艺术', total_quota: 20, remaining_quota: 20 },
      { name: '绘画社', description: '绘画爱好者的聚集地', total_quota: 25, remaining_quota: 25 },
    ];

    const existingClubs = await query<ExistingClubRow[]>(
      'SELECT id FROM clubs LIMIT 1'
    );

    if (existingClubs.length > 0) {
      console.log('社团数据已存在，跳过初始化');
      return;
    }

    for (const club of clubs) {
      await query<ResultSetHeader>(
        `INSERT INTO clubs (name, description, total_quota, remaining_quota)
         VALUES (?, ?, ?, ?)`,
        [club.name, club.description, club.total_quota, club.remaining_quota]
      );
    }

    console.log('✅ 社团数据初始化成功！');
  } catch (error: any) {
    console.error('初始化社团数据异常:', error.message);
  }
}
```

- [ ] **Step 4: Commit register route and initialization changes**

Run:

```powershell
git status
git add server/src/routes/register.ts server/index.ts
git commit -m "feat: migrate registration route and initialization"
```

Expected: commit succeeds. If not a git repository, skip and record why.

---

### Task 5: Rewrite Clubs Route for MySQL

**Files:**
- Modify: `server/src/routes/clubs.ts`

- [ ] **Step 1: Replace clubs route implementation**

Replace `server/src/routes/clubs.ts` with:

```ts
import express from 'express';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from '../storage/database/mysql-client';

const router = express.Router();

interface ClubRow extends RowDataPacket {
  id: number;
  name: string;
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

router.get('/', async (req, res) => {
  try {
    const rows = await query<ClubRow[]>('SELECT * FROM clubs ORDER BY id');
    res.json(rows);
  } catch (error: any) {
    console.error('获取社团列表错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, total_quota, manager, manager_contact } = req.body;
    const quota = Number(total_quota);

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: '社团名称不能为空' });
    }

    if (!Number.isInteger(quota) || quota < 1) {
      return res.status(400).json({ success: false, message: '最大报名人数必须大于0' });
    }

    const existing = await query<RowDataPacket[]>(
      'SELECT id FROM clubs WHERE name = ? LIMIT 1',
      [name.trim()]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '社团名称已存在' });
    }

    const result = await query<ResultSetHeader>(
      `INSERT INTO clubs (name, description, total_quota, remaining_quota, manager, manager_contact)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        description?.trim() || '',
        quota,
        quota,
        manager?.trim() || null,
        manager_contact?.trim() || null,
      ]
    );

    const insertedRows = await query<ClubRow[]>(
      'SELECT * FROM clubs WHERE id = ? LIMIT 1',
      [result.insertId]
    );

    res.json({ success: true, message: '社团创建成功', data: insertedRows[0] });
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

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '社团参数不正确' });
    }

    if (!Number.isInteger(quota) || quota < 1) {
      return res.status(400).json({ success: false, message: '最大报名人数必须大于0' });
    }

    const clubs = await query<ClubRow[]>(
      'SELECT * FROM clubs WHERE id = ? LIMIT 1',
      [id]
    );

    if (clubs.length === 0) {
      return res.status(404).json({ success: false, message: '社团不存在' });
    }

    const currentClub = clubs[0];
    const registered = currentClub.total_quota - currentClub.remaining_quota;
    const newRemaining = quota - registered;

    if (newRemaining < 0) {
      return res.status(400).json({ success: false, message: '最大报名人数不能小于已报名人数' });
    }

    await query<ResultSetHeader>(
      `UPDATE clubs
       SET total_quota = ?,
           remaining_quota = ?,
           manager = ?,
           manager_contact = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [quota, newRemaining, manager || null, manager_contact || null, id]
    );

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

    res.json({ success: true, message: `社团「${clubs[0].name}」已删除` });
  } catch (error: any) {
    console.error('删除社团错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});

export default router;
```

- [ ] **Step 2: Commit clubs route rewrite**

Run:

```powershell
git status
git add server/src/routes/clubs.ts
git commit -m "feat: migrate club routes to mysql"
```

Expected: commit succeeds. If not a git repository, skip and record why.

---

### Task 6: Rewrite Students Route for MySQL

**Files:**
- Modify: `server/src/routes/students.ts`

- [ ] **Step 1: Replace students route implementation**

Replace `server/src/routes/students.ts` with:

```ts
import express, { Request, Response } from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from '../storage/database/mysql-client';

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
      const idCard = String(row['身份证号'] || row['身份证'] || row['idCard'] || row['id_card'] || '').trim();
      const name = String(row['姓名'] || row['name'] || '').trim();
      const className = String(row['班级'] || row['class'] || row['className'] || '').trim();

      if (!idCard || !name || !className) {
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
            'UPDATE students SET name = ?, class_name = ? WHERE id_card = ?',
            [name, className, idCard]
          );
          successCount++;
        } catch (error: any) {
          errors.push(`第${i + 2}行: 更新失败 - ${error.message}`);
          skipCount++;
        }
      } else {
        try {
          await query<ResultSetHeader>(
            'INSERT INTO students (id_card, name, class_name) VALUES (?, ?, ?)',
            [idCard, name, className]
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
      'SELECT * FROM students ORDER BY created_at DESC LIMIT 1000'
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

    const rows = await query<StudentRow[]>(
      'SELECT class_name FROM students WHERE id_card = ? AND name = ? LIMIT 1',
      [idCard, name]
    );

    if (rows.length > 0) {
      res.json({ valid: true, message: '验证通过', className: rows[0].class_name });
    } else {
      res.json({ valid: false, message: '学生信息不存在，请确认身份证号和姓名是否正确' });
    }
  } catch (error: any) {
    console.error('验证学生信息错误:', error);
    res.status(500).json({ valid: false, message: error.message || '服务器内部错误' });
  }
});

export default router;
```

- [ ] **Step 2: Commit students route rewrite**

Run:

```powershell
git status
git add server/src/routes/students.ts
git commit -m "feat: migrate student routes to mysql"
```

Expected: commit succeeds. If not a git repository, skip and record why.

---

### Task 7: Remove Supabase Client and Clean Imports

**Files:**
- Delete: `server/src/storage/database/supabase-client.ts`
- Search/verify: all `server/**/*.ts`

- [ ] **Step 1: Search for Supabase imports**

Run:

```powershell
rg "supabase|Supabase|getSupabaseClient|COZE_SUPABASE" server src package.json
```

Expected before deletion: only `server/src/storage/database/supabase-client.ts`, `package.json` lock-related references, docs, or design text may contain Supabase. No route or service should import `getSupabaseClient`.

- [ ] **Step 2: Delete old Supabase client**

Delete:

```text
server/src/storage/database/supabase-client.ts
```

- [ ] **Step 3: Search again**

Run:

```powershell
rg "getSupabaseClient|@supabase/supabase-js|COZE_SUPABASE" server src package.json
```

Expected: no matches in runtime code. If `package.json` still references `@supabase/supabase-js`, remove it and run `pnpm install` again.

- [ ] **Step 4: Commit cleanup**

Run:

```powershell
git status
git add -A server/src/storage/database/supabase-client.ts package.json pnpm-lock.yaml
git commit -m "chore: remove supabase runtime dependency"
```

Expected: commit succeeds. If not a git repository, skip and record why.

---

### Task 8: Document MySQL Setup

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README content**

Replace `README.md` with:

````md
# 社团报名系统

这是一个 Vue 3 + Express + MySQL 的社团报名系统。

## 技术栈

- 前端：Vue 3、TypeScript、Vite、Element Plus
- 后端：Express、TypeScript、tsx
- 数据库：MySQL

## 环境变量

创建 `.env` 文件：

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=club_registration
```

## 初始化数据库

使用 MySQL 客户端执行：

```bash
mysql -u root -p < server/src/storage/database/init.sql
```

如果数据库用户不是 `root`，请替换为实际用户。

## 安装依赖

```bash
pnpm install
```

## 开发运行

```bash
pnpm run dev
```

默认端口：

- 前端：`http://localhost:5000`
- 后端：`http://localhost:3001`

开发环境下，Vite 会把 `/api` 代理到后端。

## 生产构建

```bash
pnpm run build
pnpm start
```

生产环境中，Express 会提供 `dist` 静态文件和 `/api` 接口。

## 默认后台账号

当前后台登录仍是前端模拟登录：

```text
admin / admin
```

注意：后端管理接口暂未实现真实鉴权，请勿直接暴露到公网。
````

- [ ] **Step 2: Commit README update**

Run:

```powershell
git status
git add README.md
git commit -m "docs: document mysql setup"
```

Expected: commit succeeds. If not a git repository, skip and record why.

---

### Task 9: Verify Build and Runtime with MySQL

**Files:**
- Verify all changed files

- [ ] **Step 1: Ensure MySQL database exists**

Run this outside PowerShell if using MySQL CLI, or run equivalent in your database tool:

```bash
mysql -u root -p < server/src/storage/database/init.sql
```

Expected: database `club_registration` and three tables exist.

- [ ] **Step 2: Create `.env`**

Create `.env` in project root with real MySQL credentials:

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=club_registration
```

- [ ] **Step 3: Run production build**

Run:

```powershell
pnpm run build
```

Expected: `vue-tsc -b && vite build` exits with code 0.

- [ ] **Step 4: Start backend**

Run:

```powershell
pnpm run dev:server
```

Expected: console prints `服务器运行在 http://localhost:3001`. If `clubs` is empty, it also prints `✅ 社团数据初始化成功！`.

- [ ] **Step 5: Verify health endpoint**

In another terminal, run:

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/health"
```

Expected JSON contains:

```json
{
  "status": "ok"
}
```

- [ ] **Step 6: Verify clubs endpoint**

Run:

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/clubs"
```

Expected: array of club records with `id`, `name`, `total_quota`, and `remaining_quota`.

- [ ] **Step 7: Verify student import manually through UI**

Run full app:

```powershell
pnpm run dev
```

Open `http://localhost:5000`, login with `admin/admin`, go to student management, download template, upload a file containing one valid student, and confirm the table displays the imported student.

- [ ] **Step 8: Verify registration manually through UI**

Open `http://localhost:5000/register`, register using the imported student's name and ID card, select a club, and submit.

Expected: success message `报名成功`, and selected club's remaining quota decreases by 1.

- [ ] **Step 9: Verify duplicate registration prevention**

Submit the same student again.

Expected: error message `该身份证号已报名过社团`.

- [ ] **Step 10: Verify clear registrations**

In admin page, clear registration data.

Expected: registrations table becomes empty and club remaining quota resets to total quota.

- [ ] **Step 11: Final commit**

Run:

```powershell
git status
git add -A
git commit -m "feat: replace supabase with mysql"
```

Expected: commit succeeds if there are uncommitted final adjustments. If not a git repository, skip and record why. If no files changed since prior commits, skip this commit.

---

## Plan Self-Review

- Spec coverage: covered MySQL connection, schema, env vars, API compatibility, registration transaction, initialization, students import, stats/export service path, cleanup, docs, and verification.
- Placeholder scan: no `TBD`, no incomplete implementation step, no generic “handle edge cases” without code.
- Type consistency: all service and route code imports `query`/`withTransaction` from `mysql-client.ts`; row types extend `RowDataPacket`; writes use `ResultSetHeader`.
