const express = require('express');
const { z } = require('zod');
const { pool, withTransaction } = require('../../config/db');
const { ok, created, notFound, ApiError, asyncHandler } = require('../../utils/http');
const { validate, id } = require('../../middleware/validate');
const { paginationQuery, pageParams, pageMeta } = require('../../utils/pagination');
const { slugify, uniqueSlug } = require('../../utils/slug');

const router = express.Router();

const SORTS = {
  newest: 'p.created_at DESC, p.product_id DESC',
  oldest: 'p.created_at ASC, p.product_id ASC',
  name: 'p.name ASC, p.product_id ASC',
  price_asc: 'p.price ASC, p.product_id ASC',
  price_desc: 'p.price DESC, p.product_id ASC',
  rating: 'prs.bayes_rating DESC, p.product_id ASC',
  most_rated: 'prs.rating_count DESC, p.product_id ASC'
};

const PRODUCT_SELECT = `
  SELECT p.product_id, p.category_id, c.name AS category_name, c.slug AS category_slug,
         p.name, p.slug, p.brand, p.description, p.price, p.image_url, p.is_active,
         (p.seed_batch_id IS NOT NULL) AS is_demo, p.created_at, p.updated_at,
         prs.rating_count, prs.avg_rating, prs.bayes_rating,
         prs.stars_1, prs.stars_2, prs.stars_3, prs.stars_4, prs.stars_5
    FROM products p
    JOIN categories c ON c.category_id = p.category_id
    JOIN v_product_rating_stats prs ON prs.product_id = p.product_id`;

const tagName = z.string().trim().min(1).max(40).regex(/[a-z0-9]/i, 'Tags need a letter or number');
const imageUrl = z.string().trim().max(255)
  .regex(/^(https?:\/\/\S+)?$/i, 'Use an http or https URL')
  .transform((v) => v || null)
  .nullable()
  .optional();
const productName = z.string().trim().min(1).max(150);
const productBrand = z.string().trim().min(1).max(80);
const productDescription = z.string().trim().min(1).max(5000);
const productPrice = z.number().positive().max(99999999.99);
const productTags = z.array(tagName).max(20);

const productCreate = z.object({
  category_id: id,
  name: productName,
  brand: productBrand,
  description: productDescription,
  price: productPrice,
  image_url: imageUrl,
  is_active: z.boolean().default(true),
  tags: productTags.default([])
});

const productPatch = z.object({
  category_id: id.optional(),
  name: productName.optional(),
  brand: productBrand.optional(),
  description: productDescription.optional(),
  price: productPrice.optional(),
  image_url: imageUrl,
  is_active: z.boolean().optional(),
  tags: productTags.optional()
}).refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Send at least one field to change' });

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

const audit = (conn, actorId, action, productId, details) => conn.query(
  'INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
  [actorId, action, 'product', productId, details]
);

const toProduct = (row) => ({ ...row, is_active: Boolean(row.is_active), is_demo: Boolean(row.is_demo) });

async function withTags(rows) {
  const tags = new Map(rows.map((row) => [row.product_id, []]));
  if (rows.length) {
    const [links] = await pool.query(
      `SELECT pt.product_id, t.tag_id, t.name, t.slug
         FROM product_tags pt
         JOIN tags t ON t.tag_id = pt.tag_id
        WHERE pt.product_id IN (?)
        ORDER BY t.name`,
      [rows.map((row) => row.product_id)]
    );
    for (const link of links) tags.get(link.product_id).push({ tag_id: link.tag_id, name: link.name, slug: link.slug });
  }
  return rows.map((row) => toProduct({ ...row, tags: tags.get(row.product_id) }));
}

async function loadProduct(productId) {
  const [rows] = await pool.query(`${PRODUCT_SELECT} WHERE p.product_id = ?`, [productId]);
  return rows.length ? (await withTags(rows))[0] : null;
}

// Inserts missing tags keyed by slug and returns the ids of all of them, existing or new.
async function upsertTags(conn, names) {
  const bySlug = new Map(names.map((name) => [slugify(name, 50), name]));
  const ids = [];
  for (const [slug, name] of bySlug) {
    const [result] = await conn.query(
      'INSERT INTO tags (name, slug) VALUES (?, ?) ON DUPLICATE KEY UPDATE tag_id = LAST_INSERT_ID(tag_id)',
      [name, slug]
    );
    ids.push(result.insertId);
  }
  return [...new Set(ids)];
}

