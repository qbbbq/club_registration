# 报名页身份证自动带出学生信息 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 报名页只输入身份证号（满 18 位自动查询），姓名与班级改为只读标签展示，数据来自 `students` 表。

**Architecture:** 后端在 `server/src/routes/students.ts` 新增 `POST /api/students/lookup`（按身份证精确查询，返回姓名+班级），沿用现有 `query()` + RowDataPacket 模式；前端 `src/views/Register.vue` 在身份证输入框 `@input` 事件中检测满 18 位后自动查询，姓名/班级改用 `el-tag` 只读展示，提交逻辑与后端白名单校验不变。

**Tech Stack:** Express 5 + mysql2/promise + Vitest + supertest；Vue 3 SFC + Element Plus + axios。

**注意：** 本目录不是 git 仓库（`git status` 报 no repository），所有任务中的 commit 步骤一律跳过并在计划中记录。

---

### Task 1: 后端新增 POST /api/students/lookup（TDD）

**Files:**
- Modify: `server/src/routes/students.ts`（在 `/verify` 接口之后、文件末尾 `export default router` 之前新增）
- Test: `server/src/routes/students.test.ts`（在 `describe('students route')` 块内追加用例）

- [ ] **Step 1: 写失败测试**

在 `server/src/routes/students.test.ts` 的 `describe('students route', () => { ... })` 块内、最后一个 `it(...)` 之后追加以下 3 个用例：

```ts
  it('looks up a student by id card returning name and class name', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([
      { name: '张三', class_name: '高一(1)班' },
    ] as any);
    const app = await createApp();

    const response = await request(app).post('/api/students/lookup').send({
      idCard: '123456789012345678',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { name: '张三', className: '高一(1)班' },
    });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'SELECT name, class_name FROM students WHERE id_card = ? LIMIT 1',
      ['123456789012345678']
    );
  });

  it('lookup returns null data when student does not exist', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([] as any);
    const app = await createApp();

    const response = await request(app).post('/api/students/lookup').send({
      idCard: '123456789012345678',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: null,
      message: '学生信息不存在，请联系管理员导入',
    });
  });

  it('lookup rejects invalid id card format', async () => {
    const app = await createApp();

    const response = await request(app).post('/api/students/lookup').send({
      idCard: '12345',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: '身份证号格式不正确' });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run server/src/routes/students.test.ts`
Expected: 新 3 个用例 FAIL（`/api/students/lookup` 返回 404 Not Found），既有用例 PASS。

- [ ] **Step 3: 实现接口**

在 `server/src/routes/students.ts` 中、`/verify` 接口（`router.post('/verify', ...)` 结尾）之后、`export default router;` 之前插入：

```ts
router.post('/lookup', async (req: Request, res: Response) => {
  try {
    const { idCard } = req.body;

    if (!idCard || !/^\d{17}[\dXx]$/.test(String(idCard))) {
      return res.status(400).json({ success: false, message: '身份证号格式不正确' });
    }

    const rows = await query<StudentRow[]>(
      'SELECT name, class_name FROM students WHERE id_card = ? LIMIT 1',
      [idCard]
    );

    if (rows.length === 0) {
      return res.json({ success: true, data: null, message: '学生信息不存在，请联系管理员导入' });
    }

    res.json({
      success: true,
      data: { name: rows[0].name, className: rows[0].class_name },
    });
  } catch (error: any) {
    console.error('查询学生信息错误:', error);
    res.status(500).json({ success: false, message: error.message || '服务器内部错误' });
  }
});
```

（`StudentRow` 接口与 `query` 已在文件顶部导入，无需改动 import。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run server/src/routes/students.test.ts`
Expected: 5 个用例全部 PASS（既有 2 个 + 新增 3 个）。

- [ ] **Step 5: 提交（跳过）**

Run: `git status`
Expected: 非 git 仓库，跳过 commit 并记录。

---

### Task 2: 前端 Register.vue 改造

**Files:**
- Modify: `src/views/Register.vue`（script setup 部分、template 表单部分、style 部分）

- [ ] **Step 1: 修改 script 部分**

将 `script setup` 中的表单定义与提交逻辑改造如下（基于当前文件逐块替换，其余函数如 `loadClubs`、`goToAdmin`、`onMounted` 保持不变）：

1a. 表单字段重排，将：

```ts
// 表单数据
const form = ref({
  name: '',
  idCard: '',
  className: '',
  clubId: ''
})
```

替换为：

```ts
// 表单数据（姓名、班级由身份证号自动带出）
const form = ref({
  idCard: '',
  name: '',
  className: '',
  clubId: ''
})

// 查询状态
const fetching = ref(false)
const lastQueriedCard = ref('')

