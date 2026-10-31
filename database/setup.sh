#!/usr/bin/env bash
# =============================================================================
# FeedbackAI — database/setup.sh
#
# Creates feedback_ai_db and feedback_ai_test_db on the shared MySQL server,
# creates/updates the least-privilege runtime account feedbackai_app, and
# applies 01_schema.sql → 04_triggers.sql. Safe to re-run: tables are created
# IF NOT EXISTS; views/procedures/triggers are replaced.
#
# DDL runs as the server admin account because the server has log_bin=1 and
# log_bin_trust_function_creators=0 (docs/00_DECISIONS.md §5a.27).
#
# Usage:
#   bash database/setup.sh                       # both databases
#   bash database/setup.sh feedback_ai_test_db   # one database
#   bash database/setup.sh --reset feedback_ai_test_db   # drop + rebuild
#
# Environment (optional):
#   MYSQL_ADMIN_USER      default root
#   MYSQL_ADMIN_PASSWORD  default empty
#   DB_HOST / DB_PORT     default 127.0.0.1 / 3307
#   MYSQL_BIN             default /usr/local/mysql/bin/mysql
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/backend/.env"

MYSQL_BIN="${MYSQL_BIN:-/usr/local/mysql/bin/mysql}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3307}"
ADMIN_USER="${MYSQL_ADMIN_USER:-root}"
ADMIN_PASSWORD="${MYSQL_ADMIN_PASSWORD:-}"

ALLOWED_DBS=(feedback_ai_db feedback_ai_test_db)
APP_USER="feedbackai_app"

RESET=0
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    all) TARGETS=("${ALLOWED_DBS[@]}") ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) TARGETS+=("$arg") ;;
  esac
done
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=("${ALLOWED_DBS[@]}")

# Refuse anything that is not a FeedbackAI database (protects inventory_warehouse_db).
for db in "${TARGETS[@]}"; do
  ok=0
  for allowed in "${ALLOWED_DBS[@]}"; do [ "$db" = "$allowed" ] && ok=1; done
  if [ "$ok" -ne 1 ]; then
    echo "setup.sh: refusing to touch database '$db' (allowed: ${ALLOWED_DBS[*]})" >&2
    exit 2
  fi
done

[ -x "$MYSQL_BIN" ] || { echo "setup.sh: mysql client not found at $MYSQL_BIN" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "setup.sh: $ENV_FILE not found (copy backend/.env.example)" >&2; exit 1; }

APP_PASSWORD="$(sed -n 's/^DB_PASSWORD=//p' "$ENV_FILE" | tail -n 1)"
if ! [[ "$APP_PASSWORD" =~ ^[A-Za-z0-9._-]{16,}$ ]]; then
  echo "setup.sh: DB_PASSWORD in backend/.env must be 16+ chars of [A-Za-z0-9._-]" >&2
  exit 1
fi

# Admin credentials go through a private option file, never the command line.
CNF="$(mktemp -t feedbackai-setup.XXXXXX)"
chmod 600 "$CNF"
trap 'rm -f "$CNF"' EXIT
{
  echo "[client]"
  echo "user=$ADMIN_USER"
  echo "password=\"$ADMIN_PASSWORD\""
  echo "host=$DB_HOST"
  echo "port=$DB_PORT"
  echo "protocol=TCP"
  echo "default-character-set=utf8mb4"
} > "$CNF"

mysql_admin() { "$MYSQL_BIN" --defaults-extra-file="$CNF" "$@"; }

echo "==> Server: $(mysql_admin -N -B -e 'SELECT CONCAT(VERSION(), " on port ", @@port)')"

echo "==> Creating databases"
for db in "${ALLOWED_DBS[@]}"; do
  mysql_admin -e "CREATE DATABASE IF NOT EXISTS \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
done

echo "==> Creating/updating runtime account $APP_USER (grants limited to FeedbackAI databases)"
# Fed through stdin so the password never appears in the process list.
mysql_admin <<SQL
CREATE USER IF NOT EXISTS '$APP_USER'@'localhost' IDENTIFIED BY '$APP_PASSWORD';
CREATE USER IF NOT EXISTS '$APP_USER'@'127.0.0.1' IDENTIFIED BY '$APP_PASSWORD';
ALTER USER '$APP_USER'@'localhost' IDENTIFIED BY '$APP_PASSWORD';
ALTER USER '$APP_USER'@'127.0.0.1' IDENTIFIED BY '$APP_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON \`feedback_ai_db\`.*      TO '$APP_USER'@'localhost', '$APP_USER'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON \`feedback_ai_test_db\`.* TO '$APP_USER'@'localhost', '$APP_USER'@'127.0.0.1';
SQL

for db in "${TARGETS[@]}"; do
  if [ "$RESET" -eq 1 ]; then
    echo "==> [$db] Dropping FeedbackAI objects (--reset)"
    mysql_admin --database="$db" < "$SCRIPT_DIR/99_reset_dev.sql"
  fi
  for f in 01_schema.sql 02_views.sql 03_procedures.sql 04_triggers.sql; do
    echo "==> [$db] Applying $f"
    mysql_admin --database="$db" < "$SCRIPT_DIR/$f"
  done
  mysql_admin -N -B -e "
    SELECT CONCAT('==> [$db] ',
      (SELECT COUNT(*) FROM information_schema.tables   WHERE table_schema='$db' AND table_type='BASE TABLE'), ' tables, ',
      (SELECT COUNT(*) FROM information_schema.views    WHERE table_schema='$db'), ' views, ',
      (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='$db' AND routine_type='PROCEDURE'), ' procedures, ',
      (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='$db'), ' triggers');"
done

echo "==> Done"
