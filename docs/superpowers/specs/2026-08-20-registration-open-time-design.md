# 报名开放时间设置功能 设计文档

日期：2026-08-20
状态：已确认

## 背景与目标

当前系统中学生可随时提交报名，没有任何时间限制。后台管理需要增加一个功能：设置一个具体的报名开放时间点，在到达该时间点之前，学生端不能提交报名；到达后自动开放。

## 需求要点（已与用户确认）

1. **设置形式**：管理员设置一个具体日期时间（如 `2026-09-01 08:00`）作为全局报名开放时间点
2. **设置粒度**：全局统一设置，所有社团同时开放，不按社团区分
3. **学生端表现**：未开放时报名页显示开放时间 + 倒计时，表单禁用；到点后自动解禁，无需刷新页面
4. **范围**：本次只做开放时间，不做报名截止时间
5. **默认行为**：未设置开放时间时，保持现状——学生随时可报名（无需数据迁移）

## 方案选择

采用 **方案 A：新建通用 `settings` 键值表** 存储设置。

- 优点：通用性强，后续增加其他全局设置（报名截止时间、公告文案等）无需改表结构；与现有三张业务表（clubs / students / registrations）解耦
- 对比：专用单行设置表扩展性差；存入业务表或配置文件语义混乱、运行时改不动

## 架构与组件

### 1. 数据层：新增 `settings` 表

`init.sql` 追加：

```sql
CREATE TABLE IF NOT EXISTS settings (
  `key`   VARCHAR(100) PRIMARY KEY,
  `value` TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- 键名：`registration_open_at`
- 值：ISO 8601 带时区字符串（如 `2026-09-01T08:00:00+08:00`），避免时区歧义
- 记录不存在 = 未设置 = 随时可报名
- 不需要在 `initClubs()` 中预插默认值，读取时缺省返回 null

### 2. 后端：新增路由 `server/src/routes/settings.ts`

挂载到 `/api/settings`（在 `server/index.ts` 中注册）。

| 接口 | 权限 | 行为 |
|---|---|---|
| `GET /api/settings/registration-open-time` | 公开（学生端也要读） | 返回 `{ success: true, data: { openAt: string \| null } }` |
| `PUT /api/settings/registration-open-time` | 管理端 | body `{ openAt: string \| null }`；`null` = 清除限制；非法日期返回 400；用 `INSERT ... ON DUPLICATE KEY UPDATE` 写入 |

### 3. 后端：`RegistrationService.register` 增加开放时间校验

- 在 `withTransaction` 回调的第一步执行（与后续写入同事务），读取 `registration_open_at`
- 若存在且 `new Date(openAt) > new Date()` → 返回 `{ success: false, message: '报名尚未开始，开放时间：YYYY年MM月DD日 HH:mm' }`
- 时间已到或未设置 → 正常放行
- **服务端必须校验**：倒计时只是前端体验，不能作为唯一防线（否则绕过前端直接调 API 即可报名）

### 4. 管理端 `Admin.vue`：新增「报名设置」Tab

在现有 `el-tabs` 中新增第四个 tab-pane「报名设置」：

- **当前状态提示**（el-alert）：
  - 未设置 → `当前未设置报名开放时间，学生可随时报名`
  - 已设置 → `报名将于 2026年09月01日 08:00:00 开放`
- **设置表单**：`el-date-picker`（`type="datetime"`，格式到分钟）+ 「保存设置」按钮 → `PUT` 接口
- **「清除设置」按钮**（带确认框）→ `PUT` `{ openAt: null }`，恢复随时可报
- 保存成功后刷新状态显示

### 5. 学生端 `Register.vue`：未开放提示 + 倒计时

- `onMounted` 时请求 `GET /api/settings/registration-open-time`
- 新增响应式状态 `openAt` 与 `now`（每秒 tick 一次，`onUnmounted` 清理定时器）
- 计算属性 `isOpen = openAt === null || now >= new Date(openAt)`
- 未开放时：
  - 表单上方显示 el-alert：`报名尚未开始，将于 2026年09月01日 08:00 开放`
  - 显示倒计时：`距离报名开始还有 X 天 X 小时 X 分 X 秒`
  - 整个表单禁用：`<el-form :disabled="!isOpen">`，提交按钮同时禁用
- 到点后 `now` 更新触发响应式，表单自动解禁
- 兜底：即使前端异常提交，服务端校验返回「报名尚未开始」，前端展示该错误消息

## 数据流

```
管理端设置: Admin.vue ──PUT /api/settings/registration-open-time──> settings 表
学生端查询: Register.vue ──GET /api/settings/registration-open-time──> settings 表
报名拦截:   Register.vue ──POST /api/register──> RegistrationService.register
            └─ 事务内第 1 步: 读 settings → 未开放则拒绝
```

## 错误处理

- `PUT` 传入无法解析的日期 → 400，消息「开放时间格式不正确」
- `PUT` 传 `openAt: null` → 清除设置（允许任意合法时间，早于当前时间视为已开放，由校验逻辑自然处理）
- 数据库异常 → 沿用现有 500 兜底中间件

## 测试计划

沿用现有 vitest + supertest + `vi.mock` 模式。

- `registrationService.test.ts` 新增用例：
  - 未设置开放时间 → 报名成功
  - 设置了未来时间 → 返回 `success: false`，消息含开放时间文案
  - 开放时间已过 → 报名成功
- 新增 `server/src/routes/settings.test.ts`：
  - `GET` 未设置 → `openAt: null`
  - `GET` 已设置 → 返回存储值
  - `PUT` 合法时间 → 成功写入
  - `PUT` 非法时间 → 400
  - `PUT` null → 清除成功
- `register.test.ts`：现有 mock 结构不需要改动（未开放时由 service 层拦截）

## 验证方式

1. `pnpm test` 跑通全部用例
2. 起 dev server 手动验证：
   - 后台设置 2 分钟后的开放时间 → 学生端显示倒计时且表单禁用
   - 到点自动解禁可提交
   - 清除设置后学生端恢复随时可报

## 不做的事（YAGNI）

- 不做报名截止时间
- 不做按社团分别设置
- 不做多批次/分时段开放
- 不改动 RegisterSuccess.vue、Login.vue、路由