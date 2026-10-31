const express = require('express');
const { z } = require('zod');
const { pool } = require('../config/db');
const { asyncHandler, ok, notFound } = require('../utils/http');
const { validate, slug } = require('../middleware/validate');
const { optionalAuth } = require('../middleware/auth');
const { paginationQuery, pageParams, pageMeta } = require('../utils/pagination');

const router = express.Router();

const blankToUndefined = (value) => (value === '' ? undefined : value);
const optional = (schema) => z.preprocess(blankToUndefined, schema.optional());

const PRODUCT_SORTS = {
  popular: 'prs.rating_count DESC, prs.bayes_rating DESC, p.product_id ASC',
  rating: 'prs.bayes_rating DESC, prs.rating_count DESC, p.product_id ASC',
  newest: 'p.created_at DESC, p.product_id DESC',
  price_asc: 'p.price ASC, p.product_id ASC',
  price_desc: 'p.price DESC, p.product_id DESC'
};

const REVIEW_SORTS = {
  recent: 'vfd.created_at DESC, vfd.feedback_id DESC',
  highest: 'vfd.stars DESC, vfd.created_at DESC, vfd.feedback_id DESC',
  lowest: 'vfd.stars ASC, vfd.created_at DESC, vfd.feedback_id DESC'
};

const productListQuery = z.object({
  category: optional(slug),
  q: z.string().trim().max(100).optional(),
  tag: optional(slug),
  min_rating: optional(z.coerce.number().min(0).max(5)),
  sort: z.preprocess(blankToUndefined, z.enum(Object.keys(PRODUCT_SORTS)).default('popular')),
  ...paginationQuery
});

const reviewListQuery = z.object({
  sort: z.preprocess(blankToUndefined, z.enum(Object.keys(REVIEW_SORTS)).default('recent')),
  ...paginationQuery
});

// Category rows with active product count, rating average and published review count.
const CATEGORY_STATS_SQL = `
  SELECT c.category_id, c.name, c.slug, c.description,
         COALESCE(pc.product_count, 0) AS product_count,
         rt.avg_rating,
         COALESCE(rv.review_count, 0) AS review_count
    FROM categories c
    LEFT JOIN (
      SELECT category_id, COUNT(*) AS product_count
        FROM products
       WHERE is_active = 1
       GROUP BY category_id
    ) pc ON pc.category_id = c.category_id
    LEFT JOIN (
      SELECT p.category_id, ROUND(AVG(r.stars), 2) AS avg_rating
        FROM ratings r
        JOIN products p ON p.product_id = r.product_id
       WHERE p.is_active = 1
       GROUP BY p.category_id
    ) rt ON rt.category_id = c.category_id
    LEFT JOIN (
      SELECT p.category_id, COUNT(*) AS review_count
        FROM feedback f
        JOIN ratings r ON r.rating_id = f.rating_id
        JOIN products p ON p.product_id = r.product_id
       WHERE p.is_active = 1 AND f.status = 'PUBLISHED'
       GROUP BY p.category_id
    ) rv ON rv.category_id = c.category_id`;

// Only signed-in customers generate interaction rows. The insert selects from users, so a
// token for a deleted account writes nothing instead of failing the page. The same view or
// search repeated within 30 minutes (a refresh, paging through results) is not logged again,
// so it cannot inflate the recommendation signals (docs/02_ARCHITECTURE.md §5).
async function logInteraction(user, interactionType, { productId = null, categoryId = null, searchQuery = null } = {}) {
  if (!user || user.role !== 'CUSTOMER') return;
  await pool.query(
    `INSERT INTO user_interactions (user_id, interaction_type, product_id, category_id, search_query, occurred_at)
     SELECT u.user_id, ?, ?, ?, ?, UTC_TIMESTAMP() FROM users u
      WHERE u.user_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM user_interactions ui
           WHERE ui.user_id = u.user_id AND ui.interaction_type = ?
             AND ui.product_id <=> ? AND ui.category_id <=> ? AND ui.search_query <=> ?
             AND ui.occurred_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE)`,
    [interactionType, productId, categoryId, searchQuery, user.id, interactionType, productId, categoryId, searchQuery]
  );
}

async function categoryIdBySlug(categorySlug) {
  const [[row]] = await pool.query('SELECT category_id FROM categories WHERE slug = ?', [categorySlug]);
  return row ? row.category_id : null;
}

async function tagSlugsByProduct(productIds) {
  const tagsByProduct = new Map();
  if (!productIds.length) return tagsByProduct;
  const [rows] = await pool.query(
    `SELECT pt.product_id, t.slug AS tag_slug
       FROM product_tags pt
       JOIN tags t ON t.tag_id = pt.tag_id
      WHERE pt.product_id IN (?)
      ORDER BY t.slug`,
    [productIds]
  );
  for (const row of rows) {
    if (!tagsByProduct.has(row.product_id)) tagsByProduct.set(row.product_id, []);
    tagsByProduct.get(row.product_id).push(row.tag_slug);
  }
  return tagsByProduct;
}

