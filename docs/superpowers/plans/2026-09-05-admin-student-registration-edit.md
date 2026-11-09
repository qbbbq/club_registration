# 后台学生信息与报名修改实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在后台新增“修改信息”Tab，管理员按身份证号查询学生后，可以原子地修改学生资料、替换报名社团或为未报名学生补录社团。

**架构：** 新增独立的 `studentRegistrationService` 负责查询和 MySQL 事务更新，新增 `student-registration` Express 路由提供后台接口；不改数据库结构和公共报名接口。`Admin.vue` 增加 B 双栏工作台，所有保存字段一次提交，服务端负责最终校验和回滚。

**技术栈：** Express 5 + mysql2 + TypeScript；Vue 3 + Element Plus；Vitest + Supertest；现有 SHA-256 身份证哈希和社团缓存机制。

**约束：** 项目没有 Git 仓库，不执行提交或初始化 Git；生产后端入口为 `dist-server/index.js`，后端改动后运行 `corepack pnpm run build:server`。

---

## 文件职责映射

- Create: `server/src/utils/id-card.ts` — 统一身份证哈希函数，避免公共报名和后台修改使用不同算法。
- Create/Test: `server/src/utils/id-card.test.ts` — 验证 SHA-256 哈希结果。
- Modify: `server/src/services/registrationService.ts` — 改为使用统一哈希函数，保持公共报名行为不变。
- Create/Test: `server/src/services/studentRegistrationService.ts`, `server/src/services/studentRegistrationService.test.ts` — 查询学生报名信息、原子更新资料/报名/名额。
- Create/Test: `server/src/routes/student-registration.ts`, `server/src/routes/student-registration.test.ts` — 后台查询和保存接口、HTTP 参数及错误映射。
- Modify: `server/index.ts` — 挂载 `/api/admin/student-registration` 路由。
- Modify: `src/views/Admin.vue` — 增加“修改信息”Tab、双栏表单和接口调用。

## 数据合同

服务层使用以下类型，路由和前端保持字段一致：

```ts
export interface StudentRegistrationView {
  student: {
    id: number;
    name: string;
    idCard: string;
    grade: string | null;
    className: string;
  };
  registration: {
    id: number;
    clubId: number;
    clubName: string;
    time: Date;
  } | null;
}

export interface UpdateStudentRegistrationInput {
  studentId: number;
  idCard: string;
  name: string;
  grade: string;
  className: string;
  clubId: number | null;
}
```

已有报名时 `clubId` 不能为 `null`；没有报名时可以为 `null`，表示只保存学生资料。已有报名换社团时保留报名 `id` 和 `created_at`。

---

### Task 1: 提取并测试统一身份证哈希函数

**文件：**
- Create: `server/src/utils/id-card.ts`
- Test: `server/src/utils/id-card.test.ts`
- Modify: `server/src/services/registrationService.ts`

- [ ] **Step 1: 先写哈希函数失败测试**

创建测试，使用公开的 SHA-256 固定向量：

```ts
import { describe, expect, it } from 'vitest';
import { hashIdCard } from './id-card';

describe('hashIdCard', () => {
  it('returns the SHA-256 hex digest', () => {
    expect(hashIdCard('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
```

- [ ] **Step 2: 运行测试确认按预期失败**

运行：

```bash
corepack pnpm test -- server/src/utils/id-card.test.ts
```

预期：因 `./id-card` 尚不存在而失败，不是测试配置错误。

- [ ] **Step 3: 写最小实现**

创建实现：

```ts
import crypto from 'crypto';

export function hashIdCard(idCard: string): string {
  return crypto.createHash('sha256').update(idCard).digest('hex');
}
```

- [ ] **Step 4: 运行哈希测试确认通过**

运行同一命令，预期 `1 test passed`。

- [ ] **Step 5: 替换公共报名服务中的重复实现**

在 `registrationService.ts` 删除 `private static hashIdCard`，改为：

```ts
import { hashIdCard } from '../utils/id-card';

// register 内
const idCardHash = hashIdCard(data.idCard);
```

不改变 `RegistrationData`、SQL、响应和重复报名处理。

