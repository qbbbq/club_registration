# 社团多年级报名实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将社团可报名年级改为可配置多个年级，并让公共报名、后台编辑、导入导出和服务端校验统一按年级集合工作。

**Architecture:** 继续使用 `clubs.grade` 字段，但将其保存为固定顺序的逗号字符串，例如 `初一,初二`；服务端集中提供解析、校验、序列化和匹配函数，历史单值与 `NULL` 继续兼容。API 新增结构化 `grades` 数组，同时保留规范化 `grade` 字符串；前端表单使用多选数组，公共报名和后台工作台通过集合匹配学生年级。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Express、MySQL、Vitest、mysql2、Vite。

---

## 文件结构与职责

- 修改 `server/src/constants/grades.ts`：固定年级集合、输入解析、规范化序列化和社团年级匹配。
- 新增 `server/src/constants/grades.test.ts`：年级集合工具的单元测试。
- 修改 `server/src/storage/database/init.sql`：新数据库将 `clubs.grade` 定义为 `VARCHAR(20)`。
- 修改 `src/storage/database/shared/schema.ts`：同步 Drizzle 侧社团字段长度。
- 新增 `server/src/storage/database/migrations/2026-09-06-allow-multiple-club-grades.sql`：已有数据库幂等扩大社团年级字段。
- 新增 `server/src/storage/database/migrations/2026-09-06-allow-multiple-club-grades.test.ts`：迁移内容回归测试。
- 修改 `server/src/routes/clubs.ts`：社团创建、编辑、导入、导出和查询的多选年级处理。
- 修改 `server/src/routes/clubs.test.ts`：社团 API 多年级测试。
- 修改 `server/src/services/registrationService.ts`：公共报名按集合匹配社团年级。
- 修改 `server/src/services/registrationService.test.ts`：公共报名多年级匹配和拒绝测试。
- 修改 `server/src/services/studentRegistrationService.ts`：后台换社团/补录按集合匹配社团年级。
- 修改 `server/src/services/studentRegistrationService.test.ts`：后台多年级匹配和历史空年级测试。
- 新增 `src/utils/clubGrades.ts`：前端兼容 `grades` 数组和旧 `grade` 字符串的匹配工具。
- 新增 `src/utils/clubGrades.test.ts`：前端年级集合工具测试。
- 修改 `src/utils/studentRegistrationForm.ts`：后台社团过滤、禁用和年级变更逻辑改用集合匹配。
- 修改 `src/utils/studentRegistrationForm.test.ts`：更新后台社团过滤测试数据和断言。
- 修改 `src/views/Admin.vue`：社团表单多选、列表展示、导入说明和后台报名社团选项。
- 修改 `src/views/Register.vue`：公共报名社团列表按 `grades` 集合过滤。

本工作区没有 Git 仓库，不执行 `git commit`、`git init` 或其他提交操作。

## Task 1: 年级集合工具

**Files:**
- Modify: `server/src/constants/grades.ts`
- Create: `server/src/constants/grades.test.ts`

- [ ] **Step 1: 写失败测试，固定解析、校验、序列化和匹配契约**

在 `grades.test.ts` 覆盖以下行为：

```ts
it('parses a single legacy grade', () => {
  expect(parseGradeSelection('初一')).toEqual(['初一']);
});

it('parses delimited grades and returns the fixed option order', () => {
  expect(parseGradeSelection('初三、初一，初二')).toEqual(['初一', '初二', '初三']);
});

it('rejects empty, invalid, and duplicate selections', () => {
  expect(() => parseGradeSelection('')).toThrow(GradeSelectionError);
  expect(() => parseGradeSelection(['初一', '高一'])).toThrow(GradeSelectionError);
  expect(() => parseGradeSelection(['初一', '初一'])).toThrow(GradeSelectionError);
});

it('serializes grades canonically', () => {
  expect(serializeGrades(['初三', '初一'])).toBe('初一,初三');
  expect(parseStoredGrades(null)).toEqual([]);
  expect(parseStoredGrades('初一,初三')).toEqual(['初一', '初三']);
});

it('matches a student grade against a legacy or multi-grade club', () => {
  expect(clubAllowsGrade('初一', '初一')).toBe(true);
  expect(clubAllowsGrade('初一,初二', '初二')).toBe(true);
  expect(clubAllowsGrade('初一,初二', '初三')).toBe(false);
  expect(clubAllowsGrade(null, '初一')).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认按预期失败**

运行：

```bash
corepack pnpm exec vitest run server/src/constants/grades.test.ts
```

预期：测试因 `parseGradeSelection`、`GradeSelectionError`、`serializeGrades`、`parseStoredGrades` 和 `clubAllowsGrade` 尚未定义而失败。

- [ ] **Step 3: 实现最小服务端工具**

在 `grades.ts` 保留现有 `GRADES`、`Grade` 和 `isGrade`，新增以下行为：

```ts
export class GradeSelectionError extends Error {}