// "Ananya Iyer" -> "Ananya I."; the full name never leaves the server.
function reviewerName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${Array.from(parts[parts.length - 1])[0].toUpperCase()}.`;
}

function productFilters({ category, q, tag, min_rating: minRating }) {
  const where = ['p.is_active = 1'];
  const params = [];
  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (q) {
    if (q.length >= 3) {
      where.push('MATCH(p.name, p.brand, p.description) AGAINST (? IN NATURAL LANGUAGE MODE)');
      params.push(q);
    } else {
      const prefix = `${q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push('(p.name LIKE ? OR p.brand LIKE ?)');
      params.push(prefix, prefix);
    }
  }
  if (tag) {
    where.push(`EXISTS (
      SELECT 1 FROM product_tags pt
        JOIN tags t ON t.tag_id = pt.tag_id
       WHERE pt.product_id = p.product_id AND t.slug = ?)`);
    params.push(tag);
  }
  if (minRating !== undefined) {
    where.push('prs.avg_rating >= ?');
    params.push(minRating);
  }
  return { whereSql: where.join(' AND '), params };
}

router.get('/categories', optionalAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`${CATEGORY_STATS_SQL} ORDER BY c.display_order, c.name`);
  ok(res, rows);
}));

router.get('/categories/:slug', optionalAuth, validate({ params: { slug } }), asyncHandler(async (req, res) => {
  const [[category]] = await pool.query(`${CATEGORY_STATS_SQL} WHERE c.slug = ?`, [req.valid.params.slug]);
  if (!category) throw notFound('Category');
  await logInteraction(req.user, 'CATEGORY_VIEW', { categoryId: category.category_id });
  ok(res, category);
}));

router.get('/products', optionalAuth, validate({ query: productListQuery }), asyncHandler(async (req, res) => {
  const query = req.valid.query;
  const { whereSql, params } = productFilters(query);
  const fromSql = `
    FROM products p
    JOIN categories c ON c.category_id = p.category_id
    JOIN v_product_rating_stats prs ON prs.product_id = p.product_id
   WHERE ${whereSql}`;
  const { limit, offset } = pageParams(query);

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${fromSql}`, params);
  const [rows] = await pool.query(
    `SELECT p.product_id, p.slug, p.name, p.brand, p.price, p.image_url,
            c.category_id, c.name AS category_name, c.slug AS category_slug,
            prs.rating_count, prs.avg_rating, prs.bayes_rating
       ${fromSql}
      ORDER BY ${PRODUCT_SORTS[query.sort]}
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const tagsByProduct = await tagSlugsByProduct(rows.map((row) => row.product_id));

  if (query.q && query.page === 1 && req.user && req.user.role === 'CUSTOMER') {
    const categoryId = query.category ? await categoryIdBySlug(query.category) : null;
    await logInteraction(req.user, 'SEARCH', { categoryId, searchQuery: query.q });
  }

  ok(res, rows.map((row) => ({
    product_id: row.product_id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    price: row.price,
    image_url: row.image_url,
    category: { category_id: row.category_id, name: row.category_name, slug: row.category_slug },
    rating_count: row.rating_count,
    avg_rating: row.avg_rating,
    bayes_rating: row.bayes_rating,
    tags: tagsByProduct.get(row.product_id) || []
  })), pageMeta(query, total));
}));

