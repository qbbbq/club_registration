# 页面增加「行知中学」标题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在全部 5 个页面（Home/Register/Login/Admin/Stats）将「行知中学」作为主标题，原业务标题降为副标题。

**Architecture:** 纯前端模板与样式修改，不涉及路由、后端、接口与测试逻辑。每个页面统一模式：主标题 h1/h2（28px 或 24px 加粗深色）+ 副标题（16px 灰色）。居中卡片布局（Home/Register/Login）上下排列；顶部条布局（Admin/Stats）水平并排。

**Tech Stack:** Vue 3 SFC（script setup + scoped style）、Element Plus。

**注意：** 本目录不是 git 仓库（`git status` 报 no repository），所有任务中的 commit 步骤一律跳过并在计划中记录。

---

### Task 1: Home.vue 标题改造

**Files:**
- Modify: `src/views/Home.vue`（template 第 33-35 行附近；style 第 57-66 行附近）

- [ ] **Step 1: 修改模板**

将：

```html
    <div class="qrcode-card">
      <h1>社团报名系统</h1>
      <p class="tip">请扫描下方二维码进入报名</p>
```

替换为：

```html
    <div class="qrcode-card">
      <h1>行知中学</h1>
      <p class="subtitle">社团报名系统</p>
      <p class="tip">请扫描下方二维码进入报名</p>
```

- [ ] **Step 2: 修改样式**

将：

```css
.qrcode-card h1 {
  margin: 0 0 10px 0;
  color: #303133;
  font-size: 28px;
}

.tip {
  color: #606266;
  font-size: 16px;
  margin-bottom: 30px;
}
```

替换为：

```css
.qrcode-card h1 {
  margin: 0 0 6px 0;
  color: #303133;
  font-size: 28px;
}

.subtitle {
  color: #606266;
  font-size: 16px;
  margin: 0 0 30px 0;
}

.tip {
  color: #909399;
  font-size: 14px;
  margin-bottom: 20px;
}
```

- [ ] **Step 3: 提交（跳过）**

Run: `git status`
Expected: 非 git 仓库（`fatal: not a git repository`），跳过 commit 并记录。

---

### Task 2: Register.vue 标题改造

**Files:**
- Modify: `src/views/Register.vue`（template 第 103-105 行附近；style 第 190-196 行附近）

- [ ] **Step 1: 修改模板**

将：

```html
    <div class="register-card">
      <h1>社团报名</h1>
```

替换为：

```html
    <div class="register-card">
      <h1>行知中学</h1>
      <p class="subtitle">社团报名</p>
```

- [ ] **Step 2: 修改样式**

将：

```css
.register-card h1 {
  text-align: center;
  margin: 0 0 30px 0;
  color: #303133;
  font-size: 28px;
}
```

替换为：

```css
.register-card h1 {
  text-align: center;
  margin: 0 0 6px 0;
  color: #303133;
  font-size: 28px;
}

.register-card .subtitle {
  text-align: center;
  margin: 0 0 30px 0;
  color: #909399;
  font-size: 16px;
}
```

- [ ] **Step 3: 提交（跳过）**

Run: `git status`
Expected: 非 git 仓库，跳过 commit 并记录。

---

### Task 3: Login.vue 标题改造

**Files:**
- Modify: `src/views/Login.vue`（template 第 42-46 行附近；style 第 108-119 行附近）

- [ ] **Step 1: 修改模板**

将：

```html
    <div class="login-card">
      <h2>后台管理系统</h2>
      <p class="login-tip">请输入管理员账号密码登录</p>
```

替换为：

```html
    <div class="login-card">
      <h2>行知中学</h2>
      <p class="subtitle">后台管理系统</p>
      <p class="login-tip">请输入管理员账号密码登录</p>
```

- [ ] **Step 2: 修改样式**

将：

```css
.login-card h2 {
  text-align: center;
  margin: 0 0 10px 0;
  color: #303133;
}
```

替换为：

```css
.login-card h2 {
  text-align: center;
  margin: 0 0 6px 0;
  color: #303133;
}

.login-card .subtitle {
  text-align: center;
  margin: 0 0 10px 0;
  color: #909399;
}
```

- [ ] **Step 3: 提交（跳过）**

Run: `git status`
Expected: 非 git 仓库，跳过 commit 并记录。

