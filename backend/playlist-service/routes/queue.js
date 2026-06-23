/**
 * Queue Routes
 * Playback queue management with shuffle support
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/database');
const { normalizeSongForClient } = require('./playlistNormalize');

const LIBRARY_USER_ID = (() => {
    const n = Number.parseInt(String(process.env.LIBRARY_USER_ID || '1'), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
})();

function parseStrictPositiveInt(value) {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (!s || !/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parseStrictNonNegativeInt(value) {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (!s || !/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function parsePositiveInt(value) {
    return parseStrictPositiveInt(value);
}

function canAccessSong(requestUserId, requestIsAdmin, song) {
    const reqId = parsePositiveInt(requestUserId);
    if (!reqId || !song || typeof song !== 'object') return false;
    if (requestIsAdmin === true) return true;

    const ownerId = parsePositiveInt(song.user_id ?? song.userId ?? song.uploader_id ?? song.uploaderId);
    if (ownerId && ownerId === reqId) return true;
    if (ownerId === LIBRARY_USER_ID) return true;
    return false;
}

function filterTracksForUser(tracks, requestUserId, requestIsAdmin) {
    const items = Array.isArray(tracks) ? tracks : [];
    return items.filter((t) => canAccessSong(requestUserId, requestIsAdmin, t));
}

// ============================================================================
// SHUFFLE ALGORITHM
// ============================================================================

/**
 * Fisher-Yates shuffle algorithm
 * Creates a shuffled order of indices
 */
function shuffleArray(length, currentIndex = 0) {
    const indices = Array.from({ length }, (_, i) => i);

    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    // Ensure current track is first in shuffle order
    if (currentIndex >= 0 && currentIndex < length) {
        const currentPos = indices.indexOf(currentIndex);
        if (currentPos !== 0) {
            [indices[0], indices[currentPos]] = [indices[currentPos], indices[0]];
        }
    }

    return indices;
}

/**
 * Get next track index based on queue state
 */
function getNextIndex(currentIndex, queueLength, repeatMode, shuffleEnabled, shuffleOrder) {
    if (queueLength === 0) return -1;

    if (repeatMode === 'one') {
        return currentIndex;
    }

    if (shuffleEnabled && shuffleOrder && shuffleOrder.length > 0) {
        const currentShufflePos = shuffleOrder.indexOf(currentIndex);
        const nextShufflePos = currentShufflePos + 1;

        if (nextShufflePos >= shuffleOrder.length) {
            if (repeatMode === 'all') {
                return shuffleOrder[0];
            }
            return -1; // End of queue
        }

        return shuffleOrder[nextShufflePos];
    }

    const nextIndex = currentIndex + 1;

    if (nextIndex >= queueLength) {
        if (repeatMode === 'all') {
            return 0;
        }
        return -1; // End of queue
    }

    return nextIndex;
}

/**
 * Get previous track index
 */
function getPreviousIndex(currentIndex, queueLength, shuffleEnabled, shuffleOrder) {
    if (queueLength === 0) return -1;

    if (shuffleEnabled && shuffleOrder && shuffleOrder.length > 0) {
        const currentShufflePos = shuffleOrder.indexOf(currentIndex);
        const prevShufflePos = currentShufflePos - 1;

        if (prevShufflePos < 0) {
            return shuffleOrder[shuffleOrder.length - 1];
        }

        return shuffleOrder[prevShufflePos];
    }

    const prevIndex = currentIndex - 1;
    return prevIndex < 0 ? queueLength - 1 : prevIndex;
}

// ============================================================================
// QUEUE ROUTES
// ============================================================================

/**
 * GET /api/queue
 * Get current user's queue with state
 */