async function setTags(conn, productId, names) {
  await conn.query('DELETE FROM product_tags WHERE product_id = ?', [productId]);
  const tagIds = await upsertTags(conn, names);
  if (tagIds.length) {
    await conn.query('INSERT INTO product_tags (product_id, tag_id) VALUES ?', [tagIds.map((tagId) => [productId, tagId])]);
  }
}

function brandNameConflict(err) {
  if (err.errno === 1062) throw new ApiError(409, 'DUPLICATE', 'A product with this brand and name already exists.');
  throw err;
}

// 1217 is what MySQL 8 reports for a RESTRICT violation here; 1451 is the newer form of it.
function referencedByRecords(err) {
  if (err.errno === 1451 || err.errno === 1217) {
    throw new ApiError(409, 'IN_USE', "This product has ratings or activity, so it can't be deleted. Archive it instead.");
  }
  throw err;
}

router.get('/', validate({
  query: {
    q: z.string().trim().max(100).optional(),
    category_id: id.optional(),
    active: z.enum(['true', 'false', 'all']).default('all'),
    sort: z.enum(Object.keys(SORTS)).default('newest'),
    ...paginationQuery
  }
}), asyncHandler(async (req, res) => {
  const { q, category_id, active, sort } = req.valid.query;
  const where = [];
  const params = [];
  if (q) {
    const term = `%${escapeLike(q)}%`;
    where.push('(p.name LIKE ? OR p.brand LIKE ?)');
    params.push(term, term);
  }
  if (category_id) { where.push('p.category_id = ?'); params.push(category_id); }
  if (active !== 'all') { where.push('p.is_active = ?'); params.push(active === 'true' ? 1 : 0); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { limit, offset } = pageParams(req.valid.query);

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM products p ${whereSql}`, params);
  const [rows] = await pool.query(
    `${PRODUCT_SELECT} ${whereSql} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  ok(res, await withTags(rows), pageMeta(req.valid.query, total));
}));

router.get('/:id', validate({ params: { id } }), asyncHandler(async (req, res) => {
  const product = await loadProduct(req.valid.params.id);
  if (!product) throw notFound('Product');
  ok(res, product);
}));

router.post('/', validate({ body: productCreate }), asyncHandler(async (req, res) => {
  const body = req.valid.body;
  const productId = await withTransaction(async (conn) => {
    const slug = await uniqueSlug(conn, 'products', slugify(`${body.brand} ${body.name}`, 160));
    const [result] = await conn.query(
      `INSERT INTO products (category_id, name, slug, brand, description, price, image_url, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [body.category_id, body.name, slug, body.brand, body.description, body.price, body.image_url ?? null, body.is_active]
    );
    await setTags(conn, result.insertId, body.tags);
    await audit(conn, req.user.id, 'PRODUCT_CREATED', result.insertId, slug);
    return result.insertId;
  }, { actorId: req.user.id }).catch(brandNameConflict);

  created(res, await loadProduct(productId));
}));

router.patch('/:id', validate({ params: { id }, body: productPatch }), asyncHandler(async (req, res) => {
  const productId = req.valid.params.id;
  const { tags, ...columns } = req.valid.body;
  const fields = Object.fromEntries(Object.entries(columns).filter(([, value]) => value !== undefined));
  await withTransaction(async (conn) => {
    const [[current]] = await conn.query('SELECT product_id FROM products WHERE product_id = ? FOR UPDATE', [productId]);
    if (!current) throw notFound('Product');
    if (Object.keys(fields).length) await conn.query('UPDATE products SET ? WHERE product_id = ?', [fields, productId]);
    if (tags !== undefined) await setTags(conn, productId, tags);
    const changed = [...Object.keys(fields), ...(tags !== undefined ? ['tags'] : [])];
    if (changed.length) await audit(conn, req.user.id, 'PRODUCT_UPDATED', productId, changed.join(', '));
  }, { actorId: req.user.id }).catch(brandNameConflict);

  ok(res, await loadProduct(productId));
}));

router.delete('/:id', validate({ params: { id } }), asyncHandler(async (req, res) => {
  const productId = req.valid.params.id;
  await withTransaction(async (conn) => {
    const [[product]] = await conn.query('SELECT slug FROM products WHERE product_id = ? FOR UPDATE', [productId]);
    if (!product) throw notFound('Product');
    // Ratings, interactions and recommendations reference products with RESTRICT or CASCADE;
    // a RESTRICT hit (errno 1451) rolls back and is reported as 409.
    await conn.query('DELETE FROM products WHERE product_id = ?', [productId]);
    await audit(conn, req.user.id, 'PRODUCT_DELETED', productId, product.slug);
  }, { actorId: req.user.id }).catch(referencedByRecords);

  ok(res, { deleted: true });
}));

module.exports = router;