const ID_CARD_REGEX = /^\d{17}[\dXx]$/
```

1b. 新增身份证号输入处理函数，将：

```ts
// 提交报名
const handleSubmit = async () => {
```

之前插入：

```ts
// 身份证号变化：清空已带出的姓名/班级；满 18 位自动查询
const handleIdCardInput = async () => {
  const card = form.value.idCard

  if (card !== lastQueriedCard.value) {
    if (lastQueriedCard.value) {
      form.value.name = ''
      form.value.className = ''
    }
    lastQueriedCard.value = ''
  }

  if (!ID_CARD_REGEX.test(card) || fetching.value) return

  fetching.value = true
  lastQueriedCard.value = card
  try {
    const response = await axios.post('/api/students/lookup', { idCard: card })
    if (response.data.success && response.data.data) {
      form.value.name = response.data.data.name
      form.value.className = response.data.data.className
    } else {
      ElMessage.warning(response.data.message || '学生信息不存在，请联系管理员导入')
    }
  } catch (error: any) {
    // 查询失败不清空已带出信息
    ElMessage.error('查询失败，请稍后重试')
    console.error(error)
  } finally {
    fetching.value = false
  }
}

```

1c. 修改提交校验，将：

```ts
const handleSubmit = async () => {
  if (!form.value.name || !form.value.idCard || !form.value.className || !form.value.clubId) {
    ElMessage.warning('请填写完整信息')
    return
  }

  if (!/^\d{17}[\dXx]$/.test(form.value.idCard)) {
    ElMessage.warning('身份证号格式不正确')
    return
  }
```

替换为：

```ts
const handleSubmit = async () => {
  if (!form.value.idCard) {
    ElMessage.warning('请输入身份证号')
    return
  }

  if (!ID_CARD_REGEX.test(form.value.idCard)) {
    ElMessage.warning('身份证号格式不正确')
    return
  }

  if (!form.value.name || !form.value.className) {
    ElMessage.warning('请先输入身份证号查询学生信息')
    return
  }

  if (!form.value.clubId) {
    ElMessage.warning('请选择社团')
    return
  }
```

1d. 提交成功重置表单，将：

```ts
      // 重置表单
      form.value = {
        name: '',
        idCard: '',
        className: '',
        clubId: ''
      }
      // 刷新社团列表
      await loadClubs()
```

替换为：

```ts
      // 重置表单
      form.value = {
        idCard: '',
        name: '',
        className: '',
        clubId: ''
      }
      lastQueriedCard.value = ''
      // 刷新社团列表
      await loadClubs()
```

- [ ] **Step 2: 修改 template 部分**

将：

```html
        <el-form-item label="姓名">
          <el-input 
            v-model="form.name" 
            placeholder="请输入姓名"
            clearable
          />
        </el-form-item>

        <el-form-item label="身份证号">
          <el-input 
            v-model="form.idCard" 
            placeholder="请输入18位身份证号"
            maxlength="18"
            clearable
          />
        </el-form-item>

        <el-form-item label="班级">
          <el-input 
            v-model="form.className" 
            placeholder="例如：计算机2023级1班"
            clearable
          />
        </el-form-item>
```

替换为：

```html
        <el-form-item label="身份证号">
          <el-input 
            v-model="form.idCard" 
            placeholder="请输入18位身份证号"
            maxlength="18"
            clearable
            :loading="fetching"
            @input="handleIdCardInput"
          />
        </el-form-item>

        <el-form-item label="姓名">
          <el-tag v-if="form.name" size="large" class="student-tag">{{ form.name }}</el-tag>
          <span v-else class="tag-placeholder">请输入身份证号后自动带出</span>
        </el-form-item>

        <el-form-item label="班级">
          <el-tag v-if="form.className" size="large" type="info" class="student-tag">{{ form.className }}</el-tag>
          <span v-else class="tag-placeholder">请输入身份证号后自动带出</span>
        </el-form-item>
```

- [ ] **Step 3: 修改 style 部分**

在 `<style scoped>` 内（`</style>` 之前）追加：

```css
.student-tag {
  height: 32px;
  line-height: 30px;
  font-size: 14px;
}

.tag-placeholder {
  color: #a8abb2;
  font-size: 14px;
}
```

- [ ] **Step 4: 构建检查**

Run: `corepack pnpm run build`
Expected: `vue-tsc -b && vite build` 退出码 0（类型检查通过，无未使用变量报错——注意 `handleIdCardInput` 已在模板中使用，`fetching`、`lastQueriedCard`、`ID_CARD_REGEX` 均被引用）。

- [ ] **Step 5: 提交（跳过）**

Run: `git status`
Expected: 非 git 仓库，跳过 commit 并记录。

---

### Task 3: 回归验证

**Files:**
- Verify: `server/src/routes/students.ts`、`server/src/routes/students.test.ts`、`src/views/Register.vue`

- [ ] **Step 1: 运行全部测试**

Run: `corepack pnpm test`
Expected: 全部用例 PASS（students 路由新增 3 个用例 + 既有用例），无回归。

- [ ] **Step 2: 类型检查与生产构建**

Run: `corepack pnpm run build`
Expected: 退出码 0，dist 生成成功。

- [ ] **Step 3: 浏览器验证（需后端 + MySQL 可用）**

Run: `corepack pnpm run dev`（同时启动前端 5000 与后端 3001；若本地 MySQL 未启动则本步骤部分场景不可验证，如实记录）

1. 后台导入一名学生（如：张三 / 123456789012345678 / 高一(1)班），确保 `students` 表有记录
2. 打开 `http://localhost:5000/register`
3. 身份证号输入 18 位合法号码 → 姓名/班级标签自动出现（姓名「张三」、班级「高一(1)班」）
4. 输入未导入的 18 位号码 → 出现「学生信息不存在，请联系管理员导入」警告，姓名/班级为空，提交被拦截
5. 修改身份证号（删一位）→ 姓名/班级标签清空，提交被拦截（提示先查询）
6. 正常流程提交 → 「报名成功」，后台报名记录 +1、社团名额 -1

Expected: 上述 6 个场景全部符合预期。