export function parseGradeSelection(value: unknown): Grade[];
export function parseStoredGrades(value: string | null): Grade[];
export function serializeGrades(grades: readonly Grade[]): string;
export function clubAllowsGrade(clubGrade: string | null, studentGrade: string | null): boolean;
```

实现约束：

- 字符串按 ASCII 逗号、中文逗号和顿号拆分。
- 数组中的每个元素也要 trim；数组元素不再包含分隔符时仍能正常工作。
- 输入选择必须非空、全部是 `GRADES` 成员且没有重复值，否则抛出 `GradeSelectionError`。
- 序列化始终按 `GRADES` 的固定顺序输出 ASCII 逗号字符串。
- `parseStoredGrades(null)` 返回空数组；读取历史存储值时只返回合法年级。
- `clubAllowsGrade` 对空社团年级或空学生年级返回 `false`。

- [ ] **Step 4: 运行工具测试确认通过**

运行：

```bash
corepack pnpm exec vitest run server/src/constants/grades.test.ts
```

预期：所有年级工具测试通过。

## Task 2: 数据库字段和迁移

**Files:**
- Modify: `server/src/storage/database/init.sql:10`
- Modify: `src/storage/database/shared/schema.ts:9`
- Create: `server/src/storage/database/migrations/2026-09-06-allow-multiple-club-grades.sql`
- Create: `server/src/storage/database/migrations/2026-09-06-allow-multiple-club-grades.test.ts`

- [ ] **Step 1: 写迁移失败测试**

测试读取迁移文件并断言包含：

```ts
expect(migration).toContain('ALTER TABLE clubs MODIFY COLUMN grade VARCHAR(20) NULL');
expect(migration).not.toContain('DROP TABLE');
```

- [ ] **Step 2: 运行迁移测试确认失败**

运行：

```bash
corepack pnpm exec vitest run server/src/storage/database/migrations/2026-09-06-allow-multiple-club-grades.test.ts
```

预期：因迁移文件不存在而失败。

- [ ] **Step 3: 添加字段定义和幂等迁移**

将初始化结构改为：

```sql
grade VARCHAR(20),
```

将共享 schema 的 clubs grade 长度改为 20，students grade 保持 10。

新增迁移文件，内容为：

```sql
-- Run with the target database selected.
ALTER TABLE clubs MODIFY COLUMN grade VARCHAR(20) NULL;
```

`MODIFY COLUMN` 可重复执行，不重写已有单值或 `NULL` 数据。

- [ ] **Step 4: 运行迁移测试确认通过**

运行：

```bash
corepack pnpm exec vitest run server/src/storage/database/migrations/2026-09-06-allow-multiple-club-grades.test.ts
```

预期：迁移测试通过。

## Task 3: 社团 API、导入和导出

**Files:**
- Modify: `server/src/routes/clubs.ts:16-321`
- Modify: `server/src/routes/clubs.test.ts`

- [ ] **Step 1: 写社团 API 的失败测试**

在 `clubs.test.ts` 增加以下测试场景：

```ts
it('creates a club with multiple grades and returns both grade formats', async () => {
  // POST body: { name: '机器人社', grade: ['初三', '初一'], total_quota: 30 }
  // 断言 INSERT 参数中的 grade 为 '初一,初三'
  // 断言响应 data.grade 为 '初一,初三'，data.grades 为 ['初一', '初三']
});

it('rejects conflicting grade and grades request fields', async () => {
  // POST body: { grade: '初一', grades: ['初二'], total_quota: 30 }
  // 断言 HTTP 400，数据库 query 未调用
});

it('imports multiple grades from Chinese delimiters', async () => {
  // CSV 年级值为 '初一、初二'
  // 断言 INSERT/UPDATE 使用 '初一,初二'
});

it('returns a grades array for legacy single-grade rows', async () => {
  // mock GET row { grade: '初二' }
  // 断言响应行包含 grades: ['初二']
});
```

同时把现有创建、编辑、导入测试中的请求字段更新为 `grades` 数组，保留一个旧 `grade` 字符串兼容测试。

- [ ] **Step 2: 运行社团路由测试确认失败**

运行：

```bash
corepack pnpm exec vitest run server/src/routes/clubs.test.ts
```

预期：新增测试因路由仍按单值 `grade` 校验和返回而失败。

- [ ] **Step 3: 实现请求解析和响应格式化**

在 `clubs.ts` 增加内部辅助逻辑：

```ts
function readClubGrades(body: Record<string, unknown>): string {
  const hasGrades = Object.prototype.hasOwnProperty.call(body, 'grades');
  const hasGrade = Object.prototype.hasOwnProperty.call(body, 'grade');
  const grades = parseGradeSelection(hasGrades ? body.grades : body.grade);

  if (hasGrades && hasGrade) {
    const legacy = parseGradeSelection(body.grade);
    if (serializeGrades(grades) !== serializeGrades(legacy)) {
      throw new GradeSelectionError('grade 和 grades 表达的年级不一致');
    }
  }

  return serializeGrades(grades);
}
```

实现时将 `GradeSelectionError` 映射为 HTTP 400，并使用固定错误文本说明年级必须至少选择一个且只能选择初一/初二/初三。

更新以下路径：

- `POST /api/clubs`：解析 `grades` 或旧 `grade` 后保存规范化字符串。
- `PUT /api/clubs/:id`：在事务锁定社团前完成输入校验，保存规范化字符串。
- `POST /api/clubs/import`：读取 `年级`/`grades`/`grade`，通过 `parseGradeSelection` 支持逗号、中文逗号和顿号。
- `GET /api/clubs` 和创建响应：通过 `parseStoredGrades(row.grade)` 增加 `grades` 数组，同时保留 `grade`。
- Excel 导出：使用数据库中的规范化 `grade` 字符串。

导入行遇到空集合、非法值或重复值时增加错误信息并跳过，不写入数据库。

- [ ] **Step 4: 运行社团路由测试确认通过**

运行：

```bash
corepack pnpm exec vitest run server/src/routes/clubs.test.ts
```

预期：社团创建、编辑、导入、导出、缓存和多年级兼容测试全部通过。

## Task 4: 公共报名和后台报名业务规则

**Files:**
- Modify: `server/src/services/registrationService.ts:26-185`
- Modify: `server/src/services/registrationService.test.ts`
- Modify: `server/src/services/studentRegistrationService.ts:33-297`
- Modify: `server/src/services/studentRegistrationService.test.ts`

- [ ] **Step 1: 写服务层失败测试**

公共报名测试增加：

```ts
it('allows a student when the club includes the student grade', async () => {
  // student.grade = '初二', lockedClub.grade = '初一,初二'
  // 断言报名成功，并继续扣减名额和插入记录
});