---

### Task 4: Admin.vue 标题改造

**Files:**
- Modify: `src/views/Admin.vue`（template 第 328-333 行附近；style 第 600-604 行附近）

- [ ] **Step 1: 修改模板**

将：

```html
      <div class="header-left">
        <el-button @click="goHome" :icon="'ArrowLeft'">返回首页</el-button>
        <h1>社团管理后台</h1>
      </div>
```

替换为：

```html
      <div class="header-left">
        <el-button @click="goHome" :icon="'ArrowLeft'">返回首页</el-button>
        <h1>行知中学</h1>
        <span class="subtitle">社团管理后台</span>
      </div>
```

- [ ] **Step 2: 修改样式**

将：

```css
.header-left {
  display: flex;
  align-items: center;
  gap: 20px;
}

.header-left h1 {
  margin: 0;
  color: #303133;
  font-size: 24px;
}
```

替换为：

```css
.header-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.header-left h1 {
  margin: 0;
  color: #303133;
  font-size: 24px;
}

.header-left .subtitle {
  color: #909399;
  font-size: 16px;
}
```

- [ ] **Step 3: 提交（跳过）**

Run: `git status`
Expected: 非 git 仓库，跳过 commit 并记录。

---

### Task 5: Stats.vue 标题改造

**Files:**
- Modify: `src/views/Stats.vue`（template 第 42-48 行附近；style 第 96-100 行附近）

- [ ] **Step 1: 修改模板**

将：

```html
    <div class="header">
      <el-button @click="goBack" :icon="'ArrowLeft'">返回</el-button>
      <h1>社团名额统计</h1>
      <el-button type="primary" @click="loadStats" :loading="loading" :icon="'Refresh'">
        刷新
      </el-button>
    </div>
```

替换为：

```html
    <div class="header">
      <el-button @click="goBack" :icon="'ArrowLeft'">返回</el-button>
      <div class="header-title">
        <h1>行知中学</h1>
        <span class="subtitle">社团名额统计</span>
      </div>
      <el-button type="primary" @click="loadStats" :loading="loading" :icon="'Refresh'">
        刷新
      </el-button>
    </div>
```

- [ ] **Step 2: 修改样式**

将：

```css
.header h1 {
  margin: 0;
  color: #303133;
  font-size: 24px;
}
```

替换为：

```css
.header-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.header h1 {
  margin: 0;
  color: #303133;
  font-size: 24px;
}

.header .subtitle {
  color: #909399;
  font-size: 16px;
}
```

- [ ] **Step 3: 提交（跳过）**

Run: `git status`
Expected: 非 git 仓库，跳过 commit 并记录。

---

### Task 6: 回归验证

**Files:**
- Verify: 全部 5 个改动文件 + 现有测试

- [ ] **Step 1: 运行现有测试**

Run: `pnpm test`
Expected: 全部通过（标题改动不影响任何测试：`RegistrationService MySQL behavior`、`register route`、`clubs route`、`students route`、`mysql-client`、`getRawFile`）。

- [ ] **Step 2: 类型检查与生产构建**

Run: `pnpm run build`
Expected: `vue-tsc -b && vite build` 退出码 0，dist 生成成功。

- [ ] **Step 3: 浏览器视觉验证**

Run: `pnpm run dev:client`（仅前端，端口 5000；后端未启动时 /api 请求会失败，不影响标题显示验证）

用浏览器依次打开以下路由，确认主标题「行知中学」+ 副标题正确显示、层级清晰、无样式错乱：

1. `http://localhost:5000/` → 卡片内：行知中学（大）→ 社团报名系统（副标题）→ 请扫描下方二维码进入报名
2. `http://localhost:5000/register` → 行知中学 → 社团报名
3. `http://localhost:5000/login` → 行知中学 → 后台管理系统
4. `http://localhost:5000/admin`（若被路由守卫重定向到 /login，先执行登录：在浏览器 console 运行 `sessionStorage.setItem('isLoggedIn', 'true')` 后刷新）→ 顶部：返回首页 | 行知中学 社团管理后台（并排，基线对齐）
5. `http://localhost:5000/admin/stats` → 返回 | 行知中学 社团名额统计 | 刷新

Expected: 每个页面主/副标题内容与层级正确，无布局错乱。
