const express = require('express');
const router = express.Router();

const { coerceUserId } = require('../lib/discover/access');
const { resolvePlaylistIdentifier } = require('../lib/resolve/identifier');

router.get('/', async (req, res) => {
    const id = req.query.id ?? req.query.identifier ?? '';
    const userId = coerceUserId(req.user && req.user.id);

    const resolved = resolvePlaylistIdentifier(id, { userId });

    if (resolved.kind === 'numeric') {
        if (!userId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        return res.json({
            kind: 'numeric',
            identifier: String(resolved.numericId),
        });
    }

    if (resolved.kind === 'legacy_discover') {
        const canonical = resolved.idx
            ? `${resolved.baseId}_${resolved.discoverKey}_${resolved.idx}`
            : `${resolved.baseId}_${resolved.discoverKey}`;
        return res.json({
            kind: 'discover',
            identifier: canonical,
            seedBase: resolved.seedBase,
            redirectTo: canonical,
        });
    }

    if (resolved.kind === 'discover') {
        return res.json({ kind: 'discover', identifier: resolved.discoverId });
    }

    if (resolved.kind === 'share_slug') {
        return res.json({ kind: 'share_slug', identifier: resolved.shareSlug });
    }

    if (resolved.kind === 'mix') {
        return res.json({ kind: 'mix', identifier: resolved.mixToken });
    }

    return res.json({ kind: 'unknown', identifier: String(id || '').trim() });
});

module.exports = router;
