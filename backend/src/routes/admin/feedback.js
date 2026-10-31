const express = require('express');
const { z } = require('zod');
const { pool, withTransaction } = require('../../config/db');
const { ok, notFound, asyncHandler } = require('../../utils/http');
const { validate, id } = require('../../middleware/validate');
const { paginationQuery, pageParams, pageMeta } = require('../../utils/pagination');

const router = express.Router();

const SORTS = {
  newest: 'created_at DESC, feedback_id DESC',
  oldest: 'created_at ASC, feedback_id ASC',
  stars_asc: 'stars ASC, created_at DESC, feedback_id DESC',
  stars_desc: 'stars DESC, created_at DESC, feedback_id DESC'
};

const FEEDBACK_COLUMNS = `
  feedback_id, rating_id, user_id, user_name, product_id, product_name, brand,
  category_id, category_name, stars, title, body, feedback_status, analysis_status,
  sentiment_label, overall_sentiment, confidence, is_demo, created_at, updated_at`;

const isoDate = z.string().refine((d) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
}, 'Use a real date as YYYY-MM-DD');

const moderationBody = z.object({
  status: z.enum(['PUBLISHED', 'HIDDEN', 'FLAGGED']),
  moderation_note: z.string().trim().max(255).transform((v) => v || null).nullable().optional()
});

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

const toFeedback = (row) => ({ ...row, is_demo: Boolean(row.is_demo) });

// Feedback row from the view, plus moderation metadata and the aspect breakdown.
async function loadFeedback(feedbackId) {
  const [[row]] = await pool.query(`SELECT ${FEEDBACK_COLUMNS} FROM v_feedback_details WHERE feedback_id = ?`, [feedbackId]);
  if (!row) return null;
  const [[moderation]] = await pool.query(
    `SELECT f.moderated_by, m.full_name AS moderated_by_name, f.moderated_at, f.moderation_note
       FROM feedback f
       LEFT JOIN users m ON m.user_id = f.moderated_by
      WHERE f.feedback_id = ?`,
    [feedbackId]
  );
  const [aspects] = await pool.query(
    `SELECT a.slug AS aspect, a.display_name, asp.polarity, asp.score, asp.evidence
       FROM sentiment_analysis sa
       JOIN aspect_sentiments asp ON asp.analysis_id = sa.analysis_id
       JOIN aspects a ON a.aspect_id = asp.aspect_id
      WHERE sa.feedback_id = ?
      ORDER BY asp.score DESC, a.display_name`,
    [feedbackId]
  );
  return { ...toFeedback(row), ...moderation, aspects };
}

router.get('/', validate({
  query: {
    status: z.enum(['PUBLISHED', 'HIDDEN', 'FLAGGED']).optional(),
    sentiment: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED', 'PENDING']).optional(),
    category_id: id.optional(),
    product_id: id.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    q: z.string().trim().max(100).optional(),
    is_demo: z.enum(['true', 'false']).optional(),
    sort: z.enum(Object.keys(SORTS)).default('newest'),
    ...paginationQuery
  }
}), asyncHandler(async (req, res) => {
  const query = req.valid.query;
  const where = [];
  const params = [];
  if (query.status) { where.push('feedback_status = ?'); params.push(query.status); }
  if (query.sentiment === 'PENDING') {
    where.push("(analysis_status IS NULL OR analysis_status <> 'COMPLETED')");
  } else if (query.sentiment) {
    where.push('overall_sentiment = ?');
    params.push(query.sentiment);
  }
  if (query.category_id) { where.push('category_id = ?'); params.push(query.category_id); }
  if (query.product_id) { where.push('product_id = ?'); params.push(query.product_id); }
  if (query.from) { where.push('created_at >= ?'); params.push(query.from); }
  if (query.to) { where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(query.to); }
  if (query.q) {
    const term = `%${escapeLike(query.q)}%`;
    where.push('(title LIKE ? OR body LIKE ?)');
    params.push(term, term);
  }
  if (query.is_demo) { where.push('is_demo = ?'); params.push(query.is_demo === 'true' ? 1 : 0); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { limit, offset } = pageParams(query);

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM v_feedback_details ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT ${FEEDBACK_COLUMNS} FROM v_feedback_details ${whereSql} ORDER BY ${SORTS[query.sort]} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  ok(res, rows.map(toFeedback), pageMeta(query, total));
}));

router.get('/:id', validate({ params: { id } }), asyncHandler(async (req, res) => {
  const feedback = await loadFeedback(req.valid.params.id);
  if (!feedback) throw notFound('Feedback');
  ok(res, feedback);
}));

router.patch('/:id', validate({ params: { id }, body: moderationBody }), asyncHandler(async (req, res) => {
  const feedbackId = req.valid.params.id;
  const { status, moderation_note: note } = req.valid.body;
  await withTransaction(async (conn) => {
    // trg_feedback_after_update writes the FEEDBACK_STATUS_CHANGED audit row using @app_actor_id.
    const [result] = await conn.query(
      `UPDATE feedback
          SET status = ?, moderated_by = ?, moderated_at = UTC_TIMESTAMP(), moderation_note = ?
        WHERE feedback_id = ?`,
      [status, req.user.id, note ?? null, feedbackId]
    );
    if (!result.affectedRows) throw notFound('Feedback');
  }, { actorId: req.user.id });

  ok(res, await loadFeedback(feedbackId));
}));

module.exports = router;