- [ ] **Step 6: 运行公共报名服务回归测试**

运行：

```bash
corepack pnpm test -- server/src/services/registrationService.test.ts
```

预期：原有服务测试全部通过。

- [ ] **Step 7: 项目无 Git 仓库，跳过提交**

确认新工具文件和公共服务改动在工作区，不执行 `git init` 或提交。

---

### Task 2: 先写学生报名服务的失败测试

**文件：**
- Create/Test: `server/src/services/studentRegistrationService.test.ts`

测试使用与现有 `registrationService.test.ts` 相同的 Vitest mock：

```ts
vi.mock('../storage/database/mysql-client', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../routes/clubs-cache', () => ({
  clearClubsCache: vi.fn(),
}));
```

- [ ] **Step 1: 写查询成功和无报名测试**

第一条测试 mock 两次 `query`：第一次返回学生，第二次返回报名及社团；断言结果映射为 `student` 和 `registration`。第二条测试第二次返回空数组，断言 `registration` 为 `null`。

期望 SQL 的关键内容：

```ts
expect(query).toHaveBeenNthCalledWith(
  1,
  'SELECT id, name, id_card, grade, class_name FROM students WHERE id_card = ? LIMIT 1',
  ['123456789012345678']
);
expect(query).toHaveBeenNthCalledWith(
  2,
  expect.stringContaining('id_card_hash = ?'),
  [expect.stringMatching(/^[a-f0-9]{64}$/)]
);
```

- [ ] **Step 2: 写服务保存测试，覆盖四条核心成功路径**

用 `withTransaction.mockImplementation(async (callback) => callback({ execute } as any))` 注入连接，并按执行顺序返回结果：

1. 已有报名、同一社团：更新学生和报名资料，不更新名额。
2. 已有报名、切换社团：锁学生、锁报名、锁两个社团；原社团 `+1`，目标社团条件扣减 `-1`；更新报名但不改报名 ID/时间。
3. 无报名、选择社团：更新学生、条件扣减目标社团、插入报名并查询新时间。
4. 无报名、不选社团：只更新学生，不执行社团或报名写入。

每条测试都断言 `withTransaction` 被调用、参数顺序正确，并断言涉及名额变更时调用了 `clearClubsCache`。

- [ ] **Step 3: 写服务校验失败和回滚测试**

增加测试覆盖。每条测试都先按前文的 `query`/`withTransaction` mock 设置数据，再调用 `StudentRegistrationService.update`，并断言错误类的 `statusCode`、中文错误消息和 `withTransaction`/`clearClubsCache` 调用情况：

- `rejects an invalid grade before opening a transaction`：传入 `grade: '高一'`，期望 400，事务未调用。
- `rejects a duplicate new id card`：目标身份证号已属于另一个学生，期望 400，学生资料未更新。
- `rejects switching to a club for another grade`：学生为 `初一`，目标社团为 `初二`，期望 400，名额写入未调用。
- `rejects switching to a full club`：目标社团 `remaining_quota: 0` 且不是当前社团，期望 400，原社团也不回收名额。
- `rejects clearing an existing registration`：已有报名但 `clubId: null`，期望 400，报名记录不变。
- `keeps the current full club selectable when the club is unchanged`：当前社团剩余名额为 0 且 `clubId` 不变，期望保存成功且不执行名额扣减。
- `propagates database errors so the transaction rolls back`：连接的学生更新或报名更新抛出数据库错误，期望错误继续抛出，缓存不清除。

对于服务层，失败应抛出带有稳定 `code` 或专用错误类的错误，由路由统一映射；事务失败测试要断言连接操作没有继续执行后续更新，并且 `clearClubsCache` 未调用。

- [ ] **Step 4: 运行服务测试确认按预期失败**

运行：

```bash
corepack pnpm test -- server/src/services/studentRegistrationService.test.ts
```

预期：因服务文件和方法尚未实现而失败。

---

### Task 3: 实现学生报名事务服务

**文件：**
- Create: `server/src/services/studentRegistrationService.ts`
- Modify: `server/src/services/registrationService.ts`（Task 1 已改）

- [ ] **Step 1: 创建服务类型和错误类**

实现以下错误边界：

