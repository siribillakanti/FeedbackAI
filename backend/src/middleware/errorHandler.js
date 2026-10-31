const { ZodError } = require('zod');
const { ApiError } = require('../utils/http');

// MySQL error numbers mapped to HTTP responses (00_DECISIONS 5a.6).
// Internal error text is never sent to the client, except FA_* business-rule messages,
// which are written for users.
function fromMysql(err) {
  switch (err.errno) {
    case 1644: { // SIGNAL SQLSTATE '45000' from a trigger or procedure: "FA_CODE: message"
      const [code, ...rest] = String(err.sqlMessage || '').split(':');
      const message = rest.join(':').trim();
      return new ApiError(422, code.trim() || 'BUSINESS_RULE', message ? message[0].toUpperCase() + message.slice(1) : 'Request violates a business rule');
    }
    case 1062:
      return new ApiError(409, 'DUPLICATE', 'A record with the same unique value already exists.');
    case 1217: // ER_ROW_IS_REFERENCED (older form of 1451)
    case 1451:
      return new ApiError(409, 'IN_USE', 'This record is still referenced by other data and cannot be deleted.');
    case 1216: // ER_NO_REFERENCED_ROW (older form of 1452)
    case 1452:
      return new ApiError(422, 'INVALID_REFERENCE', 'A referenced record does not exist.');
    case 3819:
      return new ApiError(422, 'CONSTRAINT_VIOLATED', 'A value is outside the allowed range.');
    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let apiError = null;
  if (err instanceof ApiError) apiError = err;
  else if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] = issue.message;
    apiError = new ApiError(422, 'VALIDATION_FAILED', 'Some fields are invalid.', fields);
  } else if (err.type === 'entity.parse.failed') apiError = new ApiError(400, 'BAD_JSON', 'Request body is not valid JSON.');
  else if (err.type === 'entity.too.large') apiError = new ApiError(413, 'TOO_LARGE', 'Request body is too large.');
  else if (err.errno) apiError = fromMysql(err);

  if (!apiError) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    apiError = new ApiError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.');
  }

  const body = { code: apiError.code, message: apiError.message };
  if (apiError.fields) body.fields = apiError.fields;
  res.status(apiError.status).json({ success: false, error: body });
}

module.exports = errorHandler;
