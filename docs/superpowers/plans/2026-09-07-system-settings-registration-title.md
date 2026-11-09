# 系统设置与报名入口标题实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将后台“报名设置”改为“系统设置”，增加可保存的报名入口标题，并让二维码入口页与报名页统一显示该标题。

**Architecture:** 复用现有 `settings` 表，通过 `registration_title` 键保存标题；保留现有开放时间接口。前端新增共享标题读取工具，Home 和 Register 页面都从同一接口读取标题并在失败时回退到默认值“社团报名系统”。后台系统设置页同时管理报名标题和开放时间。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Axios、Express、MySQL、Vitest。

---

## 文件与职责映射

- Modify: `server/src/routes/settings.ts` - 增加报名入口标题常量、读取接口、保存/清空接口和输入校验。
- Modify: `server/src/routes/settings.test.ts` - 覆盖标题接口的默认值、读写、清空和长度校验。
- Create: `src/utils/registrationSettings.ts` - 定义默认标题并封装前台读取标题的回退逻辑。
- Create: `src/utils/registrationSettings.test.ts` - 测试标题读取成功、空值和请求失败时的默认回退。
- Modify: `src/views/Home.vue` - 读取并显示统一标题，保持二维码地址不变。
- Modify: `src/views/Register.vue` - 读取并显示统一标题，保持报名业务流程不变。
- Modify: `src/views/Admin.vue` - 将 tab 改为“系统设置”，增加标题输入、保存和加载状态。
- Modify: `src/views/admin-responsive.test.ts` - 增加系统设置 tab 和标题输入控件的源码契约测试。
- Create: `src/views/registration-title.test.ts` - 确认二维码页与报名页都引用共享标题工具并渲染标题状态。

不修改 `server/src/storage/database/init.sql`，因为 `settings` 表已经支持任意配置键，不需要数据库迁移。

### Task 1: 增加服务端报名标题接口

**Files:**
- Modify: `server/src/routes/settings.test.ts`
- Modify: `server/src/routes/settings.ts`

- [ ] **Step 1: 在服务端测试中先写无配置时返回默认标题的失败测试**

在 `settings.test.ts` 中新增：

```ts
it('GET returns the default registration title when no title is set', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  vi.mocked(mysqlClient.query).mockResolvedValue([] as any);
  const app = await createApp();

  const response = await request(app).get('/api/settings/registration-title');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    success: true,
    data: { title: '社团报名系统' },
  });
  expect(mysqlClient.query).toHaveBeenCalledWith(
    'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
    ['registration_title']
  );
});
```

- [ ] **Step 2: 运行该测试，确认它因接口不存在而失败**

运行：

```bash
corepack pnpm exec vitest run server/src/routes/settings.test.ts -t "default registration title"
```

预期：FAIL，原因是 `/api/settings/registration-title` 尚未实现。

- [ ] **Step 3: 写入服务端标题常量和 GET 接口的最小实现**

在 `settings.ts` 顶部增加：

```ts
const REGISTRATION_TITLE_KEY = 'registration_title';
const DEFAULT_REGISTRATION_TITLE = '社团报名系统';
const MAX_REGISTRATION_TITLE_LENGTH = 30;
```

在现有开放时间路由之前增加 GET 路由：

```ts
router.get('/registration-title', async (req, res) => {
  try {
    const rows = await query<SettingRow[]>(
      'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
      [REGISTRATION_TITLE_KEY]
    );
    const storedTitle = rows[0]?.value?.trim();
    res.json({
      success: true,
      data: { title: storedTitle || DEFAULT_REGISTRATION_TITLE },
    });
  } catch (error: any) {
    console.error('获取报名入口标题错误:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});
```

- [ ] **Step 4: 运行 GET 测试，确认通过**

运行：

```bash
corepack pnpm exec vitest run server/src/routes/settings.test.ts -t "default registration title"
```

预期：1 个测试通过。

- [ ] **Step 5: 添加已保存标题、空值和保存/清空的失败测试**

在 `settings.test.ts` 中加入以下行为测试：