```ts
export class StudentRegistrationNotFoundError extends Error {
  readonly statusCode = 404;
}

export class StudentRegistrationValidationError extends Error {
  readonly statusCode = 400;
}
```

服务输入校验要求：`studentId` 为正整数；姓名、班级、身份证号非空；身份证号匹配 `/^\d{17}[\dXx]$/`；`isGrade(grade)` 为真；`clubId` 为正整数或 `null`。

- [ ] **Step 2: 实现查询方法**

实现：

```ts
static async lookup(idCard: string, signal?: AbortSignal): Promise<StudentRegistrationView>
```

先执行：

```sql
SELECT id, name, id_card, grade, class_name
FROM students
WHERE id_card = ?
LIMIT 1
```

没有学生时抛出 `StudentRegistrationNotFoundError`。有学生时用 `hashIdCard(idCard)` 查询：

```sql
SELECT r.id, r.club_id, r.created_at, c.name AS club_name
FROM registrations r
JOIN clubs c ON c.id = r.club_id
WHERE r.id_card_hash = ?
LIMIT 1
```

查询学生和报名的两个 `query` 调用都接收 `signal`，以便客户端断开时释放连接。

返回 camelCase 数据，不暴露哈希。

- [ ] **Step 3: 实现事务内的行锁和唯一性校验**

实现：

```ts
static async update(
  input: UpdateStudentRegistrationInput,
  signal?: AbortSignal
): Promise<StudentRegistrationView>
```

事务开头锁定：

```sql
SELECT id, name, id_card, grade, class_name
FROM students
WHERE id = ?
LIMIT 1
FOR UPDATE
```

检查新身份证号是否属于其他学生：

```sql
SELECT id FROM students
WHERE id_card = ? AND id <> ?
LIMIT 1
FOR UPDATE
```

按旧身份证哈希锁定当前报名：

```sql
SELECT id, name, id_card_hash, class_name, club_id, created_at
FROM registrations
WHERE id_card_hash = ?
LIMIT 1
FOR UPDATE
```

再检查新哈希是否被其他报名记录占用：

```sql
SELECT id FROM registrations
WHERE id_card_hash = ? AND id <> ?
LIMIT 1
FOR UPDATE
```

任何冲突抛出 `StudentRegistrationValidationError`。

- [ ] **Step 4: 实现社团锁定和目标校验**

收集当前社团 ID 和目标社团 ID，去重后按数字升序生成占位符，执行：

```ts
const clubIds = [...new Set([currentClubId, input.clubId]
  .filter((id): id is number => id !== null))]
  .sort((left, right) => left - right)
const placeholders = clubIds.map(() => '?').join(', ')
const [clubRows] = clubIds.length > 0
  ? await connection.execute<ClubRow[]>(
      `SELECT id, name, grade, total_quota, remaining_quota
       FROM clubs WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`,
      clubIds
    )
  : [[] as ClubRow[]]
```

处理规则：

- 已有报名且 `clubId === null`：抛出“已有报名记录不能清空”。
- 目标社团不存在或 `grade !== input.grade`：抛出校验错误。
- 无当前报名且目标社团剩余名额小于等于 0：抛出“该社团名额已满”。
- 已有报名且切换到不同社团时，目标社团剩余名额小于等于 0：抛出“该社团名额已满”。
- 已有报名且目标社团就是当前社团时，不因当前剩余名额为 0 而失败。

- [ ] **Step 5: 实现学生资料和报名记录写入**

更新学生：

```sql
UPDATE students
SET name = ?, id_card = ?, grade = ?, class_name = ?
WHERE id = ?
```

已有报名且社团不变时：

```sql
UPDATE registrations
SET name = ?, id_card_hash = ?, class_name = ?
WHERE id = ?
```

已有报名切换社团时先执行两个名额更新：

```sql
UPDATE clubs
SET remaining_quota = remaining_quota + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
```

```sql
UPDATE clubs
SET remaining_quota = remaining_quota - 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ? AND remaining_quota > 0
```

第二条 `affectedRows === 0` 时抛出名额错误。之后执行：

```sql
UPDATE registrations
SET name = ?, id_card_hash = ?, class_name = ?, club_id = ?
WHERE id = ?
```

