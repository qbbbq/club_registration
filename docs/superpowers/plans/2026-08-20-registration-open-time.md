# 报名开放时间设置功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后台管理可设置一个全局报名开放时间点，到达前学生端无法报名（显示开放时间+倒计时），到达后自动开放。

**Architecture:** 新增通用 `settings` 键值表存储 `registration_open_at`；后端新增 `/api/settings/registration-open-time` 的 GET/PUT 路由；`RegistrationService.register` 在事务内第一步校验开放时间；管理端 Admin.vue 新增「报名设置」Tab，学生端 Register.vue 增加倒计时并禁用表单。

**Tech Stack:** Express 5 + mysql2（MySQL）+ TypeScript；Vue 3 + Element Plus + Vite；vitest + supertest 测试。

**注意事项：**
- 项目当前**不是 git 仓库**（无 `.git`）。各任务的「提交」步骤在未 `git init` 前跳过即可。
- MySQL 的 `key` 是保留字，SQL 中必须用反引号 `` `key` `` 包裹。
- 时间一律存 ISO 8601 带 `+08:00` 后缀的字符串；比较用 `Date.parse`/`getTime()`，显示格式化为 +08:00 时间（学校场景在香港/中国时区）。

---

### Task 1: 数据库新增 `settings` 表

**Files:**
- Modify: `server/src/storage/database/init.sql`（文件末尾追加）

- [ ] **Step 1: 在 `init.sql` 末尾追加 settings 表 DDL**

在 `registrations` 表定义之后追加：

```sql
CREATE TABLE IF NOT EXISTS settings (
  `key`   VARCHAR(100) PRIMARY KEY,
  `value` TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: 记录部署提醒（无需自动化测试，DDL 无单测覆盖）**

`init.sql` 是手动执行的初始化脚本，没有自动迁移机制。在后续部署/手动验证前，需要先在 MySQL 中执行本 DDL（或重跑 `init.sql`）。本任务的验证推迟到 Task 2 的测试（service 查询 settings 表）+ Task 7 端到端验证。

- [ ] **Step 3: 提交（可选，项目未初始化 git 时跳过）**

```bash
git add server/src/storage/database/init.sql
git commit -m "feat: add settings table for registration open time"
```

---

### Task 2: `RegistrationService.register` 增加开放时间校验（TDD）

**Files:**
- Modify: `server/src/services/registrationService.ts`
- Modify: `server/src/services/registrationService.test.ts`

**背景：** `register()` 在 `withTransaction` 回调内依次执行：查重 → 查社团 → 插入报名 → 扣名额 → 查创建时间。本次在**事务回调第一步**（查重之前）插入 settings 查询与校验。因此现有测试用例的 `execute` mock 调用序列会整体后移一位，必须同步更新。

- [ ] **Step 1: 更新现有测试用例以适配新增的 settings 查询**

修改 `registrationService.test.ts` 第一个用例 `'registers inside one transaction using row locks and decrements quota'`：

a) `execute` mock 序列最前面追加一次 settings 查询返回空（未设置）：

```ts
const execute = vi.fn()
  .mockResolvedValueOnce([[]]) // 新增：settings 表无记录（未设置开放时间）
  .mockResolvedValueOnce([[]])
  .mockResolvedValueOnce([[{ id: 1, name: '编程社', total_quota: 50, remaining_quota: 2 }]])
  .mockResolvedValueOnce([{ affectedRows: 1, insertId: 10 }])
  .mockResolvedValueOnce([{ affectedRows: 1 }])
  .mockResolvedValueOnce([[{ created_at: new Date('2026-07-31T12:00:00.000Z') }]]);