```ts
it('GET returns the stored registration title', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  vi.mocked(mysqlClient.query).mockResolvedValue([{ value: '2026 秋季社团报名' }] as any);
  const app = await createApp();

  const response = await request(app).get('/api/settings/registration-title');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    success: true,
    data: { title: '2026 秋季社团报名' },
  });
});

it('PUT saves a trimmed registration title', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  vi.mocked(mysqlClient.query).mockResolvedValue({ affectedRows: 1 } as any);
  const app = await createApp();

  const response = await request(app)
    .put('/api/settings/registration-title')
    .send({ title: '  2026 秋季社团报名  ' });

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    success: true,
    message: '报名入口标题设置成功',
    data: { title: '2026 秋季社团报名' },
  });
  expect(mysqlClient.query).toHaveBeenCalledWith(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    ['registration_title', '2026 秋季社团报名']
  );
});

it('PUT with an empty title clears the setting and restores the default', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  vi.mocked(mysqlClient.query).mockResolvedValue({ affectedRows: 1 } as any);
  const app = await createApp();

  const response = await request(app)
    .put('/api/settings/registration-title')
    .send({ title: '   ' });

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    success: true,
    message: '已恢复默认报名入口标题',
    data: { title: '社团报名系统' },
  });
  expect(mysqlClient.query).toHaveBeenCalledWith(
    'DELETE FROM settings WHERE `key` = ?',
    ['registration_title']
  );
});

it('PUT rejects a registration title longer than 30 characters', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  const app = await createApp();

  const response = await request(app)
    .put('/api/settings/registration-title')
    .send({ title: '一'.repeat(31) });

  expect(response.status).toBe(400);
  expect(response.body).toEqual({
    success: false,
    message: '报名入口标题不能超过30个字符',
  });
  expect(mysqlClient.query).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: 运行新增测试，确认它们按预期失败**

运行：

```bash
corepack pnpm exec vitest run server/src/routes/settings.test.ts -t "registration title"
```

预期：新增 PUT 测试失败，因为保存接口尚未实现。

- [ ] **Step 7: 实现 PUT 标题接口及校验**

在 `settings.ts` 中增加以下接口。校验顺序必须先拒绝非字符串非空值，再将 `null`、`undefined` 和空白字符串视为清空；长度使用 Unicode code point 数量，避免中文标题被错误计算。

```ts
router.put('/registration-title', async (req, res) => {
  try {
    const rawTitle = req.body?.title;

    if (rawTitle !== null && rawTitle !== undefined && typeof rawTitle !== 'string') {
      return res.status(400).json({
        success: false,
        message: '报名入口标题格式不正确',
      });
    }

    const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';

    if (title.length === 0) {
      await query<ResultSetHeader>('DELETE FROM settings WHERE `key` = ?', [REGISTRATION_TITLE_KEY]);
      return res.json({
        success: true,
        message: '已恢复默认报名入口标题',
        data: { title: DEFAULT_REGISTRATION_TITLE },
      });
    }

    if ([...title].length > MAX_REGISTRATION_TITLE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: '报名入口标题不能超过30个字符',
      });
    }

    await query<ResultSetHeader>(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [REGISTRATION_TITLE_KEY, title]
    );

    res.json({
      success: true,
      message: '报名入口标题设置成功',
      data: { title },
    });
  } catch (error: any) {
    console.error('设置报名入口标题错误:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});
```

- [ ] **Step 8: 运行服务端设置测试并确认所有通过**

运行：

```bash
corepack pnpm exec vitest run server/src/routes/settings.test.ts
```

预期：该文件全部测试通过，既有开放时间测试不回归。

### Task 2: 增加前端共享标题读取工具

**Files:**
- Create: `src/utils/registrationSettings.ts`
- Create: `src/utils/registrationSettings.test.ts`

- [ ] **Step 1: 写共享工具的失败测试**

创建 `registrationSettings.test.ts`，使用 Vitest mock Axios：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

describe('registration settings', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns the stored title', async () => {
    const axios = await import('axios');
    vi.mocked(axios.default.get).mockResolvedValue({
      data: { success: true, data: { title: '2026 秋季社团报名' } },
    } as any);
    const { loadRegistrationTitle } = await import('./registrationSettings');

    await expect(loadRegistrationTitle()).resolves.toBe('2026 秋季社团报名');
    expect(axios.default.get).toHaveBeenCalledWith('/api/settings/registration-title');
  });

  it('falls back to the default title for an empty response', async () => {
    const axios = await import('axios');
    vi.mocked(axios.default.get).mockResolvedValue({
      data: { success: true, data: { title: '   ' } },
    } as any);
    const { DEFAULT_REGISTRATION_TITLE, loadRegistrationTitle } =
      await import('./registrationSettings');

    await expect(loadRegistrationTitle()).resolves.toBe(DEFAULT_REGISTRATION_TITLE);
  });

  it('falls back to the default title when loading fails', async () => {
    const axios = await import('axios');
    vi.mocked(axios.default.get).mockRejectedValue(new Error('network unavailable'));
    const { DEFAULT_REGISTRATION_TITLE, loadRegistrationTitle } =
      await import('./registrationSettings');

    await expect(loadRegistrationTitle()).resolves.toBe(DEFAULT_REGISTRATION_TITLE);
  });
});
```

- [ ] **Step 2: 运行工具测试，确认因文件不存在而失败**

运行：

```bash
corepack pnpm exec vitest run src/utils/registrationSettings.test.ts
```

预期：FAIL，原因是共享工具尚未创建。

- [ ] **Step 3: 实现默认值和读取回退逻辑**

创建 `registrationSettings.ts`：

```ts
import axios from 'axios';

export const DEFAULT_REGISTRATION_TITLE = '社团报名系统';

export async function loadRegistrationTitle(): Promise<string> {
  try {
    const response = await axios.get('/api/settings/registration-title');
    const title = response.data?.data?.title;
    return typeof title === 'string' && title.trim()
      ? title.trim()
      : DEFAULT_REGISTRATION_TITLE;
  } catch (error) {
    console.error('读取报名入口标题失败:', error);
    return DEFAULT_REGISTRATION_TITLE;
  }
}
```

- [ ] **Step 4: 运行工具测试并确认通过**

运行：

```bash
corepack pnpm exec vitest run src/utils/registrationSettings.test.ts
```

预期：3 个测试通过。

### Task 3: 将标题接入二维码页和报名页

**Files:**
- Modify: `src/views/Home.vue`
- Modify: `src/views/Register.vue`
- Create: `src/views/registration-title.test.ts`

- [ ] **Step 1: 写前端页面契约测试**

创建 `registration-title.test.ts`：

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeSource = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8');
const registerSource = readFileSync(new URL('./Register.vue', import.meta.url), 'utf8');

describe('registration title integration', () => {
  it('uses the shared title loader on the QR entry page', () => {
    expect(homeSource).toContain("from '../utils/registrationSettings'");
    expect(homeSource).toContain('loadRegistrationTitle');
    expect(homeSource).toContain('{{ registrationTitle }}');
  });

  it('uses the shared title loader on the registration page', () => {
    expect(registerSource).toContain("from '../utils/registrationSettings'");
    expect(registerSource).toContain('loadRegistrationTitle');
    expect(registerSource).toContain('{{ registrationTitle }}');
  });
});
```

- [ ] **Step 2: 运行契约测试，确认它因页面仍使用固定文案而失败**

运行：

```bash
corepack pnpm exec vitest run src/views/registration-title.test.ts
```

预期：FAIL，原因是两个页面尚未接入共享标题工具。

- [ ] **Step 3: 修改 Home.vue 使用共享标题并保持二维码地址不变**

在 `Home.vue` 导入：

```ts
import {
  DEFAULT_REGISTRATION_TITLE,
  loadRegistrationTitle,
} from '../utils/registrationSettings'
```

增加状态：

```ts
const registrationTitle = ref(DEFAULT_REGISTRATION_TITLE)
```

将初始化改为：

```ts
onMounted(async () => {
  registrationTitle.value = await loadRegistrationTitle()
  await generateQRCode()
})
```

将模板中的固定副标题：

```vue
<p class="subtitle">社团报名系统</p>
```

改为：

```vue
<p class="subtitle">{{ registrationTitle }}</p>
```

二维码仍使用 `${window.location.origin}/register`，不向二维码 URL 添加标题参数。

- [ ] **Step 4: 修改 Register.vue 使用共享标题并保持报名逻辑不变**

导入共享工具：

```ts
import {
  DEFAULT_REGISTRATION_TITLE,
  loadRegistrationTitle,
} from '../utils/registrationSettings'
```

增加：

```ts
const registrationTitle = ref(DEFAULT_REGISTRATION_TITLE)
```

在现有 `onMounted` 中加入：

```ts
registrationTitle.value = await loadRegistrationTitle()
```

由于现有 `onMounted` 回调不是 async，可改为：

```ts
onMounted(() => {
  loadClubs()
  loadOpenTime()
  loadRegistrationTitle().then((title) => {
    registrationTitle.value = title
  })
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
```

将：

```vue
<p class="subtitle">社团报名</p>
```

改为：

```vue
<p class="subtitle">{{ registrationTitle }}</p>
```

- [ ] **Step 5: 运行页面契约测试和共享工具测试**

运行：

```bash
corepack pnpm exec vitest run src/utils/registrationSettings.test.ts src/views/registration-title.test.ts
```

预期：5 个测试全部通过。

### Task 4: 在后台系统设置中增加标题配置

**Files:**
- Modify: `src/views/Admin.vue`
- Modify: `src/views/admin-responsive.test.ts`

- [ ] **Step 1: 在后台源码契约测试中加入失败断言**

在 `admin-responsive.test.ts` 中新增：

```ts
it('renames the tab to system settings and exposes a 30-character registration title field', () => {
  expect(adminSource).toContain('label="系统设置"');
  expect(adminSource).toContain('v-model="registrationTitleDraft"');
  expect(adminSource).toContain('maxlength="30"');
  expect(adminSource).toContain('handleSaveRegistrationTitle');
});
```

- [ ] **Step 2: 运行后台契约测试，确认它因当前文案和控件不存在而失败**

运行：

```bash
corepack pnpm exec vitest run src/views/admin-responsive.test.ts -t "system settings"
```

预期：FAIL。

- [ ] **Step 3: 增加后台标题状态和加载/保存逻辑**

在 `Admin.vue` 引入共享常量：

```ts
import { DEFAULT_REGISTRATION_TITLE } from '../utils/registrationSettings'
```

在开放时间状态附近增加：

```ts
const registrationTitleDraft = ref(DEFAULT_REGISTRATION_TITLE)
const savingRegistrationTitle = ref(false)
```

增加加载函数：

```ts
const loadRegistrationTitle = async () => {
  try {
    const response = await axios.get('/api/settings/registration-title')
    const title = response.data.data?.title
    registrationTitleDraft.value = typeof title === 'string' && title.trim()
      ? title.trim()
      : DEFAULT_REGISTRATION_TITLE
  } catch (error: any) {
    registrationTitleDraft.value = DEFAULT_REGISTRATION_TITLE
    console.error(error)
  }
}
```

增加保存函数：

```ts
const handleSaveRegistrationTitle = async () => {
  savingRegistrationTitle.value = true
  try {
    const response = await axios.put('/api/settings/registration-title', {
      title: registrationTitleDraft.value,
    })
    if (response.data.success) {
      registrationTitleDraft.value = response.data.data?.title || DEFAULT_REGISTRATION_TITLE
      ElMessage.success(response.data.message)
    } else {
      ElMessage.error(response.data.message || '标题保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '标题保存失败')
    console.error(error)
  } finally {
    savingRegistrationTitle.value = false
  }
}
```

在 `onMounted` 中增加 `loadRegistrationTitle()`，与既有初始化请求并行执行。

- [ ] **Step 4: 修改 tab 文案并增加标题设置表单**

将：

```vue
<el-tab-pane label="报名设置" name="settings">
```

改为：

```vue
<el-tab-pane label="系统设置" name="settings">
```

在系统设置 tab 内、开放时间 card 之前增加标题 card：

```vue
<el-card>
  <template #header>
    <div class="card-header">
      <span>报名入口标题</span>
    </div>
  </template>
  <el-form label-width="120px" @submit.prevent>
    <el-form-item label="标题">
      <el-input
        v-model="registrationTitleDraft"
        maxlength="30"
        show-word-limit
        clearable
        placeholder="默认：社团报名系统"
      />
    </el-form-item>
    <el-button
      type="primary"
      :loading="savingRegistrationTitle"
      @click="handleSaveRegistrationTitle"
    >
      保存标题
    </el-button>
  </el-form>
</el-card>
```

保留现有开放时间 card、对话框和所有方法不变。

- [ ] **Step 5: 运行后台契约测试并确认通过**

运行：

```bash
corepack pnpm exec vitest run src/views/admin-responsive.test.ts
```

预期：全部测试通过。

### Task 5: 全量验证与实际页面验收

**Files:**
- No additional source files; inspect generated output only.

- [ ] **Step 1: 运行服务端和前端相关定向测试**

运行：

```bash
corepack pnpm exec vitest run server/src/routes/settings.test.ts src/utils/registrationSettings.test.ts src/views/registration-title.test.ts src/views/admin-responsive.test.ts
```

预期：所有标题、系统设置和既有开放时间测试通过。

- [ ] **Step 2: 运行全量测试**

运行：

```bash
corepack pnpm test
```

预期：所有测试文件和测试用例通过，既有社团多选年级功能不回归。

- [ ] **Step 3: 运行类型检查和前端构建**

依次运行：

```bash
npx vue-tsc --noEmit
corepack pnpm run build
```

预期：两个命令退出码均为 0；构建允许保留既有 chunk 体积警告。

- [ ] **Step 4: 进行浏览器验收**

在运行中的开发服务器打开后台，验证：

1. tab 文案为“系统设置”。
2. 标题输入框初始显示“社团报名系统”。
3. 输入“2026 秋季社团报名”并保存后，打开 `/` 和 `/register`，两页都显示该标题，主标题仍为“行知中学”。
4. 清空标题并保存后，刷新 `/` 和 `/register`，两页都恢复显示“社团报名系统”。
5. 报名开放时间功能仍可正常设置和清除。
6. 在 375px 窄屏下，标题输入框和系统设置 card 不出现横向溢出。

- [ ] **Step 5: 检查最终变更范围**

确认只涉及标题设置相关的服务端路由、前端页面/工具、测试和计划/设计文档；不修改二维码 URL、报名校验、数据库表结构或无关页面。

由于当前项目没有 Git 仓库，不执行提交步骤；以测试、类型检查、构建和浏览器验收作为完成依据。