无报名且选择社团时使用同样的条件扣减，随后执行：

```sql
INSERT INTO registrations (name, id_card_hash, class_name, club_id)
VALUES (?, ?, ?, ?)
```

查询新增记录的 `created_at`，构造返回数据。无报名且 `clubId === null` 时只更新学生并返回 `registration: null`。

- [ ] **Step 6: 在事务提交后清除社团缓存**

事务结果带出 `clubsChanged` 标记。`withTransaction` 成功返回后：

```ts
if (result.clubsChanged) clearClubsCache();
return result.view;
```

缓存清除不得在事务提交前执行；事务异常时不得清除缓存。

- [ ] **Step 7: 运行服务测试确认通过**

运行：

```bash
corepack pnpm test -- server/src/services/studentRegistrationService.test.ts server/src/services/registrationService.test.ts
```

预期：新服务测试和公共报名回归测试全部通过。

- [ ] **Step 8: 项目无 Git 仓库，跳过提交**

不执行提交命令。

---

### Task 4: 新增后台路由并挂载

**文件：**
- Create/Test: `server/src/routes/student-registration.ts`, `server/src/routes/student-registration.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: 先写路由失败测试**

mock `studentRegistrationService`，增加以下五条测试；查询成功测试断言 HTTP 200 和 `{ success: true, data }`，非法身份证号测试断言 HTTP 400 且服务未调用，学生不存在测试让服务抛出 `StudentRegistrationNotFoundError` 并断言 HTTP 404，保存成功测试断言服务收到完整请求对象和 `studentId`，校验错误测试让服务抛出 `StudentRegistrationValidationError` 并断言 HTTP 400：

- `looks up a student and registration by id card`
- `returns 400 for invalid lookup id card without calling the service`
- `returns 404 when the student does not exist`
- `updates the complete student registration payload`
- `returns 400 for service validation errors`

保存测试请求：

```ts
await request(app)
  .put('/api/admin/student-registration/12')
  .send({
    idCard: '123456789012345678',
    name: '张三',
    grade: '初一',
    className: '初一(1)班',
    clubId: 2,
  });
```

断言服务收到 `studentId: 12` 和其余字段，并传入 `getRequestAbortSignal(req)` 返回的请求中止信号。

- [ ] **Step 2: 运行路由测试确认失败**

运行：

```bash
corepack pnpm test -- server/src/routes/student-registration.test.ts
```

预期：因路由文件尚不存在而失败。

- [ ] **Step 3: 实现路由**

创建 Express router。路由使用 `getRequestAbortSignal`，并通过以下错误处理函数统一返回结果：

```ts
import express from 'express'
import {
  StudentRegistrationNotFoundError,
  StudentRegistrationService,
  StudentRegistrationValidationError,
} from '../services/studentRegistrationService'
import { getRequestAbortSignal } from '../http/request-context'

const router = express.Router()

function handleStudentRegistrationError(
  error: unknown,
  res: express.Response,
  signal?: AbortSignal
) {
  if (signal?.aborted || res.headersSent) return
  if (error instanceof StudentRegistrationNotFoundError) {
    return res.status(404).json({ success: false, message: error.message })
  }
  if (error instanceof StudentRegistrationValidationError) {
    return res.status(400).json({ success: false, message: error.message })
  }
  console.error('后台修改学生报名信息错误:', error)
  return res.status(500).json({ success: false, message: '服务器内部错误' })
}

router.post('/lookup', async (req, res) => {
  const signal = getRequestAbortSignal(req)
  try {
    const idCard = String(req.body.idCard || '').trim()
    if (!/^\d{17}[\dXx]$/.test(idCard)) {
      return res.status(400).json({ success: false, message: '身份证号格式不正确' })
    }
    const data = await StudentRegistrationService.lookup(idCard, signal)
    return res.json({ success: true, data })
  } catch (error) {
    return handleStudentRegistrationError(error, res, signal)
  }
})

