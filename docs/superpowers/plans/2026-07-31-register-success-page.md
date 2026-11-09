# 实施计划：报名成功页

日期：2026-07-31
设计文档：`docs/superpowers/specs/2026-07-31-register-success-page-design.md`
执行方式：子代理驱动（每任务：implementer → spec 审查 → 质量审查）

## Goal

报名提交成功后跳转 `/register/success` 成功页，展示报名编号、姓名、班级、社团、报名时间、脱敏身份证号，提供「返回首页 / 继续报名」按钮；直接访问或刷新（history.state 丢失）时显示兜底提示。

## Changes

### Task 1：后端 register 返回报名详情（TDD）

**文件 1：`server/src/routes/register.test.ts`**（先改断言，跑红）

- 用例 1 mock 改为：
```ts
vi.mocked(service.RegistrationService.register).mockResolvedValue({
  success: true,
  message: '报名成功',
  data: {
    id: 12,
    name: '张三',
    className: '高一(1)班',
    clubId: 1,
    clubName: '篮球社',
    time: '2026-07-31T12:00:00.000Z',
  },
});
```
- 用例 1 断言改为：
```ts
expect(response.body).toEqual({
  success: true,
  message: '报名成功',
  data: {
    id: 12,
    name: '张三',
    className: '高一(1)班',
    clubId: 1,
    clubName: '篮球社',
    time: '2026-07-31T12:00:00.000Z',
  },
});
```
- 用例 2（400 学生不存在）断言不变

**文件 2：`server/src/services/registrationService.ts`**

- `register` 返回类型改为：
```ts
interface RegistrationResult {
  success: boolean;
  message: string;
  data?: {
    id: number;
    name: string;
    className: string;
    clubId: number;
    clubName: string;
    time: string;
  };
}
static async register(data: RegistrationData): Promise<RegistrationResult>
```
- 事务内 INSERT 拿 insertId：
```ts
const [insertResult] = await connection.execute<ResultSetHeader>(
  `INSERT INTO registrations (name, id_card_hash, class_name, club_id)
   VALUES (?, ?, ?, ?)`,
  [data.name, idCardHash, data.className, data.clubId]
);
```
- UPDATE 名额后追加查时间并返回：
```ts
const [createdRows] = await connection.execute<RowDataPacket[]>(
  'SELECT created_at FROM registrations WHERE id = ?',
  [insertResult.insertId]
);

return {
  success: true,
  message: '报名成功',
  data: {
    id: insertResult.insertId,
    name: data.name,
    className: data.className,
    clubId: data.clubId,
    clubName: club.name,
    time: (createdRows[0]?.created_at ?? new Date()).toISOString(),
  },
};
```
- 失败分支（重复/不存在/名额已满）返回结构不变

**验证：**
1. `corepack pnpm test server/src/routes/register.test.ts` → 先红（新断言失败）后绿
2. `corepack pnpm test` → 全量通过

### Task 2：前端成功页 + 路由 + 跳转

**文件 1：`src/router/index.ts`** — routes 数组新增：
```ts
{
  path: '/register/success',
  name: 'RegisterSuccess',
  component: () => import('../views/RegisterSuccess.vue')
},
```

**文件 2：`src/views/RegisterSuccess.vue`** — 新增组件，要点：
- `<script setup lang="ts">`：从 `history.state` 读报名数据（vue-router push 写入）
- `maskIdCard`：`idCard.slice(0, 4) + '********' + idCard.slice(-4)`（长度 <8 原样返回）
- 时间格式化：`new Date(state.time)` → `YYYY-MM-DD HH:mm:ss`（本地时区，手写 padStart，不引库）
- 无数据兜底：`v-if="success"` 双分支——有数据渲染信息卡；无数据渲染「报名信息不存在，请从报名页重新提交」+ 返回首页
- 布局沿用站点风格：渐变背景容器（linear-gradient 135deg #667eea → #764ba2）、白色圆角卡片（max-width 500px、padding 40px、radius 16px、shadow）、`行知中学` h1（28px/700/#303133 居中）+ `社团报名` 副标题（16px/#909399）
- 成功标识：`el-result icon="success" title="报名成功"`（Element Plus 已全局注册）
- 信息列表：`el-descriptions :column="1" border`，6 项：报名编号 `#${id}`、姓名、班级、社团、报名时间、身份证号（脱敏）
- 按钮区：`返回首页`（primary，`router.push('/')`）+ `继续报名`（default，`router.push('/register')`）
- 兜底分支：`el-result icon="warning"` + 提示文字 + `返回首页` 按钮

**文件 3：`src/views/Register.vue`** — `handleSubmit` 成功分支替换：
```ts
if (response.data.success && response.data.data) {
  const data = response.data.data
  router.push({
    path: '/register/success',
    state: {
      id: data.id,
      name: data.name,
      className: data.className,
      clubName: data.clubName,
      time: data.time,
      idCard: form.value.idCard,
    },
  })
} else if (response.data.success) {
  // 兼容：成功但无详情数据（后端旧结构）
  ElMessage.success(response.data.message)
} else {
  ElMessage.error(response.data.message)
}
```
- 移除原「重置表单 + lastQueriedCard 清空 + loadClubs 刷新」块（成功页独立路由，无需重置；但注意：成功页「继续报名」返回的是新实例，表单本就为空——**需保留** `await loadClubs()` 吗？原逻辑刷新剩余名额，新实例 onMounted 已加载，故无需保留）
- 移除后 `ElMessage` 仍需保留（错误分支用）

**验证：**
1. `corepack pnpm run build` → 通过（vue-tsc）
2. 浏览器：`/register/success` 直接访问 → 兜底提示；注入 history.state 后刷新/导航 → 6 项信息渲染、脱敏格式、按钮跳转

### Task 3：回归验证

1. `corepack pnpm test` → 全量通过（14 个以上）
2. `corepack pnpm run build` → 通过
3. 浏览器全链路（MySQL 可用时）：报名 → 跳转成功页 → 6 项信息 → 返回首页/继续报名；不可用时：注入 state 验证成功页渲染 + 报名页回归（身份证自动带出、提交拦截）
4. 检查 Admin 后台报名列表不受影响（`getAllRegistrations` 未改动）

## 纪律

- 每个 Task 实现完成后：spec 合规审查 → 代码质量审查（子代理，独立验证）
- 发现问题用原 implementer 的 task_id 修复后复审
- 非 git 仓库，无 commit 步骤
