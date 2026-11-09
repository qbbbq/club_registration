# 年级字段与社团数据导入导出 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为社团和学生增加初一/初二/初三年级字段，支持社团 Excel/CSV 导入与 Excel 导出，并按学生年级限制报名社团。

**Architecture:** 在现有 MySQL `clubs`、`students` 表上增加可空 `grade` 列，使用后端固定年级校验兼容历史空值；扩展现有 Express 路由处理 CRUD、导入和导出；前端 Admin.vue 维护年级和社团文件，Register.vue 根据服务端返回的学生年级筛选社团，同时由 RegistrationService 做最终服务端校验。

**Tech Stack:** Express 5 + mysql2 + TypeScript；Vue 3 + Element Plus；xlsx；Vitest + Supertest；PM2 使用 `dist-server/index.js`。

**重要约束：**

- 合法年级只有 `初一`、`初二`、`初三`。
- 社团只能设置一个年级；学生只能设置一个年级。
- 历史数据年级允许为 `NULL`；新建、编辑、导入数据必须有合法年级。
- 社团导入按名称新增或更新；更新不能破坏已有报名记录。
- 项目当前没有 Git 仓库，所有计划中的 commit 步骤跳过；不要执行 `git init`。
- 生产服务使用 `dist-server/index.js`，后端改动必须执行 `corepack pnpm run build:server` 或 `corepack pnpm run deploy:build`。

## 文件职责映射

- Modify: `server/src/storage/database/init.sql` — 新环境的 MySQL 表结构
- Create: `server/src/storage/database/migrations/2026-09-05-add-grade-columns.sql` — 已有数据库迁移
- Create: `server/src/constants/grades.ts` — 后端合法年级常量与校验函数
- Modify: `src/storage/database/shared/schema.ts` — 同步未使用的旧 Drizzle 类型定义，避免文档结构漂移
- Modify/Test: `server/src/routes/students.ts`, `server/src/routes/students.test.ts` — 学生年级读写和导入
- Modify/Test: `server/src/routes/clubs.ts`, `server/src/routes/clubs.test.ts` — 社团 CRUD 年级、社团导入导出
- Modify/Test: `server/src/routes/register.ts`, `server/src/routes/register.test.ts` — 从学生查询传递真实年级
- Modify/Test: `server/src/services/registrationService.ts`, `server/src/services/registrationService.test.ts` — 服务端年级匹配校验
- Modify: `src/views/Admin.vue` — 社团/学生年级显示、编辑、导入和导出按钮
- Modify: `src/views/Register.vue` — 查询学生年级并筛选社团
- Modify: `docs/superpowers/specs/2026-09-05-grade-and-club-data-design.md` — 已确认设计文档，不再改变需求

---

### Task 1: 增加数据库字段、迁移脚本和年级常量

**Files:**
- Modify: `server/src/storage/database/init.sql`
- Create: `server/src/storage/database/migrations/2026-09-05-add-grade-columns.sql`
- Create: `server/src/constants/grades.ts`
- Modify: `src/storage/database/shared/schema.ts`

- [ ] **Step 1: 新增后端年级常量与类型守卫**

创建 `server/src/constants/grades.ts`：

```ts
export const GRADES = ['初一', '初二', '初三'] as const;

export type Grade = (typeof GRADES)[number];

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value);
}
```

- [ ] **Step 2: 更新新数据库初始化结构**

在 `clubs` 表中 `name` 后增加：

```sql
grade VARCHAR(10),
```

在 `students` 表中 `class_name` 后增加：

```sql
grade VARCHAR(10),
```

两个字段保持可空，不给历史兼容字段设置默认年级。

- [ ] **Step 3: 创建幂等迁移脚本**

创建 `server/src/storage/database/migrations/2026-09-05-add-grade-columns.sql`，使用 `information_schema.columns` 判断列是否存在，避免服务器重复执行时报错：

```sql
USE club_registration;

SET @add_club_grade = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE clubs ADD COLUMN grade VARCHAR(10) NULL AFTER name',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'clubs'
    AND column_name = 'grade'
);
PREPARE stmt FROM @add_club_grade;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_student_grade = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE students ADD COLUMN grade VARCHAR(10) NULL AFTER class_name',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'students'
    AND column_name = 'grade'
);
PREPARE stmt FROM @add_student_grade;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
```

- [ ] **Step 4: 同步旧 Drizzle schema 的两个字段**

在 `src/storage/database/shared/schema.ts` 中：

```ts
grade: varchar('grade', { length: 10 }),
```

分别加入 `clubs` 和 `students` 定义。该文件当前不是运行时 MySQL 数据源，但保持结构同步。

- [ ] **Step 5: 执行静态类型检查**

Run: `npx tsc --noEmit`

Expected: exit code 0。

- [ ] **Step 6: 提交（项目无 Git 仓库，跳过）**

不要执行提交命令；确认迁移文件和初始化文件均在工作区。

---

### Task 2: 学生年级读写与导入（TDD）

**Files:**
- Modify: `server/src/routes/students.ts`
- Modify: `server/src/routes/students.test.ts`

- [ ] **Step 1: 先更新测试，覆盖学生列表和 lookup 的 grade**

更新已有测试 mock 数据和 SQL 断言：

```ts
vi.mocked(mysqlClient.query).mockResolvedValue([
  { name: '张三', class_name: '初一(1)班', grade: '初一' },
] as any);

expect(response.body).toEqual({
  success: true,
  data: { name: '张三', className: '初一(1)班', grade: '初一' },
});
expect(mysqlClient.query).toHaveBeenCalledWith(
  'SELECT name, class_name, grade FROM students WHERE id_card = ? LIMIT 1',
  ['123456789012345678']
);
```

新增两个失败用例：

```ts
it('imports a student with a valid grade', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  vi.mocked(mysqlClient.query)
    .mockResolvedValueOnce([] as any)
    .mockResolvedValueOnce({ affectedRows: 1 } as any);
  const app = await createApp();
  const file = Buffer.from(
    '姓名\t身份证号\t年级\t班级\n张三\t123456789012345678\t初一\t初一(1)班',
    'utf-8'
  );

  const response = await request(app)
    .post('/api/students/import')
    .attach('file', file, 'students.txt');

  expect(response.status).toBe(200);
  expect(response.body.data.successCount).toBe(1);
  expect(mysqlClient.query).toHaveBeenNthCalledWith(
    2,
    'INSERT INTO students (id_card, name, grade, class_name) VALUES (?, ?, ?, ?)',
    ['123456789012345678', '张三', '初一', '初一(1)班']
  );
});

it('skips a student row with an invalid grade', async () => {
  const app = await createApp();
  const file = Buffer.from(
    '姓名\t身份证号\t年级\t班级\n张三\t123456789012345678\t高一\t初一(1)班',
    'utf-8'
  );

  const response = await request(app)
    .post('/api/students/import')
    .attach('file', file, 'students.txt');

  expect(response.status).toBe(200);
  expect(response.body.data.successCount).toBe(0);
  expect(response.body.data.skipCount).toBe(1);
  expect(response.body.data.errors[0]).toContain('年级');
});
```

- [ ] **Step 2: 运行学生路由测试，确认先失败**

Run: `corepack pnpm test -- server/src/routes/students.test.ts`

Expected: 新增测试失败，原因是当前 lookup SQL、导入字段和 INSERT SQL 尚未包含 grade。

- [ ] **Step 3: 修改 StudentRow 和导入字段解析**

在 `students.ts` 的 `StudentRow` 增加：

```ts
grade: string | null;
```

在导入循环中解析：

```ts
const grade = String(row['年级'] || row['grade'] || '').trim();

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
```

在文件顶部加入：

```ts
import { isGrade } from '../constants/grades';
```

- [ ] **Step 4: 修改学生 INSERT/UPDATE 和查询响应**

将更新 SQL 改为：

```ts
await query<ResultSetHeader>(
  'UPDATE students SET name = ?, grade = ?, class_name = ? WHERE id_card = ?',
  [name, grade, className, idCard]
);
```

将插入 SQL 改为：

```ts
await query<ResultSetHeader>(
  'INSERT INTO students (id_card, name, grade, class_name) VALUES (?, ?, ?, ?)',
  [idCard, name, grade, className]
);
```

将 verify 查询改为：

```ts
const rows = await query<StudentRow[]>(
  'SELECT class_name, grade FROM students WHERE id_card = ? AND name = ? LIMIT 1',
  [idCard, name]
);
```

成功响应增加：

```ts
grade: rows[0].grade,
```

将 lookup 查询和响应改为：

```ts
const rows = await query<StudentRow[]>(
  'SELECT name, class_name, grade FROM students WHERE id_card = ? LIMIT 1',
  [idCard]
);

res.json({
  success: true,
  data: {
    name: rows[0].name,
    className: rows[0].class_name,
    grade: rows[0].grade,
  },
});
```

