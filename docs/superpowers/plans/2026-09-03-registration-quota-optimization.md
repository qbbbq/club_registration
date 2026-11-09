# 报名事务名额扣减优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变同步报名接口和现有响应消息的前提下，使用 MySQL 条件原子扣减和满额预检查降低同一社团并发报名的锁等待。

**Architecture:** 报名路由继续负责请求格式和学生身份校验。`RegistrationService.register` 先在事务外读取开放时间和社团名额，已满时立即返回；有名额时在事务内执行 `remaining_quota > 0` 条件更新，再插入报名记录。重复索引冲突和其他异常都通过现有事务机制回滚。

**Tech Stack:** TypeScript、Express、`mysql2/promise`、MySQL InnoDB、Vitest、Supertest、Vite。

---

## 文件边界

- 修改：`server/src/services/registrationService.ts`
  - 移出开放时间查询和社团预检查事务。
  - 移除社团行锁读取。
  - 添加条件原子扣减和重复报名回滚映射。
- 修改：`server/src/services/registrationService.test.ts`
  - 覆盖预检查满额、原子扣减竞态、成功、重复回滚和数据库异常。
- 修改：`server/src/storage/database/mysql-client.test.ts`
  - 补充事务回调抛错时回滚的行为测试，确保重复报名哨兵异常能恢复名额。
- 不修改：`server/src/routes/register.ts`、前端、数据库 schema、连接池配置、PM2 配置和 Nginx 配置。

## Task 1：先写新的服务层失败测试

**Files:**
- Test: `server/src/services/registrationService.test.ts`

- [x] **Step 1：新增预检查满额测试**

在 `describe('RegistrationService MySQL behavior', ...)` 中加入以下测试。该测试要求 settings 和 clubs 通过 `query` 返回，且满额时不调用 `withTransaction`：

```ts
it('returns full immediately when the non-locking club precheck finds no quota', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  const query = vi.mocked(mysqlClient.query);
  const withTransaction = vi.mocked(mysqlClient.withTransaction);
  query
    .mockResolvedValueOnce([] as any)
    .mockResolvedValueOnce([{
      id: 1,
      name: '编程社',
      total_quota: 50,
      remaining_quota: 0,
    }] as any);

  const { RegistrationService } = await import('./registrationService');
  const result = await RegistrationService.register({
    name: '张三',
    idCard: '123456789012345678',
    className: '高一(1)班',
    clubId: 1,
  });

  expect(result).toEqual({ success: false, message: '该社团名额已满' });
  expect(withTransaction).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledTimes(2);
});
```

- [x] **Step 2：新增原子扣减竞态测试**

加入以下测试，模拟预检查看到名额但事务开始时名额已经被其他请求拿走：

```ts
it('returns full without inserting when the atomic quota update affects no rows', async () => {
  const mysqlClient = await import('../storage/database/mysql-client');
  const query = vi.mocked(mysqlClient.query);
  const withTransaction = vi.mocked(mysqlClient.withTransaction);
  const execute = vi.fn().mockResolvedValueOnce([{ affectedRows: 0 }]);
  query
    .mockResolvedValueOnce([] as any)
    .mockResolvedValueOnce([{
      id: 1,
      name: '编程社',
      total_quota: 50,
      remaining_quota: 1,
    }] as any);
  withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

  const { RegistrationService } = await import('./registrationService');
  const result = await RegistrationService.register({
    name: '张三',
    idCard: '123456789012345678',
    className: '高一(1)班',
    clubId: 1,
  });

  expect(result).toEqual({ success: false, message: '该社团名额已满' });
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0][0]).toContain('remaining_quota > 0');
  expect(execute.mock.calls[0][0]).not.toContain('FOR UPDATE');
});
```

- [x] **Step 3：运行新增测试，确认当前实现失败**

运行：

```text
corepack pnpm exec vitest run server/src/services/registrationService.test.ts
```

预期：失败，因为当前实现把 settings 和社团读取放在事务连接上，并且使用 `SELECT ... FOR UPDATE`，不会执行新的事务外预检查路径。

## Task 2：调整成功、重复和开放时间测试的调用顺序

**Files:**
- Test: `server/src/services/registrationService.test.ts`

