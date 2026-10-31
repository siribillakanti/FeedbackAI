const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { pool, withTransaction, withConnection } = require('../config/db');
const { bcryptCost } = require('../config/env');
const { asyncHandler, ok, created, ApiError, notFound } = require('../utils/http');
const { validate, id } = require('../middleware/validate');
const { paginationQuery, pageParams, pageMeta } = require('../utils/pagination');
const { analyzeFeedback } = require('../services/sentiment');

const router = express.Router();

const USER_COLUMNS = 'user_id, full_name, email, role, status, created_at';
const ACTIVITY_COLUMNS = `activity_type, product_id, product_name, product_slug, category_id, category_name,
  category_slug, detail, occurred_at, source_table, source_id, is_demo`;
const ACTIVITY_TYPES = ['PRODUCT_VIEW', 'CATEGORY_VIEW', 'SEARCH', 'RECOMMENDATION_CLICK', 'RATED', 'REVIEWED'];

// One row per rating, with its review when there is one. Review-side fields come from
// v_feedback_details, which already derives analysis status, confidence and MIXED.
const REVIEW_SELECT = `
  SELECT r.rating_id, r.stars, r.created_at,
         GREATEST(r.updated_at, COALESCE(fd.updated_at, r.updated_at)) AS updated_at,
         p.product_id, p.slug AS product_slug, p.name AS product_name, p.brand, p.is_active,
         c.name AS category_name, c.slug AS category_slug,
         fd.feedback_id, fd.title, fd.body, fd.feedback_status,
         fd.analysis_status, fd.sentiment_label, fd.confidence, fd.overall_sentiment
    FROM ratings r
    JOIN products p ON p.product_id = r.product_id
    JOIN categories c ON c.category_id = p.category_id
    LEFT JOIN v_feedback_details fd ON fd.rating_id = r.rating_id`;

const reviewBody = {
  stars: z.number().int('Stars must be a whole number').min(1, 'Stars must be between 1 and 5').max(5, 'Stars must be between 1 and 5'),
  title: z.string().trim().max(120, 'Title must be at most 120 characters').nullish(),
  body: z.string().trim()
    .min(10, 'Review must be at least 10 characters')
    .max(4000, 'Review must be at most 4000 characters')
    .nullish()
};

function reviewItem(row, aspects) {
  return {
    rating_id: row.rating_id,
    stars: row.stars,
    feedback_id: row.feedback_id,
    title: row.title,
    body: row.body,
    feedback_status: row.feedback_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    analysis_status: row.analysis_status,
    sentiment_label: row.sentiment_label,
    confidence: row.confidence,
    overall_sentiment: row.overall_sentiment,
    product: {
      product_id: row.product_id,
      slug: row.product_slug,
      name: row.product_name,
      brand: row.brand,
      category_name: row.category_name,
      category_slug: row.category_slug,
      is_active: Boolean(row.is_active)
    },
    aspects
  };
}

function activityItem(row) {
  return { ...row, is_demo: Boolean(row.is_demo) };
}

// Aspects for a whole page of ratings in one query, keyed by rating_id.
async function aspectsByRating(ratingIds) {
  const byRating = new Map();
  if (!ratingIds.length) return byRating;
  const [rows] = await pool.query(
    `SELECT f.rating_id, a.slug, a.display_name AS name, asp.polarity, asp.score, asp.evidence
       FROM aspect_sentiments asp
       JOIN sentiment_analysis sa ON sa.analysis_id = asp.analysis_id AND sa.status = 'COMPLETED'
       JOIN feedback f ON f.feedback_id = sa.feedback_id
       JOIN aspects a ON a.aspect_id = asp.aspect_id
      WHERE f.rating_id IN (?)
      ORDER BY asp.score DESC, a.display_name`,
    [ratingIds]
  );
  for (const row of rows) {
    const list = byRating.get(row.rating_id) || [];
    list.push({ slug: row.slug, name: row.name, polarity: row.polarity, score: row.score, evidence: row.evidence });
    byRating.set(row.rating_id, list);
  }
  return byRating;
}

async function loadReview(userId, productId) {
  const [[row]] = await pool.query(`${REVIEW_SELECT} WHERE r.user_id = ? AND r.product_id = ?`, [userId, productId]);
  if (!row) return null;
  const aspects = await aspectsByRating([row.rating_id]);
  return reviewItem(row, aspects.get(row.rating_id) || []);
}

async function loadProfile(userId) {
  const [[user]] = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ?`, [userId]);
  if (!user) throw notFound('User');
  const [categories] = await pool.query(
    `SELECT c.category_id, c.name, c.slug
       FROM user_category_preferences ucp
       JOIN categories c ON c.category_id = ucp.category_id
      WHERE ucp.user_id = ?
      ORDER BY c.display_order, c.name`,
    [userId]
  );
  return { ...user, preferred_categories: categories };
}

router.get('/summary', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const [[stats]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM ratings WHERE user_id = ?) AS ratings_count,
            (SELECT COUNT(*) FROM v_feedback_details WHERE user_id = ?) AS reviews_count,
            (SELECT ROUND(AVG(stars), 2) FROM ratings WHERE user_id = ?) AS avg_stars_given,
            (SELECT COUNT(DISTINCT product_id) FROM user_interactions
              WHERE user_id = ? AND interaction_type = 'PRODUCT_VIEW') AS products_viewed`,
    [userId, userId, userId, userId]
  );
  const [recent] = await pool.query(
    `SELECT ${ACTIVITY_COLUMNS} FROM v_user_activity WHERE user_id = ?
      ORDER BY occurred_at DESC, source_table, source_id DESC LIMIT 5`,
    [userId]
  );
  const [counts] = await pool.query(
    'SELECT overall_sentiment, COUNT(*) AS total FROM v_feedback_details WHERE user_id = ? GROUP BY overall_sentiment',
    [userId]
  );
  const sentiment = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0, MIXED: 0, UNANALYSED: 0 };
  for (const row of counts) sentiment[row.overall_sentiment || 'UNANALYSED'] = row.total;
  ok(res, { ...stats, recent_activity: recent.map(activityItem), sentiment });
}));