- [ ] **Step 5: 运行学生路由测试确认通过**

Run: `corepack pnpm test -- server/src/routes/students.test.ts`

Expected: 学生路由测试全部 PASS。

- [ ] **Step 6: 提交（项目无 Git 仓库，跳过）**

不要执行提交命令。

---

### Task 3: 社团 CRUD 年级字段（TDD）

**Files:**
- Modify: `server/src/routes/clubs.ts`
- Modify: `server/src/routes/clubs.test.ts`

- [ ] **Step 1: 先扩展社团路由测试**

更新已有 POST 测试请求和 INSERT 断言，示例：

```ts
await request(app).post('/api/clubs').send({
  name: '机器人社',
  description: '机器人活动',
  grade: '初一',
  total_quota: 30,
  manager: '李老师',
  manager_contact: '13800000000',
});

expect(mysqlClient.query).toHaveBeenNthCalledWith(
  2,
  expect.stringContaining('INSERT INTO clubs'),
  ['机器人社', '机器人活动', '初一', 30, 30, '李老师', '13800000000']
);
```

新增测试：

```ts
it('rejects a club with an invalid grade', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  const app = await createApp();

  const response = await request(app).post('/api/clubs').send({
    name: '机器人社',
    description: '机器人活动',
    grade: '高一',
    total_quota: 30,
  });

  expect(response.status).toBe(400);
  expect(response.body.message).toContain('年级');
  expect(mysqlClient.query).not.toHaveBeenCalled();
});

it('updates a club grade without changing registered quota', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  vi.mocked(mysqlClient.query)
    .mockResolvedValueOnce([{
      id: 1,
      name: '编程社',
      grade: '初一',
      total_quota: 30,
      remaining_quota: 28,
    }] as any)
    .mockResolvedValueOnce({ affectedRows: 1 } as any);
  const app = await createApp();

  const response = await request(app).put('/api/clubs/1').send({
    grade: '初二',
    total_quota: 30,
    manager: '李老师',
    manager_contact: '13800000000',
  });

  expect(response.status).toBe(200);
  expect(mysqlClient.query).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining('UPDATE clubs'),
    ['初二', 30, 28, '李老师', '13800000000', 1]
  );
});
```

- [ ] **Step 2: 运行社团路由测试确认先失败**

Run: `corepack pnpm test -- server/src/routes/clubs.test.ts`

Expected: 新增/更新请求因为当前路由没有读取或写入 grade 而失败。

- [ ] **Step 3: 增加年级类型和 POST 校验**

在 `clubs.ts` 引入：

```ts
import { isGrade } from '../constants/grades';
```

给 `ClubRow` 增加：

```ts
grade: string | null;
```

在 POST 路由读取并校验：

```ts
const { name, description, grade, total_quota, manager, manager_contact } = req.body;

if (!isGrade(grade)) {
  return res.status(400).json({ success: false, message: '年级必须是初一、初二或初三' });
}
```

将 INSERT 改为：

```ts
`INSERT INTO clubs (name, description, grade, total_quota, remaining_quota, manager, manager_contact)
 VALUES (?, ?, ?, ?, ?, ?, ?)`
```

参数顺序：

```ts
[name.trim(), description?.trim() || '', grade, quota, quota, manager?.trim() || null, manager_contact?.trim() || null]
```

- [ ] **Step 4: 增加 PUT 年级校验和更新**

在 PUT 路由读取 `grade`，使用同样的 `isGrade(grade)` 校验。将 UPDATE 改为：

```ts
`UPDATE clubs
 SET grade = ?,
     total_quota = ?,
     remaining_quota = ?,
     manager = ?,
     manager_contact = ?,
     updated_at = CURRENT_TIMESTAMP
 WHERE id = ?`
```

参数顺序：

```ts
[grade, quota, newRemaining, manager || null, manager_contact || null, id]
```

历史年级为空的社团在后台编辑时必须重新选择年级后才能保存。

- [ ] **Step 5: 运行社团 CRUD 测试确认通过**

Run: `corepack pnpm test -- server/src/routes/clubs.test.ts`

Expected: 社团路由测试全部 PASS。

- [ ] **Step 6: 提交（项目无 Git 仓库，跳过）**

不要执行提交命令。

---

### Task 4: 社团导入和 Excel 导出（TDD）