router.put('/:studentId', async (req, res) => {
  const signal = getRequestAbortSignal(req)
  try {
    const rawClubId = req.body.clubId
    const clubId = rawClubId === null || rawClubId === '' || rawClubId === undefined
      ? null
      : Number(rawClubId)
    const data = await StudentRegistrationService.update({
      studentId: Number(req.params.studentId),
      idCard: String(req.body.idCard || '').trim(),
      name: String(req.body.name || '').trim(),
      grade: String(req.body.grade || '').trim(),
      className: String(req.body.className || '').trim(),
      clubId,
    }, signal)
    return res.json({ success: true, data })
  } catch (error) {
    return handleStudentRegistrationError(error, res, signal)
  }
})
```

路由负责：

- 将 `idCard` 转为字符串并检查 18 位格式。
- 将 `studentId` 转为数字并保留正整数校验。
- 将 `clubId` 的空字符串/`null` 转为 `null`，其他值转为正整数。
- 调用服务并返回 `{ success: true, data }`。
- 将 `StudentRegistrationNotFoundError` 映射为 404，将 `StudentRegistrationValidationError` 映射为 400，其他异常映射为 500。
- 请求中止或响应已发送时不重复写响应。

- [ ] **Step 4: 挂载后台路由**

在 `server/index.ts` 增加：

```ts
import studentRegistrationRouter from './src/routes/student-registration';

app.use('/api/admin/student-registration', studentRegistrationRouter);
```

放在其他 API 路由附近，不改变现有 `/api/register`、`/api/students` 和 `/api/registrations` 路由。

- [ ] **Step 5: 运行路由和相关回归测试**

运行：

```bash
corepack pnpm test -- server/src/routes/student-registration.test.ts server/src/routes/register.test.ts server/src/routes/students.test.ts
```

预期：全部通过。

- [ ] **Step 6: 项目无 Git 仓库，跳过提交**

不执行提交命令。

---

### Task 5: 实现 Admin.vue 的“修改信息”Tab

**文件：**
- Modify: `src/views/Admin.vue`

- [ ] **Step 1: 增加状态和派生数据**

在 `<script setup>` 中增加：

```ts
const studentRegistrationSearchIdCard = ref('')
const studentRegistrationRecord = ref<any | null>(null)
const studentRegistrationLoading = ref(false)
const studentRegistrationSaving = ref(false)
const studentRegistrationForm = ref({
  idCard: '',
  name: '',
  grade: '',
  className: '',
  clubId: null as number | null,
})

const currentStudentRegistration = computed(
  () => studentRegistrationRecord.value?.registration ?? null
)

const studentRegistrationClubs = computed(() => {
  const grade = studentRegistrationForm.value.grade
  const currentClubId = currentStudentRegistration.value?.clubId
  if (!grade) return []
  return clubs.value.filter((club) => club.grade === grade || club.id === currentClubId)
})

const isStudentRegistrationClubDisabled = (club: any) => {
  const isCurrent = club.id === currentStudentRegistration.value?.clubId
  return club.remaining_quota <= 0 && !isCurrent
}
```

增加空表单重置函数，避免切换查询对象时复用旧学生的报名社团。

- [ ] **Step 2: 增加查询、清空和保存方法**

实现查询：

```ts
const lookupStudentRegistration = async () => {
  if (!/^\d{17}[\dXx]$/.test(studentRegistrationSearchIdCard.value)) {
    ElMessage.warning('请输入正确的18位身份证号')
    return
  }
  studentRegistrationLoading.value = true
  try {
    const response = await axios.post('/api/admin/student-registration/lookup', {
      idCard: studentRegistrationSearchIdCard.value,
    })
    if (!response.data.success) {
      ElMessage.error(response.data.message || '查询失败')
      return
    }
    studentRegistrationRecord.value = response.data.data
    studentRegistrationForm.value = {
      idCard: response.data.data.student.idCard,
      name: response.data.data.student.name,
      grade: response.data.data.student.grade || '',
      className: response.data.data.student.className,
      clubId: response.data.data.registration?.clubId ?? null,
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '查询失败')
  } finally {
    studentRegistrationLoading.value = false
  }
}
```

实现保存时校验表单、禁止已有报名清空社团，并请求：

```ts
await axios.put(
  `/api/admin/student-registration/${studentRegistrationRecord.value.student.id}`,
  studentRegistrationForm.value
)
```

保存方法应按以下逻辑清晰地区分空状态和提交状态：

```ts
const emptyStudentRegistrationForm = () => ({
  idCard: '',
  name: '',
  grade: '',
  className: '',
  clubId: null as number | null,
})

