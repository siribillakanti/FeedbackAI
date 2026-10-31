const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/', require('./catalog')); // /categories, /products (public)
router.use('/me', requireAuth, requireRole('CUSTOMER'), require('./me'));
router.use('/admin', requireAuth, requireRole('ADMIN'), require('./admin'));

module.exports = router;