- [x] **Step 1：将成功测试的 mock 顺序改为事务外 query + 事务内 execute**

成功测试的固定 mock 顺序必须改成下面的结构：

```ts
query
  .mockResolvedValueOnce([] as any)
  .mockResolvedValueOnce([{
    id: 1,
    name: '编程社',
    total_quota: 50,
    remaining_quota: 2,
  }] as any);

const execute = vi.fn()
  .mockResolvedValueOnce([{ affectedRows: 1 }])
  .mockResolvedValueOnce([{ affectedRows: 1, insertId: 10 }])
  .mockResolvedValueOnce([[{ created_at: new Date('2026-07-31T12:00:00.000Z') }]]);
withTransaction.mockImplementation(async (callback) => callback({ execute } as any));
```

测试断言改为：`query` 被调用两次；`withTransaction` 被调用一次；事务第一次 execute 是包含 `remaining_quota = remaining_quota - 1` 和 `remaining_quota > 0` 的 `UPDATE`；不再断言社团查询包含 `FOR UPDATE`。

- [x] **Step 2：将重复报名测试改为验证原子扣减后的回滚映射**

使用以下 mock 顺序：

```ts
query
  .mockResolvedValueOnce([] as any)
  .mockResolvedValueOnce([{
    id: 1,
    name: '编程社',
    total_quota: 50,
    remaining_quota: 2,
  }] as any);

const execute = vi.fn()
  .mockResolvedValueOnce([{ affectedRows: 1 }])
  .mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' });
withTransaction.mockImplementation(async (callback) => callback({ execute } as any));
```

断言结果仍为 `{ success: false, message: '该身份证号已报名过社团' }`，并断言没有执行创建时间查询。重复错误必须从事务回调抛出后再由 service 转换，不能在回调内直接返回，否则事务会提交已经扣除的名额。

- [x] **Step 3：更新开放时间测试**

未来开放时间通过 `query` 返回，并断言事务不会创建：

```ts
query.mockResolvedValueOnce([{ value: '2099-01-01T08:00:00+08:00' }] as any);

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
expect(withTransaction).not.toHaveBeenCalled();
```

已开放测试沿用成功路径的 query 和 execute 顺序，并保留原有成功响应断言。

## Task 3：实现事务外预检查和条件扣减

**Files:**
- Modify: `server/src/services/registrationService.ts:58-139`

- [x] **Step 1：添加内部重复异常哨兵类型**

在 `RegistrationService` 类之前添加：

```ts
class DuplicateRegistrationError extends Error {
  constructor() {
    super('Duplicate registration');
    this.name = 'DuplicateRegistrationError';
  }
}
```

- [x] **Step 2：将开放时间和社团预查询移到事务外**

在 `register` 中保留现有 hash 计算，然后使用带 `signal` 的 `query`：

```ts
const settingRows = await query<RowDataPacket[]>(
  'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
  ['registration_open_at'],
  signal
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

const clubRows = await query<ClubRow[]>(
  'SELECT id, name, total_quota, remaining_quota FROM clubs WHERE id = ? LIMIT 1',
  [data.clubId],
  signal
);

if (clubRows.length === 0) {
  return { success: false, message: '社团不存在' };
}

const club = clubRows[0];
if (club.remaining_quota <= 0) {
  return { success: false, message: '该社团名额已满' };
}
```

- [x] **Step 3：将事务改为条件原子扣减后插入**

用下面的事务主体替换现有 settings 查询、社团 `FOR UPDATE` 查询、插入前判断和单独扣减逻辑：

