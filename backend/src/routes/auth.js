const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { pool, withTransaction } = require('../config/db');
const { bcryptCost } = require('../config/env');
const { asyncHandler, ok, created, ApiError, notFound } = require('../utils/http');
const { validate, id } = require('../middleware/validate');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const USER_COLUMNS = 'user_id, full_name, email, role, status, created_at';

// Compared against when the email is unknown, so both failure paths spend the same bcrypt time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', bcryptCost);

const email =z.string().trim().toLowerCase().email('Enter a valid email address').max(150);

function publicUser(row) {
  const { user_id, full_name, email: mail, role, status, created_at } = row;
  return { user_id, full_name, email: mail, role, status, created_at };
}

async function preferredCategories(userId) {
  const [rows] = await pool.query(
    `SELECT c.category_id, c.name, c.slug
       FROM user_category_preferences ucp
       JOIN categories c ON c.category_id = ucp.category_id
      WHERE ucp.user_id = ?
      ORDER BY c.display_order, c.name`,
    [userId]
  );
  return rows;
}

router.post('/register', validate({
  body: {
    full_name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
    email,
    password: z.string().min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters')
      .refine((value) => Buffer.byteLength(value) <= 72, 'Password must be at most 72 bytes'), // bcrypt ignores bytes after 72
    preferred_category_ids: z.array(id).max(6).default([])
  }
}), asyncHandler(async (req, res) => {
  const { full_name, email: mail, password, preferred_category_ids } = req.valid.body;
  const categoryIds = [...new Set(preferred_category_ids)];
  const passwordHash = await bcrypt.hash(password, bcryptCost);

  let userId;
  try {
    userId = await withTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'CUSTOMER')`,
        [full_name, mail, passwordHash]
      );
      if (categoryIds.length) {
        await conn.query(
          'INSERT INTO user_category_preferences (user_id, category_id) VALUES ?',
          [categoryIds.map((categoryId) => [result.insertId, categoryId])]
        );
      }
      return result.insertId;
    });
  } catch (err) {
    if (err.errno === 1062) throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    if (err.errno === 1216 || err.errno === 1452) throw new ApiError(422, 'INVALID_CATEGORY', 'One of the selected categories does not exist', { preferred_category_ids: 'Unknown category' });
    throw err;
  }

  const [[user]] = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ?`, [userId]);
  created(res, { user: { ...publicUser(user), preferred_categories: await preferredCategories(userId) }, token: signToken(user) });
}));

router.post('/login', validate({
  body: { email, password: z.string().min(1, 'Enter your password').max(72) }
}), asyncHandler(async (req, res) => {
  const { email: mail, password } = req.valid.body;
  const [[user]] = await pool.query(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`, [mail]);
  // Same message and bcrypt work for unknown email and wrong password, so accounts cannot be probed.
  const matches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !matches) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  if (user.status === 'SUSPENDED') {
    throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Please contact an administrator.');
  }
  await pool.query('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE user_id = ?', [user.user_id]);
  ok(res, { user: publicUser(user), token: signToken(user) });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const [[user]] = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ?`, [req.user.id]);
  if (!user) throw notFound('User');
  ok(res, { ...publicUser(user), preferred_categories: await preferredCategories(user.user_id) });
}));

module.exports = router;