router.get('/', async (req, res, next) => {
    try {
        const userId = req.user.id;

        const [queue, state] = await Promise.all([
            db.getUserQueue(userId),
            db.getQueueState(userId)
        ]);

        const filteredQueue = filterTracksForUser(queue, userId, req.user.isAdmin === true);
        const normalizedQueue = filteredQueue.map(normalizeSongForClient);
        let currentIndex = state.current_index || 0;
        if (currentIndex < 0) currentIndex = 0;
        if (filteredQueue.length === 0) {
            currentIndex = 0;
        } else if (currentIndex >= filteredQueue.length) {
            currentIndex = Math.min(filteredQueue.length - 1, 0);
        }

        if ((state.current_index || 0) !== currentIndex) {
            db.updateQueueState(userId, { current_index: currentIndex }).catch(() => { });
        }

        res.json({
            tracks: normalizedQueue,
            state: {
                currentIndex,
                shuffleEnabled: state.shuffle_enabled || false,
                repeatMode: state.repeat_mode || 'off',
                sourceType: state.source_type,
                sourceId: state.source_id
            },
            totalTracks: filteredQueue.length
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/queue/set
 * Set entire queue from playlist or array of song IDs
 */
router.post('/set', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { song_ids, playlist_id, start_index } = req.body;

        let songIds = [];
        let sourceType = 'manual';
        let sourceId = null;

        // From playlist
        if (playlist_id) {
            const playlistId = Number.parseInt(playlist_id, 10);
            if (!Number.isFinite(playlistId) || playlistId <= 0) {
                return res.status(400).json({ error: 'Некорректный ID плейлиста' });
            }

            const playlist = await db.getPlaylistById(playlistId, userId);
            if (!playlist) {
                return res.status(404).json({ error: 'Плейлист не найден' });
            }
            if (Number(playlist.user_id) !== Number(userId)) {
                return res.status(404).json({ error: 'Плейлист не найден' });
            }

            const tracks = await db.getPlaylistTracks(playlistId, { limit: 1000 });
            const accessible = filterTracksForUser(tracks, userId, req.user.isAdmin === true);
            songIds = accessible.map(t => t.id);
            sourceType = 'playlist';
            sourceId = playlistId;
        }
        // From array of IDs
        else if (song_ids && Array.isArray(song_ids)) {
            const requested = song_ids
                .map((id) => parseStrictPositiveInt(id))
                .filter((id) => id !== null);

            const songs = await db.getSongsByIds(requested);
            const accessible = filterTracksForUser(songs, userId, req.user.isAdmin === true);
            const accessibleIds = new Set(accessible.map((s) => s.id));
            songIds = requested.filter((id) => accessibleIds.has(id));
        }

        if (songIds.length === 0) {
            return res.status(403).json({ error: 'Нет доступных треков для добавления в очередь' });
        }

        await db.setQueue(userId, songIds, sourceType, sourceId);

        // Set start index if provided
        const startIdx = parseStrictNonNegativeInt(start_index) ?? 0;
        const clampedStart = Math.max(0, Math.min(startIdx, Math.max(0, songIds.length - 1)));
        if (clampedStart !== 0) {
            await db.updateQueueState(userId, { current_index: clampedStart });
        }

        res.json({
            success: true,
            totalTracks: songIds.length,
            currentIndex: clampedStart,
            sourceType,
            sourceId
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/queue/add
 * Add track to queue
 */
router.post('/add', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { song_id, position, play_next } = req.body;

        const songId = parseStrictPositiveInt(song_id);
        if (!songId) {
            return res.status(400).json({ error: 'Некорректный ID трека' });
        }

        const songs = await db.getSongsByIds([songId]);
        const song = songs && songs.length ? songs[0] : null;
        if (!canAccessSong(userId, song)) {
            return res.status(403).json({ error: 'Доступ к треку запрещён' });
        }

        let insertPosition = null;

        // Play next = insert after current
        if (play_next) {
            const state = await db.getQueueState(userId);
            insertPosition = (state.current_index || 0) + 1;
        } else if (typeof position === 'number' && position >= 0) {
            insertPosition = position;
        }

        const result = await db.addToQueue(userId, songId, insertPosition);

        res.status(201).json({
            success: true,
            position: result.position
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/queue/:position
 * Remove track from queue by position
 */
router.delete('/:position', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const position = parseStrictNonNegativeInt(req.params.position);

        if (position === null) {
            return res.status(400).json({ error: 'Некорректная позиция' });
        }

        await db.removeFromQueue(userId, position);

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/queue
 * Clear entire queue
 */
router.delete('/', async (req, res, next) => {
    try {
        const userId = req.user.id;
        await db.clearQueue(userId);
        res.json({ success: true, message: 'Очередь очищена' });
    } catch (error) {
        next(error);
    }
});

// ============================================================================
// PLAYBACK STATE
// ============================================================================

/**
 * PUT /api/queue/state
 * Update queue state (current index, shuffle, repeat)
 */
router.put('/state', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { current_index, shuffle_enabled, repeat_mode } = req.body;

        const updates = {};

        if (typeof current_index === 'number' && current_index >= 0) {
            updates.current_index = current_index;
        }

        if (typeof shuffle_enabled === 'boolean') {
            updates.shuffle_enabled = shuffle_enabled;

            // Generate shuffle order when enabling shuffle
            if (shuffle_enabled) {
                const queue = await db.getUserQueue(userId);
                const currentIdx = updates.current_index ?? (await db.getQueueState(userId)).current_index ?? 0;
                updates.shuffle_order = shuffleArray(queue.length, currentIdx);
            } else {
                updates.shuffle_order = null;
            }
        }

        if (repeat_mode && ['off', 'all', 'one'].includes(repeat_mode)) {
            updates.repeat_mode = repeat_mode;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Нет данных для обновления' });
        }

        await db.updateQueueState(userId, updates);

        res.json({
            success: true,
            ...updates,
            shuffle_order: undefined // Don't expose shuffle order in response
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/queue/next
 * Get next track based on current state
 */
router.post('/next', async (req, res, next) => {
    try {
        const userId = req.user.id;

        const [queue, state] = await Promise.all([
            db.getUserQueue(userId),
            db.getQueueState(userId)
        ]);

        const filteredQueue = filterTracksForUser(queue, userId, req.user.isAdmin === true);

        if (filteredQueue.length === 0) {
            return res.json({ track: null, index: -1, isEnd: true });
        }

        const nextIndex = getNextIndex(
            state.current_index || 0,
            filteredQueue.length,
            state.repeat_mode || 'off',
            state.shuffle_enabled || false,
            state.shuffle_order
        );

        if (nextIndex === -1) {
            return res.json({ track: null, index: -1, isEnd: true });
        }

        // Update current index
        await db.updateQueueState(userId, { current_index: nextIndex });

        res.json({
            track: filteredQueue[nextIndex],
            index: nextIndex,
            isEnd: false
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/queue/previous
 * Get previous track
 */
router.post('/previous', async (req, res, next) => {
    try {
        const userId = req.user.id;

        const [queue, state] = await Promise.all([
            db.getUserQueue(userId),
            db.getQueueState(userId)
        ]);

        const filteredQueue = filterTracksForUser(queue, userId, req.user.isAdmin === true);

        if (filteredQueue.length === 0) {
            return res.json({ track: null, index: -1 });
        }

        const prevIndex = getPreviousIndex(
            state.current_index || 0,
            filteredQueue.length,
            state.shuffle_enabled || false,
            state.shuffle_order
        );

        // Update current index
        await db.updateQueueState(userId, { current_index: prevIndex });

        res.json({
            track: filteredQueue[prevIndex],
            index: prevIndex
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/queue/jump
 * Jump to specific track in queue
 */
router.post('/jump', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { index } = req.body;

        const targetIndex = parseStrictNonNegativeInt(index);
        if (targetIndex === null) {
            return res.status(400).json({ error: 'Некорректный индекс' });
        }

        const queue = await db.getUserQueue(userId);
        const filteredQueue = filterTracksForUser(queue, userId, req.user.isAdmin === true);

        if (targetIndex >= filteredQueue.length) {
            return res.status(400).json({ error: 'Индекс за пределами очереди' });
        }

        await db.updateQueueState(userId, { current_index: targetIndex });

        res.json({
            track: filteredQueue[targetIndex],
            index: targetIndex
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/queue/shuffle
 * Toggle or set shuffle mode
 */
router.post('/shuffle', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { enabled } = req.body;

        const state = await db.getQueueState(userId);
        const newShuffleState = typeof enabled === 'boolean' ? enabled : !state.shuffle_enabled;

        const updates = { shuffle_enabled: newShuffleState };

        if (newShuffleState) {
            const queue = await db.getUserQueue(userId);
            const filteredQueue = filterTracksForUser(queue, userId, req.user.isAdmin === true);
            updates.shuffle_order = shuffleArray(filteredQueue.length, state.current_index || 0);
        } else {
            updates.shuffle_order = null;
        }

        await db.updateQueueState(userId, updates);

        res.json({
            success: true,
            shuffleEnabled: newShuffleState
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/queue/repeat
 * Set repeat mode
 */
router.post('/repeat', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { mode } = req.body;

        // Cycle through modes if not specified
        if (!mode) {
            const state = await db.getQueueState(userId);
            const currentMode = state.repeat_mode || 'off';
            const modes = ['off', 'all', 'one'];
            const currentIdx = modes.indexOf(currentMode);
            const nextMode = modes[(currentIdx + 1) % modes.length];

            await db.updateQueueState(userId, { repeat_mode: nextMode });

            return res.json({
                success: true,
                repeatMode: nextMode
            });
        }

        if (!['off', 'all', 'one'].includes(mode)) {
            return res.status(400).json({ error: 'Некорректный режим повтора. Допустимо: off, all, one' });
        }

        await db.updateQueueState(userId, { repeat_mode: mode });

        res.json({
            success: true,
            repeatMode: mode
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
