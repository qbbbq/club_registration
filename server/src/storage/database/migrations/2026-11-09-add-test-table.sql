-- 测试表：仅用于验证数据库连接与迁移流程，不参与业务逻辑。
CREATE TABLE IF NOT EXISTS test_table (
  test_content VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
