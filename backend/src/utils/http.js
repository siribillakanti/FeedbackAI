// Response helpers and the error type every route uses.
// Envelope: { success: true, data, meta? } or { success: false, error: { code, message, fields? } }.

class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const notFound = (what) => new ApiError(404, 'NOT_FOUND', `${what} not found`);

function ok(res, data, meta) {
  return res.json(meta ? { success: true, data, meta } : { success: true, data });
}

function created(res, data) {
  return res.status(201).json({ success: true, data });
}

// Express 4 does not catch rejected promises; this forwards them to the error handler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, notFound, ok, created, asyncHandler };