const clearStudentRegistrationResult = () => {
  studentRegistrationRecord.value = null
  studentRegistrationForm.value = emptyStudentRegistrationForm()
}

const clearStudentRegistration = () => {
  studentRegistrationSearchIdCard.value = ''
  clearStudentRegistrationResult()
}

const saveStudentRegistration = async () => {
  const record = studentRegistrationRecord.value
  if (!record) return
  if (!studentRegistrationForm.value.name.trim() || !studentRegistrationForm.value.className.trim()) {
    ElMessage.warning('姓名和班级不能为空')
    return
  }
  if (!GRADE_OPTIONS.includes(studentRegistrationForm.value.grade)) {
    ElMessage.warning('请选择年级')
    return
  }
  if (record.registration && studentRegistrationForm.value.clubId === null) {
    ElMessage.warning('已有报名记录不能清空社团')
    return
  }

  studentRegistrationSaving.value = true
  try {
    const response = await axios.put(
      `/api/admin/student-registration/${record.student.id}`,
      studentRegistrationForm.value
    )
    if (!response.data.success) {
      ElMessage.error(response.data.message || '保存失败')
      return
    }
    ElMessage.success('保存成功')
    await Promise.all([loadClubs(), loadRegistrations(), loadStudents()])
    studentRegistrationSearchIdCard.value = studentRegistrationForm.value.idCard
    await lookupStudentRegistration()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    studentRegistrationSaving.value = false
  }
}
```

成功后依次 `await Promise.all([loadClubs(), loadRegistrations(), loadStudents()])`，再用新身份证号重新查询；失败只提示错误，不覆盖当前编辑值。

- [ ] **Step 3: 在模板中增加 Tab**

在 `el-tabs` 中增加：

```html
<el-tab-pane label="修改信息" name="student-registration">
  <div class="student-registration-search">
    <el-input v-model="studentRegistrationSearchIdCard" maxlength="18" placeholder="请输入身份证号" />
    <el-button type="primary" @click="lookupStudentRegistration" :loading="studentRegistrationLoading">查询</el-button>
    <el-button @click="clearStudentRegistration">清空</el-button>
  </div>
  <div v-if="studentRegistrationRecord" class="student-registration-layout">
    <section class="student-registration-panel">
      <el-form :model="studentRegistrationForm" label-width="90px">
        <el-form-item label="姓名"><el-input v-model="studentRegistrationForm.name" /></el-form-item>
        <el-form-item label="身份证号"><el-input v-model="studentRegistrationForm.idCard" maxlength="18" /></el-form-item>
        <el-form-item label="年级">
          <el-select v-model="studentRegistrationForm.grade">
            <el-option v-for="grade in GRADE_OPTIONS" :key="grade" :label="grade" :value="grade" />
          </el-select>
        </el-form-item>
        <el-form-item label="班级"><el-input v-model="studentRegistrationForm.className" /></el-form-item>
      </el-form>
    </section>
    <section class="student-registration-panel">
      <p v-if="currentStudentRegistration">当前社团：{{ currentStudentRegistration.clubName }}</p>
      <p v-if="currentStudentRegistration">报名时间：{{ new Date(currentStudentRegistration.time).toLocaleString('zh-CN') }}</p>
      <p v-else>暂无报名</p>
      <el-select v-model="studentRegistrationForm.clubId" placeholder="选择报名社团">
        <el-option
          v-for="club in studentRegistrationClubs"
          :key="club.id"
          :label="`${club.name}（${club.grade}，剩余 ${club.remaining_quota}）`"
          :value="club.id"
          :disabled="isStudentRegistrationClubDisabled(club)"
        />
      </el-select>
    </section>
  </div>
  <el-button v-if="studentRegistrationRecord" type="primary" @click="saveStudentRegistration" :loading="studentRegistrationSaving">保存全部修改</el-button>
