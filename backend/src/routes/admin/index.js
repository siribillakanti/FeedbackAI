const express = require('express');

// Every route below already passed requireAuth + requireRole('ADMIN') in routes/index.js.
const router = express.Router();

router.use('/users', require('./users'));
router.use('/products', require('./products'));
router.use('/categories', require('./categories'));
router.use('/feedback', require('./feedback'));

module.exports = router;
