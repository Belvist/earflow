const express = require('express');
const router = express.Router();

const db = require('../lib/database');
const { coerceUserId } = require('../lib/discover/access');
const { normalizeSeed } = require('../lib/discover/seed');
const { buildDiscoverRails } = require('../lib/discover/service');

router.get('/', async (req, res, next) => {
    try {
        const userId = coerceUserId(req.user && req.user.id);
        const seed = normalizeSeed(req.query.seed);

        const result = await buildDiscoverRails(db.pool, { userId, seed });

        res.json(result);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