router.get('/reviews', validate({ query: paginationQuery }), asyncHandler(async (req, res) => {
  const page = req.valid.query;
  const { limit, offset } = pageParams(page);
  const userId = req.user.id;
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM ratings WHERE user_id = ?', [userId]);
  const [rows] = await pool.query(
    `${REVIEW_SELECT} WHERE r.user_id = ? ORDER BY r.created_at DESC, r.rating_id DESC LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  const aspects = await aspectsByRating(rows.map((row) => row.rating_id));
  ok(res, rows.map((row) => reviewItem(row, aspects.get(row.rating_id) || [])), pageMeta(page, total));
}));

router.get('/reviews/:productId', validate({ params: { productId: id } }), asyncHandler(async (req, res) => {
  const review = await loadReview(req.user.id, req.valid.params.productId);
  if (!review) throw notFound('Review');
  ok(res, review);
}));

// Upsert through sp_submit_review. The procedure owns its transaction, so this runs on a
// plain pooled connection: the OUT parameter is read back from @fid on the same connection.
router.put('/reviews/:productId', validate({ params: { productId: id }, body: reviewBody }), asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { productId } = req.valid.params;
  const { stars, title, body } = req.valid.body;
  const [[existing]] = await pool.query(
    'SELECT rating_id FROM ratings WHERE user_id = ? AND product_id = ?',
    [userId, productId]
  );

  const feedbackId = await withConnection(async (conn) => {
    await conn.query('CALL sp_submit_review(?, ?, ?, ?, ?, @fid)', [userId, productId, stars, title ?? null, body ?? null]);
    const [[row]] = await conn.query('SELECT @fid AS feedback_id');
    return row.feedback_id;
  });

  if (feedbackId) analyzeFeedback(feedbackId).catch(() => {});
  const review = await loadReview(userId, productId);
  if (existing) ok(res, review);
  else created(res, review);
}));

router.delete('/reviews/:productId', validate({ params: { productId: id } }), asyncHandler(async (req, res) => {
  const { productId } = req.valid.params;
  const [result] = await pool.query('DELETE FROM ratings WHERE user_id = ? AND product_id = ?', [req.user.id, productId]);
  if (!result.affectedRows) throw notFound('Review');
  ok(res, { product_id: productId, deleted: true });
}));

router.get('/activity', validate({
  query: { ...paginationQuery, type: z.enum(ACTIVITY_TYPES).optional() }
}), asyncHandler(async (req, res) => {
  const { type, ...page } = req.valid.query;
  const { limit, offset } = pageParams(page);
  const typeFilter = type ? 'AND activity_type = ?' : '';
  const filterParams = type ? [req.user.id, type] : [req.user.id];
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM v_user_activity WHERE user_id = ? ${typeFilter}`,
    filterParams
  );
  const [rows] = await pool.query(
    `SELECT ${ACTIVITY_COLUMNS} FROM v_user_activity WHERE user_id = ? ${typeFilter}
      ORDER BY occurred_at DESC, source_table, source_id DESC LIMIT ? OFFSET ?`,
    [...filterParams, limit, offset]
  );
  ok(res, rows.map(activityItem), pageMeta(page, total));
}));

router.get('/profile', asyncHandler(async (req, res) => {
  ok(res, await loadProfile(req.user.id));
}));

router.patch('/profile', validate({
  body: {
    full_name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100).optional(),
    preferred_category_ids: z.array(id).max(6, 'Choose at most 6 categories').optional()
  }
}), asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { full_name, preferred_category_ids } = req.valid.body;
  try {
    await withTransaction(async (conn) => {
      if (full_name !== undefined) {
        await conn.query('UPDATE users SET full_name = ? WHERE user_id = ?', [full_name, userId]);
      }
      if (preferred_category_ids !== undefined) {
        await conn.query('DELETE FROM user_category_preferences WHERE user_id = ?', [userId]);
        const categoryIds = [...new Set(preferred_category_ids)];
        if (categoryIds.length) {
          await conn.query(
            'INSERT INTO user_category_preferences (user_id, category_id) VALUES ?',
            [categoryIds.map((categoryId) => [userId, categoryId])]
          );
        }
      }
    });
  } catch (err) {
    // This MySQL reports a missing parent as 1216; 1452 is the same error with extra detail.
    if ([1216, 1452].includes(err.errno)) {
      throw new ApiError(422, 'INVALID_CATEGORY', 'One of the selected categories does not exist', { preferred_category_ids: 'Unknown category' });
    }
    throw err;
  }
  ok(res, await loadProfile(userId));
}));

router.patch('/password', validate({
  body: {
    current_password: z.string().min(1, 'Enter your current password').max(72),
    new_password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be at most 72 characters')
  }
}), asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.valid.body;
  const [[user]] = await pool.query('SELECT password_hash FROM users WHERE user_id = ?', [req.user.id]);
  if (!user) throw notFound('User');
  if (!(await bcrypt.compare(current_password, user.password_hash))) {
    throw new ApiError(422, 'WRONG_PASSWORD', 'Your current password is incorrect.', { current_password: 'Incorrect password' });
  }
  const passwordHash = await bcrypt.hash(new_password, bcryptCost);
  await pool.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [passwordHash, req.user.id]);
  ok(res, { password_changed: true });
}));

module.exports = router;
