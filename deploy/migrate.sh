#!/usr/bin/env bash
# 数据库迁移执行器：只执行 schema_migrations 中未记录的迁移。
# 用法：
#   bash deploy/migrate.sh           执行待应用迁移
#   bash deploy/migrate.sh --status  查看迁移状态
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

MODE="apply"
case "${1:-}" in
  --status) MODE="status" ;;
  "") ;;
  *)
    echo "用法：bash deploy/migrate.sh [--status]" >&2
    exit 2
    ;;
esac

if [ ! -f .env ]; then
  echo "错误：$APP_DIR/.env 不存在，请先按 docs/deploy/ubuntu24-baota.md 第 4 节创建。" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${MYSQL_HOST:?缺少 MYSQL_HOST}"
: "${MYSQL_USER:?缺少 MYSQL_USER}"
: "${MYSQL_PASSWORD:?缺少 MYSQL_PASSWORD}"
: "${MYSQL_DATABASE:?缺少 MYSQL_DATABASE}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

if [ -n "${MYSQL_BIN:-}" ]; then
  :
elif command -v mysql >/dev/null 2>&1; then
  MYSQL_BIN="$(command -v mysql)"
elif [ -x /www/server/mysql/bin/mysql ]; then
  MYSQL_BIN="/www/server/mysql/bin/mysql"
else
  echo "错误：找不到 mysql 客户端。请安装 mysql-client，或设置 MYSQL_BIN。" >&2
  exit 1
fi

MYSQL_CNF="$(mktemp)"
cleanup() {
  rm -f "$MYSQL_CNF"
}
trap cleanup EXIT
chmod 600 "$MYSQL_CNF"

{
  printf '[client]\n'
  printf 'host=%s\n' "$MYSQL_HOST"
  printf 'port=%s\n' "$MYSQL_PORT"
  printf 'user=%s\n' "$MYSQL_USER"
  printf 'password=%s\n' "$MYSQL_PASSWORD"
  printf 'default-character-set=utf8mb4\n'
} > "$MYSQL_CNF"

mysql_run() {
  "$MYSQL_BIN" --defaults-extra-file="$MYSQL_CNF" --database="$MYSQL_DATABASE" "$@"
}

echo "==> 确认迁移记录表"
mysql_run <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
SQL

MIGRATIONS_DIR="$APP_DIR/server/src/storage/database/migrations"
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "错误：迁移目录不存在：$MIGRATIONS_DIR" >&2
  exit 1
fi

if [ "$MODE" = "apply" ]; then
  CLUBS_EXISTS="$(mysql_run --batch --skip-column-names -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'clubs';")"
  if [ "$CLUBS_EXISTS" = "0" ]; then
    echo "错误：数据库中没有 clubs 表。请先执行 server/src/storage/database/init.sql 初始化数据库。" >&2
    exit 1
  fi
fi

mapfile -t MIGRATION_FILES < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort)

if [ "${#MIGRATION_FILES[@]}" -eq 0 ]; then
  echo "没有迁移文件。"
  exit 0
fi

APPLIED=0
SKIPPED=0
PENDING=0

for file in "${MIGRATION_FILES[@]}"; do
  name="$(basename "$file")"
  escaped_name="${name//\'/\'\'}"
  count="$(mysql_run --batch --skip-column-names -e \
    "SELECT COUNT(*) FROM schema_migrations WHERE name = '$escaped_name';")"

  if [ "$count" != "0" ]; then
    if [ "$MODE" = "status" ]; then
      printf '已应用  %s\n' "$name"
    fi
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$MODE" = "status" ]; then
    printf '待应用  %s\n' "$name"
    PENDING=$((PENDING + 1))
    continue
  fi

  echo "==> 应用迁移：$name"
  mysql_run < "$file"
  mysql_run -e "INSERT INTO schema_migrations (name) VALUES ('$escaped_name');"
  APPLIED=$((APPLIED + 1))
done

if [ "$MODE" = "status" ]; then
  echo "迁移状态：已应用 $SKIPPED 个，待应用 $PENDING 个。"
else
  echo "迁移完成：新应用 $APPLIED 个，跳过 $SKIPPED 个。"
fi