**Files:**
- Modify: `server/src/routes/clubs.ts`
- Modify: `server/src/routes/clubs.test.ts`

- [ ] **Step 1: 先写社团导入测试**

在 `clubs.test.ts` 增加 CSV 新增测试：

```ts
it('imports a new club from CSV', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  vi.mocked(mysqlClient.query)
    .mockResolvedValueOnce([] as any)
    .mockResolvedValueOnce({ insertId: 7, affectedRows: 1 } as any);
  const app = await createApp();
  const file = Buffer.from(
    '社团名称,社团描述,年级,最大报名人数,社团负责人,负责人联系方式\n机器人社,机器人活动,初一,30,李老师,13800000000',
    'utf-8'
  );

  const response = await request(app)
    .post('/api/clubs/import')
    .attach('file', file, 'clubs.csv');

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    success: true,
    data: { createdCount: 1, updatedCount: 0, skipCount: 0 },
  });
  expect(mysqlClient.query).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining('INSERT INTO clubs'),
    ['机器人社', '机器人活动', '初一', 30, 30, '李老师', '13800000000']
  );
});
```

增加更新测试：已存在记录 `{ id: 1, total_quota: 30, remaining_quota: 28 }`，导入总名额 30 时执行 UPDATE，新的剩余名额为 28。

增加名额冲突测试：已报名人数为 2，导入总名额 1，接口返回 `skipCount: 1` 和包含“最大报名人数不能小于已报名人数”的错误，且不执行 UPDATE。

- [ ] **Step 2: 运行导入测试确认先失败**

Run: `corepack pnpm test -- server/src/routes/clubs.test.ts`

Expected: `/api/clubs/import` 当前不存在，新增测试失败。

- [ ] **Step 3: 增加上传解析和字段映射**

在 `clubs.ts` 增加：

```ts
import multer from 'multer';
import * as xlsx from 'xlsx';
import { isGrade } from '../constants/grades';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
```

使用统一解析逻辑，Excel 与 CSV 都通过 `xlsx.read`：

```ts
function parseUploadedClubs(buffer: Buffer): Record<string, unknown>[] {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
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
```

字段映射使用：

```ts
const name = valueOf(row, '社团名称', 'name');
const description = valueOf(row, '社团描述', 'description');
const grade = valueOf(row, '年级', 'grade');
const totalQuota = Number(valueOf(row, '最大报名人数', 'total_quota'));
const manager = valueOf(row, '社团负责人', 'manager');
const managerContact = valueOf(row, '负责人联系方式', 'manager_contact');
```

- [ ] **Step 4: 实现按名称新增/更新和错误汇总**

新增以下完整路由：