it('rejects a student outside the club grade set', async () => {
  // student.grade = '初三', lockedClub.grade = '初一,初二'
  // 断言提示年级不匹配，并且没有扣减名额
});
```

后台服务增加：

```ts
it('allows switching to a club that includes the edited student grade', async () => {
  // targetClub.grade = '初一,初二', normalized.grade = '初二'
  // 断言换社团成功，报名 ID 和时间保持不变
});
```

保留并明确测试：单值社团仍匹配、`NULL` 社团只能保留当前历史报名，不能作为新目标。

- [ ] **Step 2: 运行两个服务测试确认失败**

运行：

```bash
corepack pnpm exec vitest run server/src/services/registrationService.test.ts server/src/services/studentRegistrationService.test.ts
```

预期：多值社团与学生年级匹配测试失败，因为现有实现使用字符串全等比较。

- [ ] **Step 3: 使用统一匹配函数替换全等判断**

在 `registrationService.ts` 中将：

```ts
if (lockedClub.grade !== student.grade) {
```

替换为：

```ts
if (!clubAllowsGrade(lockedClub.grade, student.grade)) {
```

在 `studentRegistrationService.ts` 中将目标社团校验改为：

```ts
const targetGrades = parseStoredGrades(targetClub.grade);
const keepingLegacyClub = currentRegistration !== null &&
  currentClubId === targetClub.id &&
  targetGrades.length === 0;

if (targetGrades.length === 0 && !keepingLegacyClub) {
  throw new StudentRegistrationValidationError('该社团暂未设置可报名年级');
}
if (targetGrades.length > 0 && !clubAllowsGrade(targetClub.grade, normalized.grade)) {
  throw new StudentRegistrationValidationError('该社团不面向学生所在年级');
}
```

保留当前社团为空年级的历史兼容分支；切换进入空年级社团仍拒绝。其余锁顺序、名额更新、报名 ID/时间和缓存清理不变。

- [ ] **Step 4: 运行服务测试确认通过**

运行：

```bash
corepack pnpm exec vitest run server/src/services/registrationService.test.ts server/src/services/studentRegistrationService.test.ts
```

预期：公共报名和后台报名业务测试全部通过。

## Task 5: 前端年级集合工具和后台社团过滤

**Files:**
- Create: `src/utils/clubGrades.ts`
- Create: `src/utils/clubGrades.test.ts`
- Modify: `src/utils/studentRegistrationForm.ts`
- Modify: `src/utils/studentRegistrationForm.test.ts`

- [ ] **Step 1: 写前端工具失败测试**

测试固定兼容行为：

```ts
it('prefers response grades and falls back to legacy grade', () => {
  expect(parseClubGrades(['初一', '初二'], '初三')).toEqual(['初一', '初二']);
  expect(parseClubGrades(undefined, '初三,初一')).toEqual(['初一', '初三']);
  expect(clubIncludesGrade({ grades: ['初一', '初二'] }, '初二')).toBe(true);
  expect(clubIncludesGrade({ grade: null }, '初一')).toBe(false);
});
```

更新 `studentRegistrationForm` 测试数据，使社团支持 `grades` 数组，并覆盖：

- 多年级社团对任一匹配学生年级可见。
- 不匹配社团不可见或不可选。
- 当前历史空年级社团仍可保留。
- 无报名学生改变年级时，已选但不再匹配的社团被清空。

- [ ] **Step 2: 运行前端工具测试确认失败**

运行：

```bash
corepack pnpm exec vitest run src/utils/clubGrades.test.ts src/utils/studentRegistrationForm.test.ts
```

预期：因新工具未定义以及旧过滤函数仍只比较 `club.grade` 而失败。

- [ ] **Step 3: 实现前端解析和后台过滤**

新增 `clubGrades.ts`：

```ts
export function parseClubGrades(grades: unknown, legacyGrade?: unknown): string[];
export function clubIncludesGrade(
  club: { grades?: unknown; grade?: unknown },
  studentGrade: string | null
): boolean;
```

实现与后端相同的分隔符和固定顺序规则，但前端读取异常值时只保留合法年级，不阻断页面渲染。

更新 `studentRegistrationForm.ts`：

- `StudentRegistrationClubOption` 增加 `grades?: string[]`，保留 `grade?: string | null`。
- `filterStudentRegistrationClubs` 使用 `clubIncludesGrade`。
- `isStudentRegistrationClubDisabled` 使用集合匹配；当前社团和历史空年级兼容逻辑保持不变。
- `resetUnregisteredClubForGrade` 使用集合匹配判断是否清空。

- [ ] **Step 4: 运行前端工具测试确认通过**

运行：

```bash
corepack pnpm exec vitest run src/utils/clubGrades.test.ts src/utils/studentRegistrationForm.test.ts
```

预期：前端集合工具和后台过滤测试通过。

## Task 6: 管理后台和公共报名界面

**Files:**
- Modify: `src/views/Admin.vue:31-51,347-418,780-1140`
- Modify: `src/views/Register.vue:23-30,79-88,276-290`
- Modify: `src/views/admin-responsive.test.ts`

- [ ] **Step 1: 先写界面契约测试**

在 `admin-responsive.test.ts` 增加源码契约断言，确认三个社团年级控件都包含：

```ts
expect(adminSource).toMatch(/v-model="editForm\.grades"[\s\S]*multiple/);
expect(adminSource).toMatch(/v-model="addForm\.grades"[\s\S]*multiple/);
expect(adminSource).toContain('collapse-tags');
```

在 `src/utils/clubGrades.test.ts` 覆盖公共报名所需的集合过滤行为；`Register.vue` 只调用该工具，不新增对组件源码结构的脆弱断言。

- [ ] **Step 2: 运行界面测试确认失败**

运行：

```bash
corepack pnpm exec vitest run src/views/admin-responsive.test.ts
```

预期：现有单选控件和 `editForm.grade`/`addForm.grade` 使新增断言失败。

- [ ] **Step 3: 修改后台表单和公共报名过滤**

后台修改点：

- `editForm.grade` 和 `addForm.grade` 改为 `grades: [] as string[]`。
- `handleEdit` 使用 `parseClubGrades(club.grades, club.grade)` 初始化。
- `handleSave`、`handleSaveAdd` 校验数组非空，并发送 `grades`。
- 社团表格显示 `club.grades.join('、')`，旧响应通过 `parseClubGrades` 兼容，空数组显示“未设置”。
- 新增和编辑的 `el-select` 使用 `multiple`, `collapse-tags`, `collapse-tags-tooltip`, `clearable`。
- 导入说明改为支持“初一、初二”等多个年级。
- 后台报名社团选项标签使用集合显示，例如 `初一、初二，剩余 10`。

公共报名修改点：

- 加载社团时保留 `grades` 和旧 `grade`。
- `visibleClubs` 使用 `clubIncludesGrade(club, studentGrade.value)`。
- 其他身份证查询、名额显示和提交逻辑保持不变。

窄屏下检查多选标签和卡片按钮不产生横向溢出；必要时在现有移动端规则中为 `.el-select` 多选标签增加换行或折叠显示，但不改变桌面布局。

- [ ] **Step 4: 运行界面测试确认通过**

运行：

```bash
corepack pnpm exec vitest run src/views/admin-responsive.test.ts src/utils/clubGrades.test.ts src/utils/studentRegistrationForm.test.ts
```

预期：多选控件契约、社团集合过滤和响应式相关测试全部通过。

## Task 7: 全量验证、数据库和浏览器验收

**Files:**
- No additional source files; verify all modified files above.

- [ ] **Step 1: 运行全量自动化测试**

运行：

```bash
corepack pnpm test
```

预期：所有测试文件通过，且包含新增年级工具、迁移、社团 API、服务和前端工具测试。

- [ ] **Step 2: 运行类型检查和生产构建**

依次运行：

```bash
npx vue-tsc --noEmit
corepack pnpm run deploy:build
```

预期：两个命令退出码为 0。Vite 现有大 chunk 警告可以保留，但不能出现 TypeScript 或构建错误。

- [ ] **Step 3: 在当前 MySQL 上执行迁移并验证幂等性**

使用项目 `.env` 连接当前数据库执行：

```bash
node --input-type=module -e "import fs from 'node:fs'; import mysql from 'mysql2/promise'; import dotenv from 'dotenv'; dotenv.config(); const sql=fs.readFileSync('server/src/storage/database/migrations/2026-09-06-allow-multiple-club-grades.sql','utf8'); const c=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD||'',database:process.env.MYSQL_DATABASE,multipleStatements:true}); await c.query(sql); await c.query(sql); const [rows]=await c.query(\"SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='clubs' AND column_name='grade'\"); console.log(rows); await c.end();"
```

预期：脚本执行两次均成功，查询结果显示 `CHARACTER_MAXIMUM_LENGTH` 为 20，现有单值和空值保持不变。

- [ ] **Step 4: 浏览器验证后台多选和公共报名**

在开发服务器已运行的情况下：

1. 打开 `/admin`，进入社团管理，新增或编辑社团，选择初一和初二，保存后确认列表显示“初一、初二”。
2. 进入“修改信息”，查询初一学生，确认多选社团列表包含该社团；查询初三学生，确认该社团不显示。
3. 打开公共报名页，查询初一学生，确认可以看到多选社团；选择初二学生，确认同一社团也可见。
4. 在 390px 和 1440px 视口检查多选标签、社团表格和报名社团下拉无横向溢出。

- [ ] **Step 5: 最终复审范围**

确认以下行为没有回归：

- 历史单值社团仍可被对应年级报名。
- `NULL` 社团不能作为新报名目标，但已有报名可保留。
- 不匹配年级不会扣减名额或写入报名记录。
- 换社团仍保留报名记录 ID 和创建时间。
- 社团缓存只在成功创建、编辑、导入或后台名额变化后清理。
