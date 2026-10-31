const { z } = require('zod');

// validate({ body, query, params }) parses each part with its zod schema and stores the
// parsed values on req.valid.body / req.valid.query / req.valid.params.
// Parse failures reach the error handler as ZodError and become 422 responses.
function validate(schemas) {
  const parsers = Object.fromEntries(
    Object.entries(schemas).map(([part, shape]) => [part, shape instanceof z.ZodType ? shape : z.object(shape)])
  );
  return (req, res, next) => {
    req.valid = req.valid || {};
    for (const [part, parser] of Object.entries(parsers)) {
      req.valid[part] = parser.parse(req[part] ?? {});
    }
    next();
  };
}

// Common field schemas.
const id = z.coerce.number().int().positive();
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens').max(170);

module.exports = { validate, id, slug };
