# MySQL 完全替换 Supabase 设计

## 背景

当前项目是 Vue 3 + Express + Supabase 的社团报名系统。后端通过 `@supabase/supabase-js` 访问 `clubs`、`students`、`registrations` 等表。用户确认目标是：完全移除 Supabase，改为 MySQL。

## 目标

1. 前端页面和 API 路径尽量保持不变。
2. 后端数据库访问从 Supabase Client 改为 MySQL。
3. 使用 MySQL 事务处理报名，避免重复报名和名额超卖。
4. 用环境变量配置 MySQL 连接。
5. 保留现有业务能力：社团管理、学生导入、报名、统计、导出、清空数据。

## 非目标

1. 不新增复杂后台权限系统。
2. 不重构前端页面结构。
3. 不引入 Prisma 或完整 ORM。
4. 不做 Supabase 与 MySQL 双写或可切换适配。

## 推荐方案

采用 `mysql2/promise` 作为 MySQL 访问层。

理由：

- 项目规模较小，直接 SQL 更清晰。
- 报名流程需要事务和行锁，原生 SQL 更直接。
- 改动范围可控，不需要引入重型 ORM。

## 新增和调整的后端结构

新增：

```text
server/src/storage/database/mysql-client.ts
server/src/storage/database/init.sql
```

替换或删除：

```text
server/src/storage/database/supabase-client.ts
src/storage/database/shared/schema.ts 中的 PostgreSQL Drizzle schema 不再作为运行依据
```

主要改造文件：

```text
server/index.ts
server/src/routes/register.ts
server/src/routes/clubs.ts
server/src/routes/students.ts
server/src/routes/registrations.ts
server/src/routes/stats.ts
server/src/routes/export.ts
server/src/services/registrationService.ts
package.json
```

## 环境变量

新增 MySQL 配置：

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=club_registration
```

移除运行时对以下变量的依赖：

```env
COZE_SUPABASE_URL
COZE_SUPABASE_ANON_KEY
```

## 数据表设计

### clubs

```sql
CREATE TABLE clubs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  total_quota INT NOT NULL DEFAULT 50,
  remaining_quota INT NOT NULL DEFAULT 50,
  manager VARCHAR(50),
  manager_contact VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX clubs_name_idx (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### students

```sql
CREATE TABLE students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  id_card VARCHAR(18) NOT NULL UNIQUE,
  class_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX students_name_idx (name),
  INDEX students_id_card_idx (id_card)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### registrations

```sql
CREATE TABLE registrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  id_card_hash CHAR(64) NOT NULL UNIQUE,
  class_name VARCHAR(100) NOT NULL,
  club_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX registrations_club_id_idx (club_id),
  CONSTRAINT registrations_club_fk FOREIGN KEY (club_id) REFERENCES clubs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## MySQL 连接层设计

`mysql-client.ts` 提供：

- `getPool()`：返回单例连接池。
- `query()`：执行普通 SQL。
- `withTransaction()`：封装事务，自动 commit / rollback。

连接池使用 `mysql2/promise` 创建。

## 报名流程设计

报名接口仍为：

```text
POST /api/register
```

事务流程：

```text
开始事务
 -> 查询 students，校验 idCard + name 是否存在
 -> 查询 registrations，按 id_card_hash 检查是否已报名
 -> SELECT clubs ... FOR UPDATE 锁定社团行
 -> 检查 remaining_quota 是否大于 0
 -> INSERT INTO registrations
 -> UPDATE clubs SET remaining_quota = remaining_quota - 1
 -> COMMIT
```

关键约束：

- `registrations.id_card_hash` 设为唯一，数据库层防止重复报名。
- 社团行使用 `FOR UPDATE` 锁定，防止并发超卖。
- 任一步失败则 rollback。

## API 兼容性

前端现有 API 路径保持不变。

返回字段也尽量保持不变：

- 社团字段仍为 `total_quota`、`remaining_quota`。
- 报名记录仍返回 `className`、`clubName`、`time`。
- 学生列表仍返回 `id_card`、`class_name`、`created_at`。

这样可以最大限度减少前端改动。

## 初始化社团数据

`server/index.ts` 中的 `initClubs()` 保留，但内部改为 MySQL 查询：

1. 查询 `clubs` 是否已有数据。
2. 如果为空，插入默认社团。
3. 如果已有数据，跳过初始化。

## 学生导入

保留现有文件解析逻辑：

- Excel 使用 `xlsx`。
- 文本文件按 Tab 或逗号解析。

数据库操作改为 MySQL：

- 先按 `id_card` 查询。
- 存在则更新姓名和班级。
- 不存在则插入。

## 统计和导出

统计接口可通过 SQL 聚合实现：

```sql
SELECT c.id, c.name, c.total_quota, c.remaining_quota, COUNT(r.id) AS registered
FROM clubs c
LEFT JOIN registrations r ON r.club_id = c.id
GROUP BY c.id, c.name, c.total_quota, c.remaining_quota
ORDER BY c.name;
```

导出接口继续返回 CSV，数据来自 `registrations` 与 `clubs` 的 JOIN。

## 错误处理

1. 数据库连接缺失配置时，在启动或首次访问时抛出清晰错误。
2. 报名重复时返回业务错误，而不是数据库错误文本。
3. 名额不足时返回 `该社团名额已满`。
4. 事务失败时 rollback，并返回统一错误响应。

## 测试和验证

至少需要验证：

1. `pnpm install` 后依赖正常。
2. `pnpm run build` 通过。
3. 后端能连接 MySQL。
4. `/health` 可访问。
5. `/api/clubs` 可返回默认社团。
6. 导入学生后，报名成功。
7. 同一身份证重复报名失败。
8. 社团剩余名额扣减正确。
9. 清空报名后，名额重置。
10. 后台社团增删改查可用。

## 风险

1. 如果本地或部署环境没有 MySQL，需要先准备数据库实例。
2. 旧 Supabase 数据不会自动迁移，除非额外导出再导入。
3. 当前后台仍无真实鉴权，数据库替换不会解决权限安全问题。
4. 文本 CSV 解析仍然较简单，不属于本次迁移重点。
