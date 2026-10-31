// URL slugs for categories, products and tags: lowercase letters, numbers and hyphens
// (matches the chk_*_slug CHECK constraints).
function slugify(text, maxLength = 160) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'item';
}

// Table/column pairs that may be checked for uniqueness. Identifiers cannot be bound as
// parameters, so only these whitelisted names are ever interpolated.
const SLUG_COLUMNS = {
  products: { idColumn: 'product_id' },
  categories: { idColumn: 'category_id' }
};

// Returns base, or base-2, base-3, ... whichever is not yet used by another row.
async function uniqueSlug(conn, table, base, excludeId = null) {
  const { idColumn } = SLUG_COLUMNS[table];
  const [rows] = await conn.query(
    `SELECT slug FROM ${table} WHERE (slug = ? OR slug LIKE ?) AND (? IS NULL OR ${idColumn} <> ?)`,
    [base, `${base}-%`, excludeId, excludeId]
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

module.exports = { slugify, uniqueSlug };
