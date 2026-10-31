const { z } = require('zod');

// Shared query schema fragment: ?page=1&pageSize=20 (pageSize capped at 100).
const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
};

function pageParams({ page, pageSize }) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

function pageMeta({ page, pageSize }, total) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { paginationQuery, pageParams, pageMeta };
