const express = require('express');
const { pool } = require('./config/db');
const { ok, ApiError, asyncHandler } = require('./utils/http');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();

app.disable('x-powered-by');

// One line per request: method, path, status, duration. Registered first so that
// requests rejected by the JSON parser are logged too.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[api] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`);
  });
  next();
});

app.use(express.json({ limit: '100kb' }));

app.get('/api/health', asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT DATABASE() AS db');
  ok(res, { status: 'ok', database: row.db, time: new Date().toISOString() });
}));

app.use('/api', routes);

app.use((req, res, next) => next(new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`)));
app.use(errorHandler);

module.exports = app;
