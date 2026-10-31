const express = require('express');
const { z } = require('zod');
const { pool, withTransaction } = require('../../config/db');
const { ok, notFound, ApiError, asyncHandler } = require('../../utils/http');
const { validate, id } = require('../../middleware/validate');
const { paginationQuery, pageParams, pageMeta } = require('../../utils/pagination');

const router = express.Router();

const SORTS = {
  newest: 'u.created_at DESC, u.user_id DESC',
  oldest: 'u.created_at ASC, u.user_id ASC',
  name: 'u.full_name ASC, u.user_id ASC',
  most_reviews: 'review_count DESC, u.user_id ASC',
  last_login: 'u.last_login_at IS NULL, u.last_login_at DESC, u.user_id ASC'
};

const USER_COLUMNS = `
  u.user_id, u.full_name, u.email, u.role, u.status, u.last_login_at, u.created_at, u.updated_at,
  (u.seed_batch_id IS NOT NULL) AS is_demo,
  (SELECT COUNT(*) FROM ratings r WHERE r.user_id = u.user_id) AS rating_count,
  (SELECT COUNT(*) FROM feedback f JOIN ratings r ON r.rating_id = f.rating_id WHERE r.user_id = u.user_id) AS review_count`;

const userPatch = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  role: z.enum(['CUSTOMER', 'ADMIN']).optional()
}).refine((b) => b.status || b.role, { message: 'Provide status or role' });

const toBool = (row) => ({ ...row, is_demo: Boolean(row.is_demo) });

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// Locks the active admins before any change, so two concurrent demotions or deletions
// cannot both pass trg_users_before_* (docs/04 section 4.4).
function lockActiveAdmins(conn) {
  return conn.query("SELECT user_id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY user_id FOR UPDATE");
}

function audit(conn, actorId, action, userId, details) {
  return conn.query(
    'INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [actorId, action, 'user', userId, details]
  );
}

router.get('/', validate({
  query: {
    q: z.string().trim().max(100).optional(),
    role: z.enum(['CUSTOMER', 'ADMIN']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    sort: z.enum(Object.keys(SORTS)).default('newest'),
    ...paginationQuery
  }
}), asyncHandler(async (req, res) => {
  const { q, role, status, sort } = req.valid.query;
  const where = [];
  const params = [];
  if (q) {
    const term = `%${escapeLike(q)}%`;
    where.push('(u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(term, term);
  }
  if (role) { where.push('u.role = ?'); params.push(role); }
  if (status) { where.push('u.status = ?'); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { limit, offset } = pageParams(req.valid.query);

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users u ${whereSql} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  ok(res, rows.map(toBool), pageMeta(req.valid.query, total));
}));

router.get('/:id', validate({ params: { id } }), asyncHandler(async (req, res) => {
  const [[user]] = await pool.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.user_id = ?`, [req.valid.params.id]);
  if (!user) throw notFound('User');
  const [recentReviews] = await pool.query(
    `SELECT feedback_id, product_id, product_name, stars, title, body, feedback_status, overall_sentiment, created_at
       FROM v_feedback_details WHERE user_id = ? ORDER BY created_at DESC, feedback_id DESC LIMIT 5`,
    [user.user_id]
  );
  ok(res, { ...toBool(user), recent_reviews: recentReviews });
}));

router.patch('/:id', validate({ params: { id }, body: userPatch }), asyncHandler(async (req, res) => {
  const userId = req.valid.params.id;
  if (userId === req.user.id) {
    throw new ApiError(409, 'SELF_CHANGE', "You can't change your own role or status.");
  }
  const { status, role } = req.valid.body;
  await withTransaction(async (conn) => {
    await lockActiveAdmins(conn);
    const [[current]] = await conn.query('SELECT role, status FROM users WHERE user_id = ? FOR UPDATE', [userId]);
    if (!current) throw notFound('User');
    const next = { role: role ?? current.role, status: status ?? current.status };
    const changes = ['role', 'status']
      .filter((field) => next[field] !== current[field])
      .map((field) => `${field} ${current[field]} -> ${next[field]}`);
    // trg_users_before_update raises FA_LAST_ADMIN (422) when this demotes or suspends the last active admin.
    await conn.query('UPDATE users SET role = ?, status = ? WHERE user_id = ?', [next.role, next.status, userId]);
    if (changes.length) await audit(conn, req.user.id, 'USER_UPDATED', userId, changes.join(', '));
  }, { actorId: req.user.id });

  const [[user]] = await pool.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.user_id = ?`, [userId]);
  ok(res, toBool(user));
}));

router.delete('/:id', validate({ params: { id } }), asyncHandler(async (req, res) => {
  const userId = req.valid.params.id;
  if (userId === req.user.id) {
    throw new ApiError(409, 'SELF_CHANGE', "You can't delete your own account.");
  }
  await withTransaction(async (conn) => {
    await lockActiveAdmins(conn);
    const [[user]] = await conn.query('SELECT email, role, status FROM users WHERE user_id = ? FOR UPDATE', [userId]);
    if (!user) throw notFound('User');
    // The trigger cannot see the cascaded ratings, feedback and interactions, so the app audits the delete.
    await audit(conn, req.user.id, 'USER_DELETED', userId, `${user.email} (${user.role}, ${user.status})`);
    await conn.query('DELETE FROM users WHERE user_id = ?', [userId]);
  }, { actorId: req.user.id });
  ok(res, { deleted: true });
}));

module.exports = router;
