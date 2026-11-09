# 报名成功页设计文档

日期：2026-07-31
状态：待用户确认

## 背景

当前报名流程：报名页提交成功后仅弹「报名成功」提示并重置表单，学生无法确认自己的报名信息（编号、时间等）。需要新增一个报名成功页，展示报名成功的确认信息。

## 需求

1. 报名成功后跳转到独立的成功页，显示：**姓名、班级、社团、报名编号、报名时间、脱敏身份证号**（用户已确认这 4 项内容，不显示社团剩余名额）
2. 成功页提供两个操作按钮：**返回首页**、**继续报名**（用户已确认）
3. 数据来自后端报名接口返回的报名记录详情（编号/时间需后端生成，前端无法自造）

## 方案

### 一、后端：POST /api/register 返回报名记录详情

现有 `RegistrationService.register()` 成功时返回 `{ success: true, message: '报名成功' }`，改造为：

```ts
// 成功时
{
  success: true,
  message: '报名成功',
  data: {
    id: number,          // 报名编号（registrations 表自增主键）
    name: string,        // 姓名
    className: string,   // 班级
    clubId: number,
    clubName: string,    // 社团名称（事务内已 SELECT）
    time: string,        // 报名时间（数据库 created_at，ISO 格式）
  }
}
// 失败时保持 { success: false, message } 不变
```

实现要点（`server/src/services/registrationService.ts`）：
- 事务内 INSERT 后，从 `ResultSetHeader.insertId` 取报名编号
- clubName 复用事务内已查到的 `club.name`（第 91 行 `clubRows[0]`），无需额外查询
- 报名时间：事务内追加一次查询 `SELECT created_at FROM registrations WHERE id = ?`（以数据库时间为准），返回 ISO 字符串
- 接口签名由 `Promise<{ success: boolean; message: string }>` 扩展为成功分支带 `data`；失败分支返回结构不变

路由层（`server/src/routes/register.ts`）无需改动，直接透传 `result`。

**测试更新**（`server/src/routes/register.test.ts`）：
- 用例 1 的 mock 返回值改为带 `data` 的完整结构，断言 `response.body` 等于该结构（TDD：先改断言→跑红→改服务→跑绿）
- 用例 2（学生不存在 400）不受影响

### 二、前端：报名成功页

#### 路由（`src/router/index.ts`）

```ts
{
  path: '/register/success',
  name: 'RegisterSuccess',
  component: () => import('../views/RegisterSuccess.vue')
}
```

#### 数据传递（`src/views/Register.vue` handleSubmit 成功分支）

用 vue-router 的 history state 传递（不用 query，避免身份证号暴露在 URL）：

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
      idCard: form.value.idCard,  // 仅前端展示脱敏用，不写入 URL
    },
  })
}
```

现状成功分支的 `ElMessage.success('报名成功')` 与表单重置移除（新页面天然独立，返回「继续报名」时是新实例、表单为空）。

#### 成功页组件（新增 `src/views/RegisterSuccess.vue`）

- **风格一致**：沿用其他页面的「行知中学」主标题 + 「社团报名」副标题 + 居中卡片布局（font-size: 28px / font-weight: 700 / 颜色 #409EFF 主标题，副标题 #909399）
- **成功标识**：`el-result icon="success"` 或等价的大号 ✓ 图标 + 「报名成功」标题
- **信息列表**（el-descriptions 或样式化列表）：
  | 字段 | 值 |
  |---|---|
  | 报名编号 | `#00012`（data.id） |
  | 姓名 | data.name |
  | 班级 | data.className |
  | 社团 | data.clubName |
  | 报名时间 | data.time 格式化为 `YYYY-MM-DD HH:mm:ss` |
  | 身份证号 | 脱敏：前 4 位 + `********` + 后 4 位（如 `3301**********1234`） |
- **按钮**：返回首页（primary，`router.push('/')`）、继续报名（default，`router.push('/register')`）
- **兜底状态**：`history.state` 无数据（直接访问 URL / 刷新后丢失）时，显示提示「报名信息不存在，请从报名页重新提交」+ 返回首页按钮，不渲染空白信息卡

#### 脱敏工具

`maskIdCard` 放组件内或 `src/utils`（简单函数，直接放组件内即可，避免过度设计）：
```ts
function maskIdCard(idCard: string): string {
  return idCard.length >= 8
    ? idCard.slice(0, 4) + '********' + idCard.slice(-4)
    : idCard
}
```

### 三、不修改的部分

- Admin / Stats 页（后台管理已有完整记录列表，无需联动）
- 报名页身份证自动带出逻辑（上一功能）
- 社团名额扣减逻辑

## 验证方案

1. **后端单测**：`register.test.ts` 更新断言，`pnpm test` 全量通过（14 + 更新后仍应全绿）
2. **构建**：`pnpm run build` 通过（vue-tsc 类型检查）
3. **浏览器验证**：
   - 正常路径：报名提交成功 → 跳转成功页 → 展示 6 项信息 → 返回首页 / 继续报名可用（依赖 MySQL 可用）
   - 兜底路径：直接访问 `/register/success`（无 state）→ 显示兜底提示
   - 脱敏格式：身份证号显示为 `3301**********1234` 格式
   - 若本地 MySQL 仍不可用：通过 playwright 注入 history state 后访问成功页，验证渲染与按钮交互；后端返回结构由单测覆盖
4. **回归**：报名页身份证自动查询、提交校验不受影响

## 风险

- `history.state` 刷新丢失 → 兜底提示已覆盖该场景（可接受：成功页仅作即时确认，不承担持久凭证职能；后台管理列表是持久记录来源）
- 后端返回结构变化：`register.test.ts` 断言需同步更新，前端 axios 处理需容错 `data` 缺失（保险分支）
