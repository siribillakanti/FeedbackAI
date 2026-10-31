#!/usr/bin/env node
/**
 * Idempotent demo-data seeder for FeedbackAI.
 *
 *   node scripts/seed.js --db feedback_ai_db                 apply generated/demo-v1.json
 *   node scripts/seed.js --db feedback_ai_db --reseed        replace a batch whose file changed
 *   node scripts/seed.js --db feedback_ai_db --reset demo-v1 remove that batch's rows only
 *   node scripts/seed.js --db feedback_ai_db --sync-aspects  upsert aspects from the lexicon only
 *
 * Every write happens in one transaction. Rows whose seed_batch_id IS NULL
 * (genuine submissions) are never updated or deleted by this script.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_PATH = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: ENV_PATH });

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_FILE = path.join(ROOT, 'database', 'seed', 'generated', 'demo-v1.json');
const LEXICON_FILE = path.join(ROOT, 'ai-service', 'lexicon', 'aspects.json');
const ALLOWED_DBS = new Set(['feedback_ai_db', 'feedback_ai_test_db']);
// Checksum stored on a batch row that was reset but kept because seeded admins still reference it.
const RESET_MARKER = '0'.repeat(64);

class SeedAbort extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { file: DEFAULT_FILE, reseed: false, includeAdmins: false, syncAspects: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db') args.db = argv[++i];
    else if (a === '--file') args.file = path.resolve(argv[++i]);
    else if (a === '--reset') args.reset = argv[++i];
    else if (a === '--reseed') args.reseed = true;
    else if (a === '--include-admins') args.includeAdmins = true;
    else if (a === '--sync-aspects') args.syncAspects = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new SeedAbort(`Unknown argument: ${a}`);
  }
  return args;
}

const USAGE = `Usage: node scripts/seed.js --db <feedback_ai_db|feedback_ai_test_db> [options]
  --file <path>       generated seed file (default database/seed/generated/demo-v1.json)
  --reseed            replace an applied batch whose checksum changed
  --reset <label>     delete that batch's rows only (seeded admins are kept)
  --include-admins    with --reset, also delete seeded admins if a genuine admin exists
  --sync-aspects      upsert the aspects table from ai-service/lexicon/aspects.json and exit`;

// ── helpers ───────────────────────────────────────────────────────────────────

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

// Must match canonical_bytes() in database/seed/generate.py.
function contentChecksum(data) {
  const { content_sha256: _ignored, ...rest } = data;
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(rest)), 'utf8').digest('hex');
}

function loadSeedFile(file) {
  if (!fs.existsSync(file)) {
    throw new SeedAbort(`Seed file not found: ${file}. Run: python3 -I database/seed/generate.py`);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.format !== 'feedbackai-seed/1') throw new SeedAbort(`Unsupported seed format: ${data.format}`);
  const actual = contentChecksum(data);
  if (actual !== data.content_sha256) {
    throw new SeedAbort('Seed file content does not match its content_sha256. Regenerate it with generate.py instead of editing it by hand.');
  }
  return data;
}

function ensureDemoPassword() {
  if (process.env.SEED_DEMO_PASSWORD) return process.env.SEED_DEMO_PASSWORD;
  const generated = `Fa-${crypto.randomBytes(9).toString('base64url')}-7q`;
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const prefix = existing.length && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(ENV_PATH, `${prefix}SEED_DEMO_PASSWORD=${generated}\n`, { mode: 0o600 });
  process.env.SEED_DEMO_PASSWORD = generated;
  console.log('SEED_DEMO_PASSWORD was not set: generated one and saved it to backend/.env (not printed).');
  return generated;
}

async function connect(db) {
  if (!process.env.DB_USER) throw new SeedAbort('DB_USER is not set in backend/.env');
  const config = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3307', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: db,
    timezone: 'Z',
    dateStrings: true,
    charset: 'utf8mb4'
  };
  if (process.env.DB_SOCKET) config.socketPath = process.env.DB_SOCKET;
  const conn = await mysql.createConnection(config);
  await conn.query("SET time_zone = '+00:00'");
  return conn;
}

async function one(conn, sql, params) {
  const [rows] = await conn.execute(sql, params);
  return rows[0] || null;
}

function genuineConflict(what) {
  return new SeedAbort(`${what} already exists as a genuine (non-demo) row. Seed data never overwrites genuine data; aborting with no changes.`, 3);
}

// ── reference data ────────────────────────────────────────────────────────────

async function upsertCategories(conn, categories) {
  const ids = new Map();
  for (const c of categories) {
    const row = await one(conn, 'SELECT category_id FROM categories WHERE slug = ?', [c.slug]);
    if (row) {
      ids.set(c.slug, row.category_id);
      continue;
    }
    const [res] = await conn.execute(
      'INSERT INTO categories (name, slug, description, display_order) VALUES (?, ?, ?, ?)',
      [c.name, c.slug, c.description, c.display_order]
    );
    ids.set(c.slug, res.insertId);
  }
  return ids;
}

async function upsertTags(conn, tags) {
  const ids = new Map();
  for (const t of tags) {
    const row = await one(conn, 'SELECT tag_id FROM tags WHERE slug = ?', [t.slug]);
    if (row) {
      ids.set(t.slug, row.tag_id);
      continue;
    }
    const [res] = await conn.execute('INSERT INTO tags (name, slug) VALUES (?, ?)', [t.name, t.slug]);
    ids.set(t.slug, res.insertId);
  }
  return ids;
}

// The lexicon is the single source of truth for aspects, so existing rows are updated.
async function upsertAspects(conn) {
  const lexicon = JSON.parse(fs.readFileSync(LEXICON_FILE, 'utf8'));
  let count = 0;
  for (const a of lexicon.aspects) {
    let categoryId = null;
    if (a.category) {
      const row = await one(conn, 'SELECT category_id FROM categories WHERE slug = ?', [a.category]);
      if (!row) throw new SeedAbort(`Aspect ${a.slug} refers to missing category ${a.category}`);
      categoryId = row.category_id;
    }
    await conn.execute(
      `INSERT INTO aspects (slug, display_name, category_id) VALUES (?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE display_name = new.display_name, category_id = new.category_id`,
      [a.slug, a.display_name, categoryId]
    );
    count += 1;
  }
  return { version: lexicon.version, count };
}

// ── batch rows ────────────────────────────────────────────────────────────────

async function upsertProducts(conn, products, batchId, categoryIds, tagIds) {
  const ids = new Map();
  for (const p of products) {
    const categoryId = categoryIds.get(p.category);
    const row = await one(conn, 'SELECT product_id, seed_batch_id FROM products WHERE slug = ?', [p.slug]);
    let productId;
    if (row) {
      if (row.seed_batch_id === null) throw genuineConflict(`Product ${p.slug}`);
      productId = row.product_id;
      // Re-activate for the duration of the transaction; archiving happens after ratings exist.
      await conn.execute(
        `UPDATE products SET category_id = ?, name = ?, brand = ?, description = ?, price = ?,
                image_url = ?, is_active = 1, updated_at = created_at
          WHERE product_id = ?`,
        [categoryId, p.name, p.brand, p.description, p.price, p.image_url, productId]
      );
    } else {
      const [res] = await conn.execute(
        `INSERT INTO products (category_id, name, slug, brand, description, price, image_url,
                               is_active, seed_batch_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [categoryId, p.name, p.slug, p.brand, p.description, p.price, p.image_url, batchId, p.created_at, p.created_at]
      );
      productId = res.insertId;
    }
    ids.set(p.slug, productId);
    for (const tag of p.tags) {
      await conn.execute(
        'INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE product_id = product_id',
        [productId, tagIds.get(tag)]
      );
    }
  }
  return ids;
}

async function upsertUsers(conn, users, batchId, categoryIds, hashes) {
  const ids = new Map();
  for (const u of users) {
    const row = await one(conn, 'SELECT user_id, seed_batch_id FROM users WHERE email = ?', [u.email]);
    let userId;
    if (row) {
      if (row.seed_batch_id === null) throw genuineConflict(`User ${u.email}`);
      userId = row.user_id;
      // password_hash is never rewritten on a re-run. Status is restored to ACTIVE so the
      // rating triggers accept this batch's ratings; suspension is re-applied at the end.
      if (u.role === 'CUSTOMER') {
        await conn.execute('UPDATE users SET full_name = ?, status = ? WHERE user_id = ?', [u.full_name, 'ACTIVE', userId]);
      } else {
        await conn.execute('UPDATE users SET full_name = ? WHERE user_id = ?', [u.full_name, userId]);
      }
    } else {
      const [res] = await conn.execute(
        `INSERT INTO users (full_name, email, password_hash, role, status, seed_batch_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        [u.full_name, u.email, hashes.get(u.email), u.role, batchId, u.created_at, u.created_at]
      );
      userId = res.insertId;
    }
    ids.set(u.email, userId);
    for (const pref of u.preferences) {
      await conn.execute(
        `INSERT INTO user_category_preferences (user_id, category_id, created_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = user_id`,
        [userId, categoryIds.get(pref.category), pref.created_at]
      );
    }
  }
  return ids;
}

async function upsertRatings(conn, ratings, batchId, userIds, productIds) {
  const feedbackIds = new Map();
  let reviews = 0;
  for (const r of ratings) {
    const userId = userIds.get(r.user);
    const productId = productIds.get(r.product);
    const row = await one(conn, 'SELECT rating_id, seed_batch_id FROM ratings WHERE user_id = ? AND product_id = ?', [userId, productId]);
    let ratingId;
    if (row) {
      if (row.seed_batch_id === null) throw genuineConflict(`Rating by ${r.user} on ${r.product}`);
      ratingId = row.rating_id;
      await conn.execute('UPDATE ratings SET stars = ?, created_at = ?, updated_at = ? WHERE rating_id = ?',
        [r.stars, r.created_at, r.updated_at, ratingId]);
    } else {
      const [res] = await conn.execute(
        `INSERT INTO ratings (user_id, product_id, stars, seed_batch_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, productId, r.stars, batchId, r.created_at, r.updated_at]
      );
      ratingId = res.insertId;
    }
    if (!r.review) continue;
    const rv = r.review;
    const fb = await one(conn, 'SELECT feedback_id, seed_batch_id FROM feedback WHERE rating_id = ?', [ratingId]);
    let feedbackId;
    if (fb) {
      if (fb.seed_batch_id === null) throw genuineConflict(`Review by ${r.user} on ${r.product}`);
      feedbackId = fb.feedback_id;
      await conn.execute('UPDATE feedback SET title = ?, body = ?, created_at = ?, updated_at = ? WHERE feedback_id = ?',
        [rv.title, rv.body, rv.created_at, rv.updated_at, feedbackId]);
    } else {
      // trg_feedback_after_insert creates the PENDING sentiment_analysis row.
      const [res] = await conn.execute(
        `INSERT INTO feedback (rating_id, title, body, status, seed_batch_id, created_at, updated_at)
         VALUES (?, ?, ?, 'PUBLISHED', ?, ?, ?)`,
        [ratingId, rv.title, rv.body, batchId, rv.created_at, rv.updated_at]
      );
      feedbackId = res.insertId;
    }
    feedbackIds.set(`${r.user}|${r.product}`, feedbackId);
    reviews += 1;
  }
  return { feedbackIds, reviews };
}

async function replaceInteractions(conn, interactions, batchId, userIds, productIds, categoryIds) {
  await conn.execute('DELETE FROM user_interactions WHERE seed_batch_id = ?', [batchId]);
  const rows = interactions.map((i) => [
    userIds.get(i.user),
    i.type,
    i.product ? productIds.get(i.product) : null,
    i.category ? categoryIds.get(i.category) : null,
    i.query,
    batchId,
    i.at
  ]);
  for (let start = 0; start < rows.length; start += 250) {
    await conn.query(
      `INSERT INTO user_interactions
         (user_id, interaction_type, product_id, category_id, search_query, seed_batch_id, occurred_at)
       VALUES ?`,
      [rows.slice(start, start + 250)]
    );
  }
  return rows.length;
}

async function applyStateChanges(conn, data, ids) {
  // Moderation as real UPDATEs so trg_feedback_after_update writes the audit rows.
  for (const m of data.moderation) {
    const feedbackId = ids.feedbackIds.get(`${m.user}|${m.product}`);
    const actorId = ids.userIds.get(m.actor);
    await conn.query('SET @app_actor_id = ?', [actorId]);
    try {
      await conn.execute(
        `UPDATE feedback SET status = ?, moderated_by = ?, moderated_at = ?, moderation_note = ?, updated_at = updated_at
          WHERE feedback_id = ?`,
        [m.status, actorId, m.moderated_at, m.note, feedbackId]
      );
    } finally {
      await conn.query('SET @app_actor_id = NULL');
    }
  }
  // Archive and suspend only after the ratings exist (the rating triggers reject both).
  for (const p of data.products.filter((x) => x.archived_at)) {
    await conn.execute('UPDATE products SET is_active = 0, updated_at = ? WHERE product_id = ?', [p.archived_at, ids.productIds.get(p.slug)]);
  }
  for (const u of data.users.filter((x) => x.status === 'SUSPENDED')) {
    await conn.execute("UPDATE users SET status = 'SUSPENDED', updated_at = ? WHERE user_id = ?",
      [u.suspended_at || u.created_at, ids.userIds.get(u.email)]);
  }
}

// ── reset ─────────────────────────────────────────────────────────────────────

async function resetBatchRows(conn, batchId, { includeAdmins = false } = {}) {
  const summary = {};
  let [res] = await conn.execute('DELETE FROM user_interactions WHERE seed_batch_id = ?', [batchId]);
  summary.interactions = res.affectedRows;
  // Audit rows written by the moderation trigger for demo feedback; otherwise a reseed replays them twice.
  [res] = await conn.execute(
    "DELETE FROM audit_log WHERE entity_type = 'feedback' AND entity_id IN (SELECT feedback_id FROM feedback WHERE seed_batch_id = ?)",
    [batchId]
  );
  summary.audit_rows = res.affectedRows;
  // Cascades to feedback -> sentiment_analysis -> aspect_sentiments.
  [res] = await conn.execute('DELETE FROM ratings WHERE seed_batch_id = ?', [batchId]);
  summary.ratings = res.affectedRows;
  // Cascades to preferences, recommendation runs and anything these demo accounts did live.
  [res] = await conn.execute("DELETE FROM users WHERE seed_batch_id = ? AND role = 'CUSTOMER'", [batchId]);
  summary.customers = res.affectedRows;
  summary.admins = 0;
  if (includeAdmins) {
    const genuine = await one(conn,
      "SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND seed_batch_id IS NULL", []);
    if (genuine.n > 0) {
      [res] = await conn.execute("DELETE FROM users WHERE seed_batch_id = ? AND role = 'ADMIN'", [batchId]);
      summary.admins = res.affectedRows;
    } else {
      console.log('Kept seeded admins: no genuine active admin exists.');
    }
  }
  const [deletable] = await conn.execute(
    `SELECT p.product_id FROM products p
      WHERE p.seed_batch_id = ?
        AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.product_id = p.product_id)
        AND NOT EXISTS (SELECT 1 FROM user_interactions i WHERE i.product_id = p.product_id)`,
    [batchId]
  );
  summary.products = 0;
  for (const { product_id: productId } of deletable) {
    await conn.execute('DELETE FROM products WHERE product_id = ?', [productId]);
    summary.products += 1;
  }
  const [kept] = await conn.execute('SELECT slug FROM products WHERE seed_batch_id = ?', [batchId]);
  if (kept.length) console.log(`Kept ${kept.length} demo product(s) still referenced by genuine rows: ${kept.map((k) => k.slug).join(', ')}`);
  return summary;
}

async function batchReferenceCount(conn, batchId) {
  const row = await one(conn,
    `SELECT (SELECT COUNT(*) FROM users WHERE seed_batch_id = ?) + (SELECT COUNT(*) FROM products WHERE seed_batch_id = ?)
          + (SELECT COUNT(*) FROM ratings WHERE seed_batch_id = ?) + (SELECT COUNT(*) FROM feedback WHERE seed_batch_id = ?)
          + (SELECT COUNT(*) FROM user_interactions WHERE seed_batch_id = ?) AS n`,
    [batchId, batchId, batchId, batchId, batchId]);
  return Number(row.n);
}

async function runReset(conn, label, includeAdmins) {
  await conn.beginTransaction();
  const batch = await one(conn, 'SELECT seed_batch_id FROM seed_batches WHERE label = ? FOR UPDATE', [label]);
  if (!batch) {
    await conn.commit();
    console.log(`No batch '${label}' found; nothing to reset.`);
    return;
  }
  const summary = await resetBatchRows(conn, batch.seed_batch_id, { includeAdmins });
  if ((await batchReferenceCount(conn, batch.seed_batch_id)) === 0) {
    await conn.execute('DELETE FROM seed_batches WHERE seed_batch_id = ?', [batch.seed_batch_id]);
    summary.batch_row = 'deleted';
  } else {
    // Seeded admins still point at the row, so it stays. Clear its checksum so the
    // next apply re-inserts the demo rows instead of reporting "already applied".
    await conn.execute('UPDATE seed_batches SET content_sha256 = ? WHERE seed_batch_id = ?', [RESET_MARKER, batch.seed_batch_id]);
    summary.batch_row = 'kept (still referenced), marked as reset';
  }
  await conn.commit();
  console.log(`Reset '${label}':`, summary);
}

// ── apply ─────────────────────────────────────────────────────────────────────

async function hashMissingUsers(conn, users) {
  const [existing] = await conn.query('SELECT email FROM users WHERE email IN (?)', [users.map((u) => u.email)]);
  const have = new Set(existing.map((r) => r.email));
  const missing = users.filter((u) => !have.has(u.email));
  const hashes = new Map();
  if (!missing.length) return hashes;
  const password = ensureDemoPassword();
  const cost = parseInt(process.env.BCRYPT_COST || '12', 10);
  for (const u of missing) hashes.set(u.email, await bcrypt.hash(password, cost));
  return hashes;
}

async function runApply(conn, data, { reseed }) {
  const b = data.batch;
  const pre = await one(conn, 'SELECT content_sha256 FROM seed_batches WHERE label = ?', [b.label]);
  if (pre && pre.content_sha256 === data.content_sha256) {
    console.log(`${b.label} already applied (checksum ${data.content_sha256.slice(0, 12)}…); nothing to do.`);
    return;
  }
  if (pre && pre.content_sha256 !== RESET_MARKER && !reseed) {
    throw new SeedAbort(`${b.label} was applied from a different file. Re-run with --reseed to replace the demo rows (genuine rows are never touched).`, 2);
  }
  const hashes = await hashMissingUsers(conn, data.users);

  await conn.beginTransaction();
  const batch = await one(conn, 'SELECT seed_batch_id, content_sha256 FROM seed_batches WHERE label = ? FOR UPDATE', [b.label]);
  let batchId;
  if (batch && batch.content_sha256 === data.content_sha256) {
    await conn.commit();
    console.log(`${b.label} already applied; nothing to do.`);
    return;
  }
  if (batch) {
    if (!reseed && batch.content_sha256 !== RESET_MARKER) throw new SeedAbort(`${b.label} changed while seeding; re-run with --reseed.`, 2);
    batchId = batch.seed_batch_id;
    const summary = await resetBatchRows(conn, batchId);
    console.log('Reseed: removed previous demo rows', summary);
    await conn.execute(
      'UPDATE seed_batches SET generator_version = ?, rng_seed = ?, content_sha256 = ?, description = ? WHERE seed_batch_id = ?',
      [b.generator_version, b.rng_seed, data.content_sha256, b.description, batchId]
    );
    // Users that survived the reset (seeded admins) keep their existing hashes.
  } else {
    const [res] = await conn.execute(
      'INSERT INTO seed_batches (label, generator_version, rng_seed, content_sha256, description) VALUES (?, ?, ?, ?, ?)',
      [b.label, b.generator_version, b.rng_seed, data.content_sha256, b.description]
    );
    batchId = res.insertId;
  }
  // Customers deleted by a reseed need fresh hashes.
  for (const u of data.users) {
    if (!hashes.has(u.email)) {
      const exists = await one(conn, 'SELECT user_id FROM users WHERE email = ?', [u.email]);
      if (!exists) hashes.set(u.email, await bcrypt.hash(ensureDemoPassword(), parseInt(process.env.BCRYPT_COST || '12', 10)));
    }
  }

  const categoryIds = await upsertCategories(conn, data.categories);
  const tagIds = await upsertTags(conn, data.tags);
  const aspects = await upsertAspects(conn);
  const productIds = await upsertProducts(conn, data.products, batchId, categoryIds, tagIds);
  const userIds = await upsertUsers(conn, data.users, batchId, categoryIds, hashes);
  const { feedbackIds, reviews } = await upsertRatings(conn, data.ratings, batchId, userIds, productIds);
  const interactions = await replaceInteractions(conn, data.interactions, batchId, userIds, productIds, categoryIds);
  await applyStateChanges(conn, data, { feedbackIds, userIds, productIds });
  await conn.commit();

  console.log(`Applied ${b.label} (seed_batch_id ${batchId}, checksum ${data.content_sha256.slice(0, 12)}…):`);
  console.log(`  categories ${categoryIds.size}, tags ${tagIds.size}, aspects ${aspects.count} (${aspects.version}), products ${productIds.size}`);
  console.log(`  users ${userIds.size}, ratings ${data.ratings.length}, reviews ${reviews}, interactions ${interactions}, moderation ${data.moderation.length}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (process.env.NODE_ENV === 'production') throw new SeedAbort('Refusing to seed demo data with NODE_ENV=production.');
  if (!args.db || !ALLOWED_DBS.has(args.db)) {
    throw new SeedAbort(`--db must be one of: ${[...ALLOWED_DBS].join(', ')}\n${USAGE}`);
  }
  const data = args.reset || args.syncAspects ? null : loadSeedFile(args.file);
  const conn = await connect(args.db);
  try {
    if (args.syncAspects) {
      await conn.beginTransaction();
      const result = await upsertAspects(conn);
      await conn.commit();
      console.log(`Synced ${result.count} aspects from ${result.version}.`);
    } else if (args.reset) {
      await runReset(conn, args.reset, args.includeAdmins);
    } else {
      await runApply(conn, data, { reseed: args.reseed });
    }
    return 0;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* no open transaction */ }
    throw err;
  } finally {
    try { await conn.query('SET @app_actor_id = NULL'); } catch (_) { /* connection already closed */ }
    await conn.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof SeedAbort) {
      console.error(`seed: ${err.message}`);
      process.exit(err.exitCode);
    }
    console.error(`seed failed and was rolled back: ${err.code ? `${err.code}: ` : ''}${err.message}`);
    process.exit(1);
  });