```

b) 调用次数断言 `toHaveBeenCalledTimes(5)` → `toHaveBeenCalledTimes(6)`。

c) 所有 `toHaveBeenNthCalledWith` 序号 +1（原 1→2、2→3、3→4、4→5、5→6），并新增对 settings 查询的断言：

```ts
expect(execute).toHaveBeenNthCalledWith(
  1,
  'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
  ['registration_open_at']
);
```

- [ ] **Step 2: 编写失败测试：未到开放时间时拒绝报名**

在 `registrationService.test.ts` 的 `describe` 内追加两个用例：

```ts
it('rejects registration before the configured open time', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  const withTransaction = vi.mocked(mysqlClient.withTransaction);
  const execute = vi.fn().mockResolvedValueOnce([[{ value: '2099-01-01T08:00:00+08:00' }]]);

  withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

  const { RegistrationService } = await import('./registrationService');

  const result = await RegistrationService.register({
    name: '张三',
    idCard: '123456789012345678',
    className: '高一(1)班',
    clubId: 1,
  });

  expect(result).toEqual({
    success: false,
    message: '报名尚未开始，开放时间：2099年01月01日 08:00',
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it('allows registration when the open time has passed', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  const withTransaction = vi.mocked(mysqlClient.withTransaction);
  const execute = vi.fn()
    .mockResolvedValueOnce([[{ value: '2020-01-01T08:00:00+08:00' }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([[{ id: 1, name: '编程社', total_quota: 50, remaining_quota: 2 }]])
    .mockResolvedValueOnce([{ affectedRows: 1, insertId: 10 }])
    .mockResolvedValueOnce([{ affectedRows: 1 }])
    .mockResolvedValueOnce([[{ created_at: new Date('2026-07-31T12:00:00.000Z') }]]);

  withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

  const { RegistrationService } = await import('./registrationService');

  const result = await RegistrationService.register({
    name: '张三',
    idCard: '123456789012345678',
    className: '高一(1)班',
    clubId: 1,
  });

  expect(result.success).toBe(true);
  expect(execute).toHaveBeenCalledTimes(6);
});
```

- [ ] **Step 3: 运行测试确认新用例失败**

Run: `pnpm test -- server/src/services/registrationService.test.ts`
Expected: 新用例 FAIL（`RegistrationService.register` 尚未校验开放时间，返回 `success: true` 或直接成功），现有第一个用例因 mock 序列变化也会 FAIL（属预期，Step 1 已同步）。

- [ ] **Step 4: 实现开放时间校验**

修改 `server/src/services/registrationService.ts`：

a) 在文件顶部（`StatRow` 接口之后）新增格式化函数：

```ts
export function formatOpenTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${utc8.getUTCFullYear()}年${pad(utc8.getUTCMonth() + 1)}月${pad(utc8.getUTCDate())}日 ${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}`;
}
```

b) 在 `register()` 的 `withTransaction(async (connection) => {` 之后、查重 `SELECT id FROM registrations` 之前插入：

```ts
const [settingRows] = await connection.execute<RowDataPacket[]>(
  'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
  ['registration_open_at']
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
```

- [ ] **Step 5: 运行全部测试确认通过**

Run: `pnpm test`
Expected: 全部 PASS（含更新后的第一个用例与两个新用例）。

- [ ] **Step 6: 提交（可选，项目未初始化 git 时跳过）**

```bash
git add server/src/services/registrationService.ts server/src/services/registrationService.test.ts
git commit -m "feat: block registration before configured open time"
```

---

### Task 3: 新增 settings 路由（TDD）

**Files:**
- Create: `server/src/routes/settings.ts`
- Create: `server/src/routes/settings.test.ts`

- [ ] **Step 1: 编写路由测试**

创建 `server/src/routes/settings.test.ts`：

```ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/database/mysql-client', () => ({
  query: vi.fn(),
}));

describe('settings route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function createApp() {
    const { default: settingsRouter } = await import('./settings');
    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);
    return app;
  }

  it('GET returns null when no open time is set', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([] as any);
    const app = await createApp();

    const response = await request(app).get('/api/settings/registration-open-time');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { openAt: null } });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
      ['registration_open_at']
    );
  });

  it('GET returns the stored open time', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([{ value: '2026-09-01T08:00:00+08:00' }] as any);
    const app = await createApp();

    const response = await request(app).get('/api/settings/registration-open-time');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { openAt: '2026-09-01T08:00:00+08:00' } });
  });

  it('PUT saves a valid open time', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue({ affectedRows: 1 } as any);
    const app = await createApp();

    const response = await request(app)
      .put('/api/settings/registration-open-time')
      .send({ openAt: '2026-09-01T08:00:00+08:00' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: '报名开放时间设置成功' });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      ['registration_open_at', '2026-09-01T08:00:00+08:00']
    );
  });

  it('PUT rejects an invalid date', async () => {
    const app = await createApp();

    const response = await request(app)
      .put('/api/settings/registration-open-time')
      .send({ openAt: 'not-a-date' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: '开放时间格式不正确' });
  });

  it('PUT with null clears the setting', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue({ affectedRows: 1 } as any);
    const app = await createApp();

    const response = await request(app)
      .put('/api/settings/registration-open-time')
      .send({ openAt: null });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: '已清除报名开放时间，学生可随时报名' });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'DELETE FROM settings WHERE `key` = ?',
      ['registration_open_at']
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- server/src/routes/settings.test.ts`
Expected: FAIL（`./settings` 模块不存在）。

- [ ] **Step 3: 实现路由**

创建 `server/src/routes/settings.ts`：

```ts
import express from 'express';
import { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { query } from '../storage/database/mysql-client';

const router = express.Router();

const OPEN_TIME_KEY = 'registration_open_at';

interface SettingRow extends RowDataPacket {
  value: string | null;
}

router.get('/registration-open-time', async (req, res) => {
  try {
    const rows = await query<SettingRow[]>(
      'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
      [OPEN_TIME_KEY]
    );
    res.json({ success: true, data: { openAt: rows.length > 0 ? rows[0].value : null } });
  } catch (error: any) {
    console.error('获取报名开放时间错误:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.put('/registration-open-time', async (req, res) => {
  try {
    const { openAt } = req.body;

    if (openAt === null || openAt === undefined) {
      await query<ResultSetHeader>('DELETE FROM settings WHERE `key` = ?', [OPEN_TIME_KEY]);
      return res.json({ success: true, message: '已清除报名开放时间，学生可随时报名' });
    }

    if (typeof openAt !== 'string' || Number.isNaN(Date.parse(openAt))) {
      return res.status(400).json({ success: false, message: '开放时间格式不正确' });
    }

    await query<ResultSetHeader>(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [OPEN_TIME_KEY, openAt]
    );

    res.json({ success: true, message: '报名开放时间设置成功' });
  } catch (error: any) {
    console.error('设置报名开放时间错误:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

export default router;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- server/src/routes/settings.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交（可选，项目未初始化 git 时跳过）**

```bash
git add server/src/routes/settings.ts server/src/routes/settings.test.ts
git commit -m "feat: add settings route for registration open time"
```

---

### Task 4: 挂载 settings 路由并全量回归

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: 引入并挂载路由**

修改 `server/index.ts`：

a) 在 `import studentsRouter from './src/routes/students';` 之后追加：

```ts
import settingsRouter from './src/routes/settings';
```

b) 在 `app.use('/api/students', studentsRouter);` 之后追加：

```ts
app.use('/api/settings', settingsRouter);
```

- [ ] **Step 2: 全量测试 + 类型检查**

Run: `pnpm test`
Expected: 全部 PASS。

Run: `npx tsc --noEmit`（若顶层 tsconfig 报与本次改动无关的既有错误，忽略即可；重点确认 settings.ts / registrationService.ts 无类型错误）
Expected: 无本次改动引入的类型错误。

- [ ] **Step 3: 提交（可选，项目未初始化 git 时跳过）**

```bash
git add server/index.ts
git commit -m "chore: mount settings router"
```

---

### Task 5: 管理端 Admin.vue 新增「报名设置」Tab

**Files:**
- Modify: `src/views/Admin.vue`

无前端组件测试框架，遵循项目现有模式（手动验证），不写单测。

- [ ] **Step 1: script setup 增加状态与逻辑**

在 `src/views/Admin.vue` 的 `<script setup>` 中，`onMounted` 之前追加：

```ts
// 报名开放时间设置
const openTimeDialogVisible = ref(false)
const openAt = ref<string | null>(null)
const newOpenAt = ref<Date | null>(null)
const savingOpenTime = ref(false)

// 获取当前设置
const loadOpenTime = async () => {
  try {
    const response = await axios.get('/api/settings/registration-open-time')
    openAt.value = response.data.data?.openAt ?? null
  } catch (error: any) {
    console.error(error)
  }
}

// Date -> +08:00 ISO 字符串（与后端约定一致）
const toUtc8Iso = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return `${utc8.getUTCFullYear()}-${pad(utc8.getUTCMonth() + 1)}-${pad(utc8.getUTCDate())}T${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}:${pad(utc8.getUTCSeconds())}+08:00`
}

// 展示格式化（浏览器本地时区即 +08:00）
const formatOpenAt = (iso: string) => new Date(iso).toLocaleString('zh-CN')

// 保存设置
const handleSaveOpenTime = async () => {
  if (!newOpenAt.value) {
    ElMessage.warning('请选择开放时间')
    return
  }
  savingOpenTime.value = true
  try {
    const response = await axios.put('/api/settings/registration-open-time', {
      openAt: toUtc8Iso(newOpenAt.value)
    })
    if (response.data.success) {
      ElMessage.success(response.data.message)
      openAt.value = toUtc8Iso(newOpenAt.value)
      openTimeDialogVisible.value = false
    } else {
      ElMessage.error(response.data.message)
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '设置失败')
    console.error(error)
  } finally {
    savingOpenTime.value = false
  }
}

// 清除设置
const handleClearOpenTime = () => {
  ElMessageBox.confirm('确定要清除报名开放时间设置吗？清除后学生可随时报名。', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      const response = await axios.put('/api/settings/registration-open-time', { openAt: null })
      if (response.data.success) {
        ElMessage.success(response.data.message)
        openAt.value = null
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '清除失败')
      console.error(error)
    }
  }).catch(() => {})
}
```

在 `onMounted(() => {` 回调内追加 `loadOpenTime()`：

```ts
onMounted(() => {
  loadClubs()
  loadRegistrations()
  loadStudents()
  loadOpenTime()
})
```

- [ ] **Step 2: 模板新增「报名设置」tab-pane 与对话框**

在 `</el-tabs>` 之前、`<!-- 学生信息管理 -->` 的 `</el-tab-pane>` 之后追加：

```html
<!-- 报名设置 -->
<el-tab-pane label="报名设置" name="settings">
  <el-card>
    <template #header>
      <div class="card-header">
        <span>报名开放时间设置</span>
        <div class="header-buttons">
          <el-button type="primary" @click="openTimeDialogVisible = true" :icon="'Clock'">
            设置开放时间
          </el-button>
        </div>
      </div>
    </template>
    <el-alert
      v-if="openAt === null"
      title="当前未设置报名开放时间，学生可随时报名"
      type="info"
      :closable="false"
    />
    <el-alert
      v-else
      type="success"
      :closable="false"
    >
      <template #default>
        <div>报名将于 {{ formatOpenAt(openAt) }} 开放，到达开放时间后学生可自动报名。</div>
        <el-button type="danger" size="small" @click="handleClearOpenTime" style="margin-top: 8px">
          清除设置
        </el-button>
      </template>
    </el-alert>
    <p class="settings-tip">设置后，学生在开放时间之前无法提交报名；未设置时学生可随时报名。</p>
  </el-card>
</el-tab-pane>
```

在 `<!-- 导入学生对话框 -->` 的 `</el-dialog>` 之后追加：

```html
<!-- 设置开放时间对话框 -->
<el-dialog v-model="openTimeDialogVisible" title="设置报名开放时间" width="420px">
  <el-form label-width="100px">
    <el-form-item label="开放时间" required>
      <el-date-picker
        v-model="newOpenAt"
        type="datetime"
        placeholder="选择报名开放时间"
        style="width: 100%"
        :disabled-date="(d: Date) => d.getTime() <= Date.now()"
      />
    </el-form-item>
  </el-form>
  <template #footer>
    <el-button @click="openTimeDialogVisible = false">取消</el-button>
    <el-button type="primary" @click="handleSaveOpenTime" :loading="savingOpenTime">保存</el-button>
  </template>
</el-dialog>
```

- [ ] **Step 3: 追加样式**

在 `<style scoped>` 内追加：

```css
.settings-tip {
  margin: 16px 0 0 0;
  color: #909399;
  font-size: 13px;
}
```

- [ ] **Step 4: 前端构建检查**

Run: `pnpm build`
Expected: 构建成功，无 TS/模板错误。

- [ ] **Step 5: 提交（可选，项目未初始化 git 时跳过）**

```bash
git add src/views/Admin.vue
git commit -m "feat: add registration open time settings tab in admin"
```

---

### Task 6: 学生端 Register.vue 增加未开放提示与倒计时

**Files:**
- Modify: `src/views/Register.vue`

无前端组件测试框架，遵循项目现有模式（手动验证），不写单测。

- [ ] **Step 1: script setup 增加状态与逻辑**

a) 修改 `import { ref, onMounted } from 'vue'` 为：

```ts
import { ref, computed, onMounted, onUnmounted } from 'vue'
```

b) 在 `const submitting = ref(false)` 之后追加：

```ts
// 报名开放时间
const openAt = ref<string | null>(null)
const now = ref(Date.now())
let timer: number | undefined

const isOpen = computed(() => openAt.value === null || now.value >= new Date(openAt.value).getTime())

// 展示开放时间（浏览器本地时区即 +08:00）
const openTimeText = computed(() => {
  if (openAt.value === null) return ''
  return new Date(openAt.value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
})

// 倒计时文本
const countdownText = computed(() => {
  if (openAt.value === null) return ''
  const diff = new Date(openAt.value).getTime() - now.value
  if (diff <= 0) return ''
  const totalSeconds = Math.floor(diff / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `距离报名开始还有 ${days} 天 ${hours} 小时 ${minutes} 分 ${seconds} 秒`
})

// 加载开放时间设置
const loadOpenTime = async () => {
  try {
    const response = await axios.get('/api/settings/registration-open-time')
    openAt.value = response.data.data?.openAt ?? null
  } catch (error: any) {
    console.error(error)
  }
}
```

c) 修改 `onMounted`：

```ts
onMounted(() => {
  loadClubs()
  loadOpenTime()
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
```

- [ ] **Step 2: 模板增加提示并禁用表单**

a) 在 `<p class="subtitle">社团报名</p>` 之后、`<el-form` 之前插入：

```html
<el-alert
  v-if="!isOpen"
  type="warning"
  :closable="false"
  class="open-time-alert"
>
  <template #default>
    <div>报名尚未开始，将于 {{ openTimeText }} 开放</div>
    <div v-if="countdownText" class="countdown">{{ countdownText }}</div>
  </template>
</el-alert>
```

b) 修改 `<el-form :model="form" label-width="100px" class="register-form">` 为：

```html
<el-form :model="form" label-width="100px" class="register-form" :disabled="!isOpen">
```

c) 提交按钮追加禁用属性：

```html
<el-button
  type="primary"
  @click="handleSubmit"
  :loading="submitting"
  :disabled="!isOpen"
  style="width: 100%"
>
  提交报名
</el-button>
```

- [ ] **Step 3: 追加样式**

在 `<style scoped>` 内追加：

```css
.open-time-alert {
  margin-bottom: 20px;
  text-align: left;
}

.open-time-alert .countdown {
  margin-top: 4px;
  font-weight: 600;
}
```

- [ ] **Step 4: 前端构建检查**

Run: `pnpm build`
Expected: 构建成功，无 TS/模板错误。

- [ ] **Step 5: 提交（可选，项目未初始化 git 时跳过）**

```bash
git add src/views/Register.vue
git commit -m "feat: show countdown and disable form before registration opens"
```

---

### Task 7: 端到端手动验证

**Files:** 无代码改动（验证用）

前置条件：MySQL 中已执行 Task 1 的 DDL（settings 表存在）；`.env` 已配置 MYSQL_*。

- [ ] **Step 1: 启动服务**

Run: `pnpm dev`
Expected: 前端 `http://localhost:5173`、后端 `http://localhost:3001`（或 .env 指定端口）正常启动。

- [ ] **Step 2: 后台设置开放时间**

1. 浏览器打开 `http://localhost:5173/#/admin`（或对应后台路由），进入「报名设置」Tab
2. 点击「设置开放时间」，选择 2 分钟后的时间，保存
3. Expected：提示「报名开放时间设置成功」，状态显示「报名将于 … 开放」+「清除设置」按钮

- [ ] **Step 3: 学生端未开放状态**

1. 打开报名页，Expected：显示「报名尚未开始，将于 … 开放」+ 倒计时（每秒递减）
2. 表单所有输入框与「提交报名」按钮禁用，无法填写/提交
3. 等待到达开放时间（或重新设置成 1 分钟后等待）
4. Expected：提示消失、表单自动解禁，可正常填写并提交报名

- [ ] **Step 4: 服务端兜底验证**

1. 后台把开放时间设置为 10 分钟后的时间
2. 打开浏览器开发者工具 Console，直接执行：

```js
fetch('/api/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '张三', idCard: '123456789012345678', className: '高一(1)班', clubId: 1 })
}).then(r => r.json()).then(console.log)
```

Expected: 返回 `{ success: false, message: '报名尚未开始，开放时间：…' }`（服务端拦截，绕开前端也报不了名）

- [ ] **Step 5: 清除设置恢复随时可报**

1. 后台点击「清除设置」并确认
2. Expected：提示「已清除报名开放时间，学生可随时报名」，状态回到「当前未设置报名开放时间」
3. 学生端刷新：无提示、表单可用，可正常报名

- [ ] **Step 6: 回归确认**

Run: `pnpm test`
Expected: 全部 PASS。
Run: `pnpm build`
Expected: 构建成功。