const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn } = require('../config/env');
const { ApiError } = require('../utils/http');

// Presentation scope (00_DECISIONS §0): the JWT is sent as a Bearer token and its
// role/status claims are trusted until it expires. Suspension is enforced at login.

function signToken(user) {
  return jwt.sign({ sub: user.user_id, role: user.role, name: user.full_name }, jwtSecret, { expiresIn: jwtExpiresIn });
}

function readToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    const claims = jwt.verify(token, jwtSecret);
    return { id: Number(claims.sub), role: claims.role, name: claims.name };
  } catch (err) {
    throw new ApiError(401, 'INVALID_TOKEN', 'Your session has expired. Please log in again.');
  }
}

function requireAuth(req, res, next) {
  const user = readToken(req);
  if (!user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Please log in to continue.'));
  req.user = user;
  next();
}

// Public routes that behave differently for a logged-in user (e.g. interaction logging).
function optionalAuth(req, res, next) {
  try {
    req.user = readToken(req);
  } catch (err) {
    req.user = null; // an expired token on a public page is not an error
  }
  next();
}

const requireRole = (role) => (req, res, next) => {
  if (!req.user || req.user.role !== role) {
    return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.'));
  }
  next();
};

module.exports = { signToken, requireAuth, optionalAuth, requireRole };