```ts
try {
  return await withTransaction(async (connection) => {
    const [quotaResult] = await connection.execute<ResultSetHeader>(
      `UPDATE clubs
       SET remaining_quota = remaining_quota - 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND remaining_quota > 0`,
      [data.clubId]
    );

    if (quotaResult.affectedRows === 0) {
      return { success: false, message: '该社团名额已满' };
    }

    let insertResult: ResultSetHeader;
    try {
      [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO registrations (name, id_card_hash, class_name, club_id)
         VALUES (?, ?, ?, ?)`,
        [data.name, idCardHash, data.className, data.clubId]
      );
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new DuplicateRegistrationError();
      }
      throw error;
    }

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
  }, signal);
} catch (error) {
  if (error instanceof DuplicateRegistrationError) {
    return { success: false, message: '该身份证号已报名过社团' };
  }
  throw error;
}
```

`affectedRows = 0` 的事务没有写入，允许 `withTransaction` 正常提交无变化结果；重复异常必须抛出，使 `withTransaction` 回滚原子扣减。不要添加手工 `remaining_quota + 1` 补偿 SQL。

- [x] **Step 4：运行服务层测试并确认通过**

运行：

```text
corepack pnpm exec vitest run server/src/services/registrationService.test.ts
```

预期：该测试文件全部通过，且测试中不存在报名社团的 `SELECT ... FOR UPDATE` 查询断言。

## Task 4：补充事务回滚行为测试

**Files:**
- Test: `server/src/storage/database/mysql-client.test.ts`

- [x] **Step 1：添加回调异常时回滚的测试**

在现有 `mysql-client` 测试中加入一个独立用例，验证事务基础设施对回调异常能够回滚：

```ts
it('rolls back and releases the connection when transaction work throws', async () => {
  vi.stubEnv('MYSQL_HOST', 'localhost');
  vi.stubEnv('MYSQL_USER', 'root');
  vi.stubEnv('MYSQL_DATABASE', 'club_registration');
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    destroy: vi.fn(),
  };
  createPoolMock.mockReset();
  createPoolMock.mockReturnValue({
    getConnection: vi.fn().mockResolvedValue(connection),
  });

  const { withTransaction } = await import('./mysql-client');
  await expect(withTransaction(async () => {
    throw new Error('quota insert failed');
  })).rejects.toThrow('quota insert failed');

  expect(connection.beginTransaction).toHaveBeenCalledOnce();
  expect(connection.rollback).toHaveBeenCalledOnce();
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledOnce();
});
```

- [x] **Step 2：运行事务和服务层测试**

运行：

```text
corepack pnpm exec vitest run server/src/services/registrationService.test.ts server/src/storage/database/mysql-client.test.ts
```

预期：两个测试文件全部通过。

## Task 5：执行完整验证

**Files:**
- 无其他文件。

- [x] **Step 1：运行全部单元测试**

运行：

```text
corepack pnpm test
```

预期：Vitest 退出码为 0，所有测试文件和测试用例通过。

- [x] **Step 2：构建后端**

运行：

```text
corepack pnpm run build:server
```

预期：TypeScript 编译成功，生成 `dist-server/index.js`，退出码为 0。

- [x] **Step 3：构建前端**

运行：

```text
corepack pnpm run build
```

预期：`vue-tsc` 和 Vite 构建成功，退出码为 0；前端接口调用无需改动。

- [x] **Step 4：检查变更边界**

确认最终变更只涉及 `registrationService.ts`、对应测试和事务回滚测试；不生成数据库迁移，不修改路由请求/响应，不修改 PM2、Nginx 或前端文件。本工作区不是 Git 仓库，因此不执行 commit。

## Task 6：部署后的受控验收

- [ ] **Step 1：部署编译后的后端并重启 PM2**

在服务器项目目录运行已配置的构建和 PM2 发布流程，确保 PM2 使用 `dist-server/index.js` 而不是未编译的 `tsx` 入口。

- [ ] **Step 2：执行低风险功能检查**

依次验证一个正常报名、同一身份证重复报名和一个已满社团请求；确认响应消息不变，重复报名不减少名额。

- [ ] **Step 3：执行受控压力测试**

使用固定 Keep-Alive 连接池，不使用单机 1000 条新 TLS 连接。测试数据必须与线上现有报名记录隔离或可按请求批次单独清理，不得调用清空全部报名接口删除真实报名。

- [ ] **Step 4：验证数据库不变量**

压力测试后核对：成功报名数不超过目标社团总名额；`remaining_quota >= 0`；报名记录数与名额扣减一致；重复报名和数据库异常没有消耗名额；满额请求没有 HTTP 5xx。

## 回滚方式

本次没有数据库迁移。若发布后出现异常，恢复上一版 `dist-server` 并重启 PM2 即可；不要通过清空线上全部报名记录来回滚业务数据。