```ts
router.post('/import', upload.single('file'), async (req, res) => {
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
      const grade = valueOf(row, '年级', 'grade');
      const totalQuota = Number(valueOf(row, '最大报名人数', 'total_quota'));
      const manager = valueOf(row, '社团负责人', 'manager');
      const managerContact = valueOf(row, '负责人联系方式', 'manager_contact');

      if (!name || !isGrade(grade) || !Number.isInteger(totalQuota) || totalQuota < 1) {
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
        continue;
      }

      const registered = Number(existing[0].total_quota) - Number(existing[0].remaining_quota);
      const newRemaining = totalQuota - registered;
      if (newRemaining < 0) {
        errors.push(`第${line}行: 最大报名人数不能小于已报名人数`);
        skipCount++;
        continue;
      }

      await query<ResultSetHeader>(
        `UPDATE clubs
         SET description = ?, grade = ?, total_quota = ?, remaining_quota = ?,
             manager = ?, manager_contact = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [description, grade, totalQuota, newRemaining, manager || null, managerContact || null, existing[0].id]
      );
      updatedCount++;
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
    console.error('导入社团数据错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});
```

每一行的实际写入 SQL 必须与 Task 3 保持一致：

```sql
INSERT INTO clubs
  (name, description, grade, total_quota, remaining_quota, manager, manager_contact)
VALUES (?, ?, ?, ?, ?, ?, ?)
```

```sql
UPDATE clubs
SET description = ?, grade = ?, total_quota = ?, remaining_quota = ?,
    manager = ?, manager_contact = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?
```

- [ ] **Step 5: 先写并实现 Excel 导出测试**

新增测试：mock 一条带 grade 的社团，调用 `/api/clubs/export`，检查：

```ts
expect(response.status).toBe(200);
expect(response.headers['content-type']).toContain(
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
);
expect(response.headers['content-disposition']).toContain('.xlsx');

const workbook = xlsx.read(response.body, { type: 'buffer' });
const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
expect(rows[0]).toMatchObject({ 社团名称: '编程社', 年级: '初一' });
```

实现导出路由：

```ts
router.get('/export', async (req, res) => {
  const rows = await query<ClubRow[]>(
    `SELECT name, description, grade, total_quota, remaining_quota,
            manager, manager_contact, created_at, updated_at
     FROM clubs ORDER BY id`
  );
  const worksheet = xlsx.utils.json_to_sheet(rows.map((club) => ({
    社团名称: club.name,
    社团描述: club.description || '',
    年级: club.grade || '',
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
});
```

将 `/api/clubs/export` 路由放在动态路由之前，并保留现有 `/api/export` 报名记录导出。

- [ ] **Step 6: 运行社团导入导出测试**

Run: `corepack pnpm test -- server/src/routes/clubs.test.ts`

Expected: 社团 CRUD、导入和导出测试全部 PASS。

- [ ] **Step 7: 提交（项目无 Git 仓库，跳过）**

不要执行提交命令。

---

### Task 5: 报名接口和服务端年级校验（TDD）

**Files:**
- Modify: `server/src/routes/register.ts`
- Modify: `server/src/routes/register.test.ts`
- Modify: `server/src/services/registrationService.ts`
- Modify: `server/src/services/registrationService.test.ts`

- [ ] **Step 1: 先扩展报名路由测试**

把 `StudentClassRow` mock 从只返回 `class_name` 改为：

```ts
[{ class_name: '初一(1)班', grade: '初一' }]
```

并将服务调用断言增加：

```ts
studentGrade: '初一'
```

新增路由 SQL 断言：

```ts
expect(mysqlClient.query).toHaveBeenCalledWith(
  'SELECT class_name, grade FROM students WHERE id_card = ? AND name = ? LIMIT 1',
  ['123456789012345678', '张三']
);
```

- [ ] **Step 2: 先写 RegistrationService 的年级失败测试**

为 `RegistrationData` 增加 `studentGrade: string | null` 后，新增以下行为测试：

```ts
it('rejects registration when student and club grades do not match', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  vi.mocked(mysqlClient.query)
    .mockResolvedValueOnce([] as any) // 未设置开放时间
    .mockResolvedValueOnce([{
      id: 1,
      name: '编程社',
      grade: '初二',
      total_quota: 30,
      remaining_quota: 30,
    }] as any);

  const { RegistrationService } = await import('./registrationService');
  const result = await RegistrationService.register({
    name: '张三',
    idCard: '123456789012345678',
    className: '初一(1)班',
    studentGrade: '初一',
    clubId: 1,
  });

  expect(result).toEqual({ success: false, message: '该社团不面向您的年级' });
});

it('rejects registration when student grade is missing', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  vi.mocked(mysqlClient.query)
    .mockResolvedValueOnce([] as any)
    .mockResolvedValueOnce([{ id: 1, name: '编程社', grade: '初一', total_quota: 30, remaining_quota: 30 }] as any);

  const { RegistrationService } = await import('./registrationService');
  const result = await RegistrationService.register({
    name: '张三',
    idCard: '123456789012345678',
    className: '初一(1)班',
    studentGrade: null,
    clubId: 1,
  });

  expect(result).toEqual({ success: false, message: '学生年级未设置，请联系管理员' });
});
```

增加匹配年级成功测试，mock `grade: '初一'` 和 `studentGrade: '初一'`，确认原有报名成功结果仍然成立。

- [ ] **Step 3: 运行相关测试确认先失败**

Run: `corepack pnpm test -- server/src/routes/register.test.ts server/src/services/registrationService.test.ts`

Expected: 新增测试失败，因为现有数据结构和报名服务尚未读取年级。

- [ ] **Step 4: 修改报名路由读取并传递学生年级**

在 `register.ts` 中：

```ts
interface StudentClassRow extends RowDataPacket {
  class_name: string;
  grade: string | null;
}
```

将查询改为：

```ts
const studentRows = await query<StudentClassRow[]>(
  'SELECT class_name, grade FROM students WHERE id_card = ? AND name = ? LIMIT 1',
  [idCard, name]
);
```

调用服务时传递：

```ts
studentGrade: studentRows[0].grade,
```

- [ ] **Step 5: 修改 RegistrationService 校验社团年级**

给 `RegistrationData` 增加：

```ts
studentGrade: string | null;
```

给 `ClubRow` 增加：

```ts
grade: string | null;
```

将社团查询增加 grade：

```ts
const clubRows = await query<ClubRow[]>(
  'SELECT id, name, grade, total_quota, remaining_quota FROM clubs WHERE id = ? LIMIT 1',
  [data.clubId],
  signal
);
```

在社团存在判断之后、扣减名额之前加入：

```ts
const club = clubRows[0];

if (!data.studentGrade) {
  return { success: false, message: '学生年级未设置，请联系管理员' };
}

if (!club.grade) {
  return { success: false, message: '该社团暂未设置可报名年级' };
}

if (club.grade !== data.studentGrade) {
  return { success: false, message: '该社团不面向您的年级' };
}
```

保留后续开放时间、名额、重复报名和事务逻辑。

- [ ] **Step 6: 运行报名测试确认通过**

Run: `corepack pnpm test -- server/src/routes/register.test.ts server/src/services/registrationService.test.ts`

Expected: 路由和服务测试全部 PASS。

- [ ] **Step 7: 提交（项目无 Git 仓库，跳过）**

不要执行提交命令。

---

### Task 6: Admin.vue 增加年级和社团导入导出

**Files:**
- Modify: `src/views/Admin.vue`

- [ ] **Step 1: 增加前端年级选项和表单字段**

在 `<script setup>` 顶部增加：

```ts
const GRADE_OPTIONS = ['初一', '初二', '初三']
```

给 `editForm`、`addForm` 增加：

```ts
grade: ''
```

`handleEdit` 赋值：

```ts
grade: club.grade || ''
```

`handleAdd` 重置：

```ts
grade: ''
```

在 `handleSave` 和 `handleSaveAdd` 请求前增加：

```ts
if (!GRADE_OPTIONS.includes(editForm.value.grade)) {
  ElMessage.warning('请选择年级')
  return
}
```

`handleSaveAdd` 使用同样的判断，但字段改为 `addForm.value.grade`。

- [ ] **Step 2: 增加社团导入导出状态与请求方法**

在导入学生状态附近增加：

```ts
const clubImportDialogVisible = ref(false)
const clubImportLoading = ref(false)
const selectedClubFile = ref<File | null>(null)
const clubImportResult = ref<{
  createdCount: number
  updatedCount: number
  skipCount: number
  errors: string[]
} | null>(null)
```

增加文件选择、导入、关闭和导出方法：

```ts
const handleClubFileChange = (file: unknown) => {
  selectedClubFile.value = getRawFile(file)
  return false
}

const handleClubImport = async () => {
  if (!selectedClubFile.value) {
    ElMessage.warning('请选择社团文件')
    return
  }

  clubImportLoading.value = true
  const formData = new FormData()
  formData.append('file', selectedClubFile.value)

  try {
    const response = await axios.post('/api/clubs/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (response.data.success) {
      clubImportResult.value = response.data.data
      ElMessage.success(response.data.message || '社团导入成功')
      await loadClubs()
    } else {
      ElMessage.error(response.data.message || '社团导入失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '社团导入失败')
    console.error(error)
  } finally {
    clubImportLoading.value = false
  }
}

const closeClubImportDialog = () => {
  clubImportDialogVisible.value = false
  selectedClubFile.value = null
  clubImportResult.value = null
}

const handleClubExport = async () => {
  try {
    const response = await axios.get('/api/clubs/export', { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.download = `clubs_${Date.now()}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    ElMessage.success('社团数据导出成功')
  } catch (error: any) {
    ElMessage.error('社团数据导出失败')
    console.error(error)
  }
}
```

- [ ] **Step 3: 更新社团列表和表单模板**

在社团表中增加：

```html
<el-table-column prop="grade" label="可报名年级" width="120">
  <template #default="{ row }">
    {{ row.grade || '未设置' }}
  </template>
</el-table-column>
```

在新增和编辑表单中增加：

```html
<el-form-item label="可报名年级" required>
  <el-select v-model="editForm.grade" placeholder="请选择年级" style="width: 100%">
    <el-option v-for="grade in GRADE_OPTIONS" :key="grade" :label="grade" :value="grade" />
  </el-select>
</el-form-item>
```

新增表单使用 `addForm.grade`，编辑表单使用 `editForm.grade`。

在社团管理卡片的按钮区增加：

```html
<el-button type="primary" @click="clubImportDialogVisible = true" :icon="'Upload'">
  导入社团
</el-button>
<el-button type="info" @click="handleClubExport" :icon="'Download'">
  导出 Excel
</el-button>
```

- [ ] **Step 4: 更新学生表和学生导入说明**

在学生表中，身份证号列后增加：

```html
<el-table-column prop="grade" label="年级" width="100">
  <template #default="{ row }">
    {{ row.grade || '未设置' }}
  </template>
</el-table-column>
```

将学生导入说明改为：

```html
<p>1. 支持 Excel 文件（.xlsx, .xls）或文本文件（.txt, .csv）</p>
<p>2. 文件需包含：姓名、身份证号、年级、班级 四列</p>
<p>3. Excel 表头列名：姓名/身份证号/年级/班级 或 name/idCard/grade/className</p>
<p>4. 文本文件以 Tab 分隔，第一行为表头</p>
```

更新 `downloadTemplate` 内容：

```ts
const template =
  '姓名\t身份证号\t年级\t班级\n张三\t123456789012345678\t初一\t初一(1)班\n李四\t987654321098765432\t初二\t初二(2)班'
```

- [ ] **Step 5: 增加社团导入对话框**

在学生导入对话框之前增加：

```html
<el-dialog
  v-model="clubImportDialogVisible"
  title="导入社团数据"
  width="520px"
  @close="closeClubImportDialog"
>
  <el-alert title="导入说明" type="info" :closable="false">
    <template #default>
      <p>支持 .xlsx、.xls、.csv 文件。</p>
      <p>必填列：社团名称、年级、最大报名人数。</p>
      <p>同名社团会更新，不同名社团会新增。</p>
    </template>
  </el-alert>

  <el-upload
    :auto-upload="false"
    :limit="1"
    :on-change="handleClubFileChange"
    accept=".xlsx,.xls,.csv"
    drag
  >
    <el-icon class="el-icon--upload"><upload-filled /></el-icon>
    <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
  </el-upload>

  <div v-if="clubImportResult" class="import-result">
    <el-divider />
    <p>新增：{{ clubImportResult.createdCount }} 条</p>
    <p>更新：{{ clubImportResult.updatedCount }} 条</p>
    <p>跳过：{{ clubImportResult.skipCount }} 条</p>
    <ul v-if="clubImportResult.errors.length > 0">
      <li v-for="(error, index) in clubImportResult.errors" :key="index">{{ error }}</li>
    </ul>
  </div>

  <template #footer>
    <el-button @click="closeClubImportDialog">取消</el-button>
    <el-button type="primary" @click="handleClubImport" :loading="clubImportLoading">
      开始导入
    </el-button>
  </template>
</el-dialog>
```

- [ ] **Step 6: 运行前端类型检查和构建**

Run: `npx tsc --noEmit`

Expected: exit code 0。

Run: `corepack pnpm run build`

Expected: Vite 构建成功。

- [ ] **Step 7: 提交（项目无 Git 仓库，跳过）**

不要执行提交命令。

---

### Task 7: Register.vue 按学生年级筛选社团

**Files:**
- Modify: `src/views/Register.vue`

- [ ] **Step 1: 增加学生年级和查询状态**

在社团状态附近增加：

```ts
const studentGrade = ref<string | null>(null)
const studentLookupComplete = ref(false)

const visibleClubs = computed(() => {
  if (!studentLookupComplete.value || !studentGrade.value) return []
  return clubs.value.filter((club) => club.grade === studentGrade.value)
})
```

社团加载映射增加：

```ts
grade: club.grade,
```

- [ ] **Step 2: 在身份证变更时清空年级和社团选择**

当身份证输入变化时增加：

```ts
studentGrade.value = null
studentLookupComplete.value = false
form.value.clubId = ''
```

查询成功时设置：

```ts
form.value.name = response.data.data.name
form.value.className = response.data.data.className
studentGrade.value = response.data.data.grade ?? null
studentLookupComplete.value = true

if (!studentGrade.value) {
  ElMessage.warning('学生年级未设置，请联系管理员补全')
}
```

查询返回无学生数据时也设置 `studentLookupComplete.value = true`，并清空 `studentGrade`。

- [ ] **Step 3: 增加年级展示和状态提示**

在班级表单项后增加：

```html
<el-form-item label="年级">
  <el-tag v-if="studentGrade" size="large" type="success" class="student-tag">
    {{ studentGrade }}
  </el-tag>
  <span v-else class="tag-placeholder">请输入身份证号后自动带出</span>
</el-form-item>
```

在社团表单项前增加状态提示：

```html
<el-alert
  v-if="studentLookupComplete && !studentGrade"
  title="学生年级未设置，请联系管理员补全"
  type="warning"
  :closable="false"
  class="grade-alert"
/>
<el-alert
  v-else-if="studentLookupComplete && visibleClubs.length === 0"
  title="当前年级暂无可报名社团"
  type="info"
  :closable="false"
  class="grade-alert"
/>
```

- [ ] **Step 4: 使用过滤后的社团列表**

将社团选择器改为：

```html
<el-select
  v-model="form.clubId"
  placeholder="请先输入身份证号查询学生年级"
  style="width: 100%"
  :disabled="!studentGrade"
>
  <el-option
    v-for="club in visibleClubs"
    :key="club.id"
    :label="`${club.name} (剩余: ${club.remaining}/${club.total})`"
    :value="club.id"
    :disabled="club.remaining === 0"
  />
</el-select>
```

提交前将名额查询从 `clubs.value` 改为 `visibleClubs.value`，避免提交隐藏的非匹配社团。

- [ ] **Step 5: 增加样式并构建**

在 scoped style 中增加：

```css
.grade-alert {
  margin-bottom: 16px;
  text-align: left;
}
```

Run: `corepack pnpm run build`

Expected: 构建成功。

- [ ] **Step 6: 提交（项目无 Git 仓库，跳过）**

不要执行提交命令。

---

### Task 8: 全量测试、数据库迁移和端到端验证

**Files:**
- No additional source files

- [ ] **Step 1: 执行自动化测试**

Run: `corepack pnpm test`

Expected: 所有测试文件通过，新增年级、导入、导出、报名校验测试均为 PASS。

- [ ] **Step 2: 执行 TypeScript 检查**

Run: `npx tsc --noEmit`

Expected: exit code 0。

- [ ] **Step 3: 执行前后端生产构建**

Run: `corepack pnpm run deploy:build`

Expected：

- `vue-tsc -b` 通过
- Vite 构建成功
- `tsc -p server/tsconfig.json` 通过
- `dist-server/src/routes/students.js`、`clubs.js`、`register.js` 为最新代码

- [ ] **Step 4: 执行已有数据库迁移**

在服务器目标数据库执行：

```bash
mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p "$MYSQL_DATABASE" \
  < server/src/storage/database/migrations/2026-09-05-add-grade-columns.sql
```

执行后检查：

```sql
SHOW COLUMNS FROM clubs LIKE 'grade';
SHOW COLUMNS FROM students LIKE 'grade';
```

Expected: 两条查询都返回 `grade` 列。

- [ ] **Step 5: 启动服务并验证社团导入导出**

```bash
pm2 restart club-registration
```

后台验证：

1. 新建初一社团，确认列表出现年级
2. 编辑年级并刷新，确认值保留
3. 导出 Excel，确认包含年级和名额字段
4. 导入一个新社团和一个同名更新社团，确认新增/更新数量正确
5. 导入名额小于已报名人数的社团，确认该行失败且原数据未改变

- [ ] **Step 6: 验证学生年级和报名筛选**

1. 导入分别属于初一、初二的学生数据
2. 使用初一学生身份证查询，确认只显示初一社团
3. 使用初二学生身份证查询，确认只显示初二社团
4. 使用年级为空的历史学生，确认页面不显示可报名社团并提示补全
5. 直接 POST 不匹配年级的 `/api/register`，确认服务端返回“该社团不面向您的年级”

- [ ] **Step 7: 提交（项目无 Git 仓库，跳过）**

不要执行提交命令。

## 计划自审

- 数据库字段与迁移：Task 1
- 学生年级读写和导入：Task 2
- 社团 CRUD 年级：Task 3
- 社团 Excel/CSV 导入与 Excel 导出：Task 4
- 报名页筛选和服务端防绕过：Task 5、Task 7
- 管理后台界面：Task 6
- 测试、生产构建、迁移和 PM2：Task 8
- 文档无 TBD、TODO 或未定义的后续步骤
- 字段名称统一为数据库/API `grade`，社团导入列同时支持 `年级`/`grade`
- 生产运行入口统一为 `dist-server/index.js`，部署必须重新执行 `build:server`
