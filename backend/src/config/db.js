const mysql = require('mysql2/promise');
const { db } = require('./env');

const ALLOWED_DATABASES = ['feedback_ai_db', 'feedback_ai_test_db'];
if (!ALLOWED_DATABASES.includes(db.database)) {
  // Guards against the copied InventoryOS .env pointing this API at inventory_warehouse_db.
  throw new Error(`DB_NAME must be one of ${ALLOWED_DATABASES.join(', ')}; got '${db.database}'`);
}

const pool = mysql.createPool({
  ...db,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z', // all DATETIME values are UTC (00_DECISIONS 5a.14)
  decimalNumbers: true, // DECIMAL columns come back as numbers, not strings
  multipleStatements: false
});

pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

// Runs fn(conn) inside a transaction on one pooled connection.
// actorId sets @app_actor_id for the audit trigger and is always cleared before release.
async function withTransaction(fn, { actorId = null } = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @app_actor_id = ?', [actorId]);
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.query('SET @app_actor_id = NULL').catch(() => {});
    conn.release();
  }
}

// Runs fn(conn) on one pooled connection without opening a transaction. Used for
// procedures that manage their own transaction (sp_submit_review, 00_DECISIONS 5a.23)
// and need a session variable for their OUT parameter.
async function withConnection(fn) {
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction, withConnection };