</el-tab-pane>
```

查询栏包含 `el-input`（`maxlength="18"`）、查询按钮和清空按钮。身份证号输入绑定 `@input="clearStudentRegistrationResult"`，输入变化时清除已查询记录和表单，避免旧数据误保存。

- [ ] **Step 4: 增加 B 双栏表单**

左栏使用 `el-form` 显示：

```html
<el-input v-model="studentRegistrationForm.name" />
<el-input v-model="studentRegistrationForm.idCard" maxlength="18" />
<el-select v-model="studentRegistrationForm.grade">
  <el-option v-for="grade in GRADE_OPTIONS" :key="grade" :label="grade" :value="grade" />
</el-select>
<el-input v-model="studentRegistrationForm.className" />
```

右栏显示当前报名名称/时间；没有记录显示“暂无报名”。目标社团选择器使用 `studentRegistrationClubs`，选项标签包含社团名、年级和剩余名额，使用 `isStudentRegistrationClubDisabled` 禁用满员但非当前的社团。

已有报名时不渲染空选项；无报名时允许 `clubId` 保持 `null`。底部保存按钮使用 `studentRegistrationSaving` loading 状态。

- [ ] **Step 5: 增加响应式样式**

增加不嵌套卡片的双栏布局：

```css
.student-registration-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
}

@media (max-width: 768px) {
  .student-registration-layout {
    grid-template-columns: 1fr;
  }
}
```

保留现有 Element Plus 视觉风格，确保窄屏表单不横向溢出。

- [ ] **Step 6: 运行前端类型检查和构建**

运行：

```bash
npx tsc --noEmit
corepack pnpm run build
```

预期：均退出码 0。

- [ ] **Step 7: 项目无 Git 仓库，跳过提交**

不执行提交命令。

---

### Task 6: 全量验证和手动工作流验证

**文件：**
- No additional source files

- [ ] **Step 1: 运行全量自动化测试**

运行：

```bash
corepack pnpm test
```

预期：所有测试文件通过，包含新服务和新路由测试。

- [ ] **Step 2: 执行完整生产构建**

运行：

```bash
corepack pnpm run deploy:build
```

预期：客户端 Vite、前端 `vue-tsc` 和后端 `tsc -p server/tsconfig.json` 全部通过。

- [ ] **Step 3: 启动服务并验证后台查询**

启动现有开发服务后打开 `/admin`，进入“修改信息”Tab：

1. 输入已存在学生身份证号，确认左栏出现姓名、年级、班级和身份证号。
2. 确认右栏显示当前社团和报名时间；无报名学生显示“暂无报名”。
3. 修改姓名、班级和年级，保存后刷新学生列表确认值更新。

- [ ] **Step 4: 验证换社团和补录**

1. 选择与学生年级匹配的另一个有名额社团，保存后确认原社团名额加 1、目标社团名额减 1。
2. 确认报名记录 ID 和时间不变，姓名/班级同步更新。
3. 查询无报名学生，选择匹配社团保存，确认生成一条报名记录并扣减名额。
4. 无报名学生不选社团保存，确认只更新个人资料。

- [ ] **Step 5: 验证失败回滚**

分别尝试：重复身份证号、非法/空年级、不同年级社团、满员社团、清空已有报名。确认页面展示具体错误，且学生资料、报名记录和双方社团名额均保持不变。

- [ ] **Step 6: 验证移动端布局和公共报名回归**

使用移动端视口确认双栏变为上下排列；再打开公共 `/register`，确认原有学生查询、按年级筛选和报名流程不受影响。

## 计划自审

- 已覆盖设计中的两条后台接口、事务回滚、换社团名额调整、身份证哈希同步、无报名补录、当前满员社团保留、缓存清除和公共报名回归。
- 已明确所有新增文件路径、方法签名、关键 SQL、错误映射和验证命令。
- 已扫描计划内容，无 `TBD`、`TODO` 或未定义的实现步骤。
- 类型字段统一使用 `idCard`、`className`、`grade`、`clubId`；数据库 SQL 使用 `id_card`、`class_name`、`id_card_hash`。
- 项目无 Git 仓库，因此所有提交步骤明确跳过。
