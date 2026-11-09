# 报名页身份证自动带出学生信息设计

## 背景

当前报名页（`/register`）需要学生手动填写姓名、身份证号、班级、社团四项。班级字段即使手动填写，后端也以 `students` 表中的记录为准。用户希望：只输入身份证号，自动带出姓名和班级，且姓名/班级以只读标签展示，数据来源为后台导入的学生数据表（`students`）。

## 目标

1. 报名页身份证号输满 18 位后自动查询学生信息。
2. 姓名、班级改为只读标签框显示，由查询结果自动带出。
3. 数据来源为 `students` 表（后台学生导入功能维护）。
4. 查询不到学生时拦截并提示，不允许提交。

## 非目标

1. 不改动管理员登录页（`/login`）与后台逻辑。
2. 不改变报名提交接口（`POST /api/register`）及其白名单校验逻辑。
3. 不新增"学生自助登记"能力（学生仍须由管理员导入）。
4. 不引入防抖实时查询、扫码等复杂交互。

## 后端设计

### 新增接口

`POST /api/students/lookup`（body: `{ "idCard": "..." }`）

采用 POST + body 传递身份证号，避免敏感信息出现在 URL/访问日志中；风格与现有 `POST /api/students/verify` 一致。

- 查询：`SELECT name, class_name FROM students WHERE id_card = ? LIMIT 1`
- 成功且有记录：
  ```json
  { "success": true, "data": { "name": "张三", "className": "高一(1)班" } }
  ```
- 成功但无记录：
  ```json
  { "success": true, "data": null, "message": "学生信息不存在，请联系管理员导入" }
  ```
- 参数非法（idCard 缺失或非 18 位身份证格式）：返回 `{ "success": false, "message": "身份证号格式不正确" }`（400）
- 异常：500 + `{ success: false, message }`

文件：`server/src/routes/students.ts`（在现有 verify 接口附近新增）

### 测试

新增 `server/src/routes/students.test.ts` 用例（沿用现有 mock `mysql-client` + supertest 模式）：

1. 按身份证查询返回姓名与班级（校验请求体与 SQL 参数）
2. 查无记录返回 `data: null` 与提示
3. 非法身份证格式返回 400

## 前端设计

文件：`src/views/Register.vue`

### 表单结构（顺序调整）

| 字段 | 控件 | 行为 |
|---|---|---|
| 身份证号 | `el-input`（maxlength 18） | 输满 18 位且正则合法 → 自动查询；不足 18 位 → 清空姓名/班级并禁止提交 |
| 姓名 | `el-tag`（只读标签） | 查询成功自动显示 |
| 班级 | `el-tag`（只读标签） | 查询成功自动显示 |
| 社团 | `el-select`（不变） | 名额逻辑不变 |

### 交互细节

- 查询触发：`@input` 事件中判断 `form.idCard` 满 18 位且匹配 `/^\d{17}[\dXx]$/`，调用 `POST /api/students/lookup`（body: `{ idCard }`）
- 查询防重：`fetching` 状态位 + 记录已查询号码（`lastQueriedCard`），避免重复请求
- 查询中：身份证输入框 `loading` 属性展示
- 查询成功：`form.name` / `form.className` 填入带出值，标签显示
- 查无：`ElMessage.warning('学生信息不存在，请联系管理员导入')`，清空姓名/班级，提交按钮禁用
- 身份证号修改后（不再等于已查询号码）：清空姓名/班级与已查询标记，提交按钮禁用
- 提交：`handleSubmit` 保持校验（姓名/班级来自带出值），点击提交时若姓名/班级为空则拦截提示「请先输入身份证号查询学生信息」
- 提交成功：重置表单（含姓名/班级/已查询标记）

### 样式

- `el-tag` 尺寸 `large`，与输入框高度协调；宽度与 `el-input` 一致（`width: 100%` 容器内靠左显示）

## 错误处理

1. 网络异常：`ElMessage.error('查询失败')`，不清空已带出信息（若之前已带出）
2. 查询中再次输入：以最新输入为准（防重逻辑保证不会并发多次请求）
3. 提交时后端仍会二次校验（`POST /api/register` 白名单逻辑不变），前端拦截仅为体验层

## 验证

1. `pnpm test`：新增的 students 路由用例通过，既有用例不回归
2. `pnpm run build`：类型检查与构建通过
3. 浏览器验证（需启动后端 + MySQL）：
   - 导入一名学生后，报名页输入其身份证号 → 自动带出姓名/班级标签
   - 输入未导入的身份证号 → 提示不存在且无法提交
   - 修改身份证号 → 姓名/班级清空、无法提交
   - 正常提交 → 成功且后端名额扣减
