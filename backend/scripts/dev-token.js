// Prints a JWT for an existing user so API routes can be exercised with curl during
// development without typing demo passwords. Refuses to run in production.
//   node scripts/dev-token.js meera.krishnan@demo.feedbackai.test
const { nodeEnv } = require('../src/config/env');
const { pool } = require('../src/config/db');
const { signToken } = require('../src/middleware/auth');

async function main() {
  if (nodeEnv === 'production') throw new Error('dev-token is disabled in production');
  const email = process.argv[2];
  if (!email) throw new Error('usage: node scripts/dev-token.js <email>');
  const [[user]] = await pool.query('SELECT user_id, full_name, role FROM users WHERE email = ?', [email]);
  if (!user) throw new Error(`no user with email ${email}`);
  console.log(signToken(user));
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
