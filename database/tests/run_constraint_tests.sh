#!/usr/bin/env bash
# =============================================================================
# FeedbackAI — database/tests/run_constraint_tests.sh
#
# Runs the constraint/trigger/procedure tests against feedback_ai_test_db only:
#   1. empties the test database (reset_test_db.sql)
#   2. runs constraint_tests.sql as the admin account (DDL for helper procs)
#   3. re-checks views, procedures and privilege limits as feedbackai_app
#   4. empties the test database again
# Prints one PASS/FAIL line per check and exits 1 if anything failed.
#
# Environment: MYSQL_ADMIN_USER (root), MYSQL_ADMIN_PASSWORD (empty),
#              DB_HOST (127.0.0.1), DB_PORT (3307), MYSQL_BIN.
# =============================================================================
set -euo pipefail

TEST_DB="feedback_ai_test_db"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$ROOT_DIR/backend/.env"

MYSQL_BIN="${MYSQL_BIN:-/usr/local/mysql/bin/mysql}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3307}"

APP_PASSWORD="$(sed -n 's/^DB_PASSWORD=//p' "$ENV_FILE" | tail -n 1)"

ADMIN_CNF="$(mktemp -t feedbackai-test-admin.XXXXXX)"
APP_CNF="$(mktemp -t feedbackai-test-app.XXXXXX)"
chmod 600 "$ADMIN_CNF" "$APP_CNF"
write_cnf() {
  { echo "[client]"; echo "user=$2"; echo "password=\"$3\""; echo "host=$DB_HOST"
    echo "port=$DB_PORT"; echo "protocol=TCP"; echo "default-character-set=utf8mb4"; } > "$1"
}
write_cnf "$ADMIN_CNF" "${MYSQL_ADMIN_USER:-root}" "${MYSQL_ADMIN_PASSWORD:-}"
write_cnf "$APP_CNF" "feedbackai_app" "$APP_PASSWORD"

mysql_admin() { "$MYSQL_BIN" --defaults-extra-file="$ADMIN_CNF" --database="$TEST_DB" -N -B "$@"; }
mysql_app()   { "$MYSQL_BIN" --defaults-extra-file="$APP_CNF"   --database="$TEST_DB" -N -B "$@"; }

cleanup() {
  mysql_admin < "$SCRIPT_DIR/reset_test_db.sql" >/dev/null 2>&1 || echo "WARN | cleanup of $TEST_DB failed" >&2
  rm -f "$ADMIN_CNF" "$APP_CNF"
}
trap cleanup EXIT

RESULTS=""
record() { RESULTS+="$1"$'\n'; echo "$1"; }

echo "==> Resetting $TEST_DB"
mysql_admin < "$SCRIPT_DIR/reset_test_db.sql"

echo "==> Running constraint_tests.sql as admin"
SQL_OUT="$(mysql_admin < "$SCRIPT_DIR/constraint_tests.sql")"
while IFS= read -r line; do
  case "$line" in PASS*|FAIL*) record "$line" ;; esac
done <<< "$SQL_OUT"

echo "==> Checking views, procedures and privileges as feedbackai_app"
for v in v_product_rating_stats v_feedback_details v_category_sentiment v_monthly_feedback_trend \
         v_aspect_summary v_product_performance v_user_activity; do
  if mysql_app -e "SELECT COUNT(*) FROM $v" >/dev/null 2>&1; then
    record "PASS | app account: SELECT from $v"
  else
    record "FAIL | app account: SELECT from $v"
  fi
done

for call in "CALL sp_products_above_threshold(1.00, 1)" "CALL sp_category_sentiment(NULL, NULL)" \
            "CALL sp_top_reviewers(5)" "CALL sp_monthly_trend(12)" \
            "CALL sp_submit_review(3, 1, 4, 'Via app', 'Submitted through the least-privilege app account.', @f); SELECT @f"; do
  if out="$(mysql_app -e "$call" 2>&1)"; then
    record "PASS | app account: ${call%%(*}"
  else
    record "FAIL | app account: ${call%%(*} | $out"
  fi
done

if mysql_app -e "SELECT COUNT(*) FROM inventory_warehouse_db.users" >/dev/null 2>&1; then
  record "FAIL | app account must not read inventory_warehouse_db"
else
  record "PASS | app account cannot read inventory_warehouse_db"
fi
if mysql_app -e "CREATE TABLE t_should_fail (id INT)" >/dev/null 2>&1; then
  record "FAIL | app account must not run DDL"
  mysql_admin -e "DROP TABLE IF EXISTS t_should_fail" || true
else
  record "PASS | app account cannot run DDL (CREATE TABLE denied)"
fi

PASS_COUNT="$(grep -c '^PASS' <<< "$RESULTS" || true)"
FAIL_COUNT="$(grep -c '^FAIL' <<< "$RESULTS" || true)"
echo "==> SUMMARY: $PASS_COUNT passed, $FAIL_COUNT failed"
[ "$FAIL_COUNT" -eq 0 ]
