const express = require('express');
const { z } = require('zod');
const { pool, withTransaction } = require('../../config/db');
const { ok, created, notFound, ApiError, asyncHandler } = require('../../utils/http');
const { validate, id } = require('../../middleware/validate');
const { slugify, uniqueSlug } = require('../../utils/slug');

const router = express.Router();

const CATEGORY_SELECT = `
  SELECT c.category_id, c.name, c.slug, c.description, c.display_order, c.created_at, c.updated_at,
         COUNT(p.product_id) AS product_count,
         CAST(COALESCE(SUM(p.is_active = 1), 0) AS UNSIGNED) AS active_product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.category_id`;

const categoryName = z.string().trim().min(1).max(60);
const categoryDescription = z.string().trim().max(255).transform((v) => v || null).nullable().optional();
const displayOrder = z.number().int().min(0).max(32767);

const categoryCreate = z.object({
  name: categoryName,
  description: categoryDescription,
  display_order: displayOrder.default(0)
});

const categoryPatch = z.object({
  name: categoryName.optional(),
  description: categoryDescription,
  display_order: displayOrder.optional()
}).refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Send at least one field to change' });

const audit = (conn, actorId, action, categoryId, details) => conn.query(
  'INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
  [actorId, action, 'category', categoryId, details]
);

async function loadCategory(categoryId) {
  const [[row]] = await pool.query(`${CATEGORY_SELECT} WHERE c.category_id = ? GROUP BY c.category_id`, [categoryId]);
  return row ?? null;
}

function nameConflict(err) {
  if (err.errno === 1062) throw new ApiError(409, 'DUPLICATE', 'A category with this name already exists.');
  throw err;
}

function inUseMessage({ products, aspects }) {
  const parts = [];
  if (products) parts.push(`${products} product${products === 1 ? '' : 's'}`);
  if (aspects) parts.push(`${aspects} aspect${aspects === 1 ? '' : 's'}`);
  const advice = products ? ' Move its products to another category first.' : '';
  return `This category is used by ${parts.join(' and ')}, so it can't be deleted.${advice}`;
}

// 1217 is what MySQL 8 reports for a RESTRICT violation here; 1451 is the newer form of it.
function referencedByRecords(err) {
  if (err.errno === 1451 || err.errno === 1217) {
    throw new ApiError(409, 'IN_USE', "This category is still referenced by other data, so it can't be deleted.");
  }
  throw err;
}

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`${CATEGORY_SELECT} GROUP BY c.category_id ORDER BY c.display_order, c.name`);
  ok(res, rows);
}));

router.post('/', validate({ body: categoryCreate }), asyncHandler(async (req, res) => {
  const body = req.valid.body;
  const categoryId = await withTransaction(async (conn) => {
    const slug = await uniqueSlug(conn, 'categories', slugify(body.name, 60));
    const [result] = await conn.query(
      'INSERT INTO categories (name, slug, description, display_order) VALUES (?, ?, ?, ?)',
      [body.name, slug, body.description ?? null, body.display_order]
    );
    await audit(conn, req.user.id, 'CATEGORY_CREATED', result.insertId, body.name);
    return result.insertId;
  }, { actorId: req.user.id }).catch(nameConflict);

  created(res, await loadCategory(categoryId));
}));

// The slug is kept on rename: public URLs use it (/api/categories/:slug).
router.patch('/:id', validate({ params: { id }, body: categoryPatch }), asyncHandler(async (req, res) => {
  const categoryId = req.valid.params.id;
  const fields = Object.fromEntries(Object.entries(req.valid.body).filter(([, value]) => value !== undefined));
  await withTransaction(async (conn) => {
    const [[current]] = await conn.query('SELECT category_id FROM categories WHERE category_id = ? FOR UPDATE', [categoryId]);
    if (!current) throw notFound('Category');
    const keys = Object.keys(fields);
    if (keys.length) {
      await conn.query('UPDATE categories SET ? WHERE category_id = ?', [fields, categoryId]);
      await audit(conn, req.user.id, 'CATEGORY_UPDATED', categoryId, keys.join(', '));
    }
  }, { actorId: req.user.id }).catch(nameConflict);

  ok(res, await loadCategory(categoryId));
}));

router.delete('/:id', validate({ params: { id } }), asyncHandler(async (req, res) => {
  const categoryId = req.valid.params.id;
  await withTransaction(async (conn) => {
    const [[category]] = await conn.query('SELECT slug FROM categories WHERE category_id = ? FOR UPDATE', [categoryId]);
    if (!category) throw notFound('Category');
    const [[usage]] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM products WHERE category_id = ?) AS products,
              (SELECT COUNT(*) FROM aspects WHERE category_id = ?) AS aspects`,
      [categoryId, categoryId]
    );
    if (usage.products || usage.aspects) throw new ApiError(409, 'IN_USE', inUseMessage(usage));
    await conn.query('DELETE FROM categories WHERE category_id = ?', [categoryId]);
    await audit(conn, req.user.id, 'CATEGORY_DELETED', categoryId, category.slug);
  }, { actorId: req.user.id }).catch(referencedByRecords);

  ok(res, { deleted: true });
}));

module.exports = router;