router.get('/products/:slug', optionalAuth, validate({ params: { slug } }), asyncHandler(async (req, res) => {
  const [[product]] = await pool.query(
    `SELECT p.product_id, p.slug, p.name, p.brand, p.description, p.price, p.image_url, p.is_active,
            c.category_id, c.name AS category_name, c.slug AS category_slug
       FROM products p
       JOIN categories c ON c.category_id = p.category_id
      WHERE p.slug = ?`,
    [req.valid.params.slug]
  );
  if (!product) throw notFound('Product');
  const productId = product.product_id;

  const [[stats]] = await pool.query(
    `SELECT rating_count, avg_rating, bayes_rating, stars_1, stars_2, stars_3, stars_4, stars_5
       FROM v_product_rating_stats
      WHERE product_id = ?`,
    [productId]
  );
  const [sentimentRows] = await pool.query(
    `SELECT overall_sentiment, COUNT(*) AS n
       FROM v_feedback_details
      WHERE product_id = ? AND feedback_status = 'PUBLISHED' AND analysis_status = 'COMPLETED'
      GROUP BY overall_sentiment`,
    [productId]
  );
  const sentimentSummary = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0, MIXED: 0 };
  for (const row of sentimentRows) {
    if (row.overall_sentiment) sentimentSummary[row.overall_sentiment] = row.n;
  }
  const [topAspects] = await pool.query(
    `SELECT a.slug AS aspect, a.display_name,
            CAST(SUM(asp.polarity = 'POSITIVE') AS UNSIGNED) AS positive,
            CAST(SUM(asp.polarity = 'NEGATIVE') AS UNSIGNED) AS negative
       FROM aspect_sentiments asp
       JOIN aspects a ON a.aspect_id = asp.aspect_id
       JOIN sentiment_analysis sa ON sa.analysis_id = asp.analysis_id
       JOIN feedback f ON f.feedback_id = sa.feedback_id
       JOIN ratings r ON r.rating_id = f.rating_id
      WHERE r.product_id = ? AND sa.status = 'COMPLETED' AND f.status = 'PUBLISHED'
      GROUP BY a.aspect_id, a.slug, a.display_name
     HAVING SUM(asp.polarity IN ('POSITIVE', 'NEGATIVE')) > 0
      ORDER BY SUM(asp.polarity IN ('POSITIVE', 'NEGATIVE')) DESC, a.display_name
      LIMIT 8`,
    [productId]
  );

  let myRating = null;
  if (req.user && req.user.role === 'CUSTOMER') {
    const [[row]] = await pool.query(
      `SELECT r.stars, f.title, f.body, f.status AS feedback_status, r.created_at, r.updated_at
         FROM ratings r
         LEFT JOIN feedback f ON f.rating_id = r.rating_id
        WHERE r.user_id = ? AND r.product_id = ?`,
      [req.user.id, productId]
    );
    myRating = row || null;
  }

  const tagsByProduct = await tagSlugsByProduct([productId]);
  await logInteraction(req.user, 'PRODUCT_VIEW', { productId });

  ok(res, {
    product_id: productId,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    description: product.description,
    price: product.price,
    image_url: product.image_url,
    is_active: Boolean(product.is_active),
    category: { category_id: product.category_id, name: product.category_name, slug: product.category_slug },
    tags: tagsByProduct.get(productId) || [],
    ...stats,
    sentiment_summary: sentimentSummary,
    top_aspects: topAspects,
    my_rating: myRating
  });
}));

router.get('/products/:slug/reviews', optionalAuth, validate({ params: { slug }, query: reviewListQuery }), asyncHandler(async (req, res) => {
  const [[product]] = await pool.query('SELECT product_id FROM products WHERE slug = ?', [req.valid.params.slug]);
  if (!product) throw notFound('Product');
  const query = req.valid.query;
  const { limit, offset } = pageParams(query);

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM v_feedback_details WHERE product_id = ? AND feedback_status = 'PUBLISHED'`,
    [product.product_id]
  );
  const [rows] = await pool.query(
    `SELECT vfd.feedback_id, vfd.stars, vfd.title, vfd.body, vfd.created_at, vfd.user_name,
            vfd.analysis_status, vfd.sentiment_label, vfd.confidence, vfd.overall_sentiment, vfd.is_demo
       FROM v_feedback_details vfd
      WHERE vfd.product_id = ? AND vfd.feedback_status = 'PUBLISHED'
      ORDER BY ${REVIEW_SORTS[query.sort]}
      LIMIT ? OFFSET ?`,
    [product.product_id, limit, offset]
  );

  const aspectsByFeedback = new Map();
  if (rows.length) {
    const [aspectRows] = await pool.query(
      `SELECT sa.feedback_id, a.slug AS aspect, a.display_name, asp.polarity
         FROM aspect_sentiments asp
         JOIN aspects a ON a.aspect_id = asp.aspect_id
         JOIN sentiment_analysis sa ON sa.analysis_id = asp.analysis_id
        WHERE sa.feedback_id IN (?) AND sa.status = 'COMPLETED'
        ORDER BY a.display_name`,
      [rows.map((row) => row.feedback_id)]
    );
    for (const row of aspectRows) {
      if (!aspectsByFeedback.has(row.feedback_id)) aspectsByFeedback.set(row.feedback_id, []);
      aspectsByFeedback.get(row.feedback_id).push({ aspect: row.aspect, display_name: row.display_name, polarity: row.polarity });
    }
  }

  ok(res, rows.map((row) => ({
    feedback_id: row.feedback_id,
    stars: row.stars,
    title: row.title,
    body: row.body,
    created_at: row.created_at,
    reviewer: reviewerName(row.user_name),
    analysis_status: row.analysis_status,
    sentiment_label: row.sentiment_label,
    confidence: row.confidence,
    overall_sentiment: row.overall_sentiment,
    is_demo: Boolean(row.is_demo),
    aspects: aspectsByFeedback.get(row.feedback_id) || []
  })), pageMeta(query, total));
}));

module.exports = router;
