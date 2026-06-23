'use strict';

const { generateSecretBase32, buildOtpauthUrl, verifyTotp } = require('./totp');
const { generateRecoveryCodes, hashRecoveryCode, tryConsumeRecoveryCode } = require('./recoveryCodes');

const STEP_UP_TTL_SECONDS = 5 * 60;
const MFA_ATTEMPT_WINDOW_SECONDS = 60;
const MFA_MAX_ATTEMPTS = 5;

function parseBearerToken(req) {
    const raw = req.headers.authorization;
    if (!raw) return '';
    const value = String(raw).trim();
    if (!value.toLowerCase().startsWith('bearer ')) return '';
    return value.slice(7).trim();
}

function safeJsonParse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function decryptUserEmail({ decryptData, user }) {
    if (!user?.salt || !user?.email_encrypted) return null;
    const parsed = typeof user.email_encrypted === 'string' ? safeJsonParse(user.email_encrypted) : null;
    if (!parsed) return null;

    try {
        const decrypted = decryptData(parsed, user.salt);
        const email = typeof decrypted?.value === 'string' ? decrypted.value.trim() : '';
        return email || null;
    } catch {
        return null;
    }
}

function nowIso() {
    return new Date().toISOString();
}

function pickUserId(decoded) {
    const id = decoded?.userId ?? decoded?.user_id ?? decoded?.id ?? decoded?.sub;
    const n = Number(id);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    return n;
}

function authenticateAccessToken({ jwt, jwtSecret, jwtIssuer, jwtAudience, req }) {
    const token = parseBearerToken(req);
    if (!token) {
        const err = new Error('NO_TOKEN');
        err.status = 401;
        throw err;
    }

    const decoded = jwt.verify(token, jwtSecret, {
        algorithms: ['HS256'],
        issuer: jwtIssuer,
        audience: jwtAudience,
    });

    if (decoded && decoded.type && decoded.type !== 'access') {
        const err = new Error('INVALID_TOKEN');
        err.status = 401;
        throw err;
    }

    const userId = pickUserId(decoded);
    if (!userId) {
        const err = new Error('INVALID_TOKEN');
        err.status = 401;
        throw err;
    }

    const sid = typeof decoded?.sid === 'string' ? decoded.sid.trim() : '';
    if (!sid) {
        const err = new Error('INVALID_TOKEN');
        err.status = 401;
        throw err;
    }

    return { token, decoded, userId, sid };
}

function buildStepUpKey(sid) {
    return `auth:mfa_stepup:${sid}`;
}

async function getUserById({ dbRequest, userId }) {
    const user = await dbRequest('GET', `/api/users/${userId}`);
    if (!user) {
        const err = new Error('USER_NOT_FOUND');
        err.status = 404;
        throw err;
    }
    return user;
}

function decryptMfaSecret({ decryptData, user }) {
    if (!user?.salt || !user?.mfa_secret_encrypted) return null;
    const parsed = typeof user.mfa_secret_encrypted === 'string' ? safeJsonParse(user.mfa_secret_encrypted) : null;
    if (!parsed) return null;

    try {
        const decrypted = decryptData(parsed, user.salt);
        const secret = typeof decrypted?.secretBase32 === 'string' ? decrypted.secretBase32.trim() : '';
        return secret || null;
    } catch {
        return null;
    }
}

function parseRecoveryHashes(user) {
    const raw = typeof user?.mfa_recovery_codes === 'string' ? user.mfa_recovery_codes : '';
    const parsed = safeJsonParse(raw);
    if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x || '').trim()).filter(Boolean);
    }
    return [];
}

async function setUserMfaFields({ dbRequest, userId, fields }) {
    const payload = { ...fields };
    return dbRequest('PUT', `/api/users/${userId}`, payload);
}

async function setStepUp({ redisClient, sid, userId }) {
    const key = buildStepUpKey(sid);
    const value = JSON.stringify({ userId, at: nowIso() });
    await redisClient.setEx(key, STEP_UP_TTL_SECONDS, value);
}

async function clearStepUp({ redisClient, sid }) {
    const key = buildStepUpKey(sid);
    await redisClient.del(key);
}

async function getStepUpStatus({ redisClient, sid }) {
    const key = buildStepUpKey(sid);
    const raw = await redisClient.get(key);
    if (!raw) return { ok: false, at: null };
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== 'object') return { ok: false, at: null };

    const at = typeof parsed.at === 'string' ? parsed.at : null;
    const userId = Number.isSafeInteger(Number(parsed.userId)) ? Number(parsed.userId) : null;
    if (!userId) return { ok: false, at: null };

    return { ok: true, at, userId };
}

async function checkMfaRateLimit({ redisClient, userId }) {
    const key = `auth:mfa_attempts:${userId}`;
    const current = await redisClient.incr(key);
    if (current === 1) {
        await redisClient.expire(key, MFA_ATTEMPT_WINDOW_SECONDS);
    }
    if (current > MFA_MAX_ATTEMPTS) {
        const ttl = await redisClient.ttl(key);
        return { blocked: true, retryAfter: ttl > 0 ? ttl : MFA_ATTEMPT_WINDOW_SECONDS };
    }
    return { blocked: false };
}

function mountMfaRoutes(app, deps) {
    const { jwt, jwtSecret, jwtIssuer, jwtAudience, dbRequest, encryptData, decryptData, getRedisState, setCachedUserProfile, getCachedUserProfile } = deps;

    if (!app) throw new Error('mountMfaRoutes: app is required');

    app.get('/api/auth/2fa/status', async (req, res) => {
        try {
            const { userId } = authenticateAccessToken({ jwt, jwtSecret, jwtIssuer, jwtAudience, req });
            const user = await getUserById({ dbRequest, userId });

            return res.json({
                enabled: user.mfa_enabled === true,
                enabledAt: user.mfa_enabled_at || null,
                recoveryCodesRemaining: parseRecoveryHashes(user).length,
            });
        } catch (err) {
            const st = Number(err?.status) || 500;
            if (st === 401) return res.status(401).json({ error: 'Authentication required' });
            if (st === 404) return res.status(404).json({ error: 'User not found' });
            return res.status(503).json({ error: 'Service temporarily unavailable' });
        }
    });

    app.post('/api/auth/2fa/setup', async (req, res) => {
        try {
            const { userId } = authenticateAccessToken({ jwt, jwtSecret, jwtIssuer, jwtAudience, req });
            const user = await getUserById({ dbRequest, userId });

            if (!user?.salt) {
                return res.status(500).json({ error: 'Service temporarily unavailable' });
            }
            if (user.mfa_enabled === true) {
                return res.status(409).json({ error: 'MFA already enabled' });
            }

            const secretBase32 = generateSecretBase32(20);
            const encrypted = encryptData({ secretBase32 }, user.salt);

            await setUserMfaFields({
                dbRequest,
                userId,
                fields: {
                    mfa_secret_encrypted: JSON.stringify(encrypted),
                },
            });

            const issuer = 'Earflow Artists';
            const decryptedEmail = decryptUserEmail({ decryptData, user });
            const accountName = decryptedEmail ? decryptedEmail : `user:${userId}`;
            const otpauthUrl = buildOtpauthUrl({ issuer, accountName, secretBase32 });

            return res.json({ secretBase32, otpauthUrl, issuer, accountName });
        } catch (err) {
            const st = Number(err?.status) || 500;
            if (st === 401) return res.status(401).json({ error: 'Authentication required' });
            if (st === 404) return res.status(404).json({ error: 'User not found' });
            return res.status(503).json({ error: 'Service temporarily unavailable' });
        }
    });

    app.post('/api/auth/2fa/enable', async (req, res) => {
        try {
            const { userId, sid } = authenticateAccessToken({ jwt, jwtSecret, jwtIssuer, jwtAudience, req });
            const { token } = req.body || {};

            const { ready, client } = getRedisState();
            if (!ready || !client) {
                return res.status(503).json({ error: 'Service temporarily unavailable' });
            }

            const rl = await checkMfaRateLimit({ redisClient: client, userId });
            if (rl.blocked) {
                return res.status(429).json({ error: 'Too many MFA attempts', retryAfter: rl.retryAfter });
            }

            const user = await getUserById({ dbRequest, userId });
            if (!user?.salt) {
                return res.status(503).json({ error: 'Service temporarily unavailable' });
            }
            if (user.mfa_enabled === true) {
                return res.status(409).json({ error: 'MFA already enabled' });
            }

            const secretBase32 = decryptMfaSecret({ decryptData, user });
            if (!secretBase32) {
                return res.status(409).json({ error: 'MFA setup required' });
            }

            const ok = verifyTotp({ secretBase32, token, window: 1 });
            if (!ok) {
                return res.status(400).json({ error: 'Invalid 2FA code' });
            }

            const recoveryCodes = generateRecoveryCodes({ count: 10, bytesPerCode: 9 });
            const recoveryHashes = recoveryCodes.map((c) => hashRecoveryCode({ userSalt: user.salt, code: c }));

            await setUserMfaFields({
                dbRequest,
                userId,
                fields: {
                    mfa_enabled: true,
                    mfa_enabled_at: nowIso(),
                    mfa_recovery_codes: JSON.stringify(recoveryHashes),
                },
            });

            await setStepUp({ redisClient: client, sid, userId });

            const cached = await getCachedUserProfile(userId);
            if (cached) {
                await setCachedUserProfile(userId, { ...cached, mfaEnabled: true });
            }

            return res.json({
                enabled: true,
                recoveryCodes,
                stepUpTtlSeconds: STEP_UP_TTL_SECONDS,
            });
        } catch (err) {
            const st = Number(err?.status) || 500;
            if (st === 401) return res.status(401).json({ error: 'Authentication required' });
            if (st === 404) return res.status(404).json({ error: 'User not found' });
            return res.status(503).json({ error: 'Service temporarily unavailable' });
        }
    });

    app.post('/api/auth/2fa/step-up', async (req, res) => {
        try {
            const { userId, sid } = authenticateAccessToken({ jwt, jwtSecret, jwtIssuer, jwtAudience, req });
            const { token, recoveryCode } = req.body || {};

            const { ready, client } = getRedisState();
            if (!ready || !client) {
                return res.status(503).json({ error: 'Service temporarily unavailable' });
            }

            const rl = await checkMfaRateLimit({ redisClient: client, userId });
            if (rl.blocked) {
                return res.status(429).json({ error: 'Too many MFA attempts', retryAfter: rl.retryAfter });
            }

            const user = await getUserById({ dbRequest, userId });
            if (!user?.salt) {
                return res.status(503).json({ error: 'Service temporarily unavailable' });
            }
            if (user.mfa_enabled !== true) {
                return res.status(403).json({ error: 'MFA_REQUIRED' });
            }

            const secretBase32 = decryptMfaSecret({ decryptData, user });
            const recoveryHashes = parseRecoveryHashes(user);

            let verified = false;

            if (token !== undefined) {
                if (secretBase32) {
                    verified = verifyTotp({ secretBase32, token, window: 1 });
                }
            } else if (recoveryCode !== undefined) {
                const consumed = tryConsumeRecoveryCode({ userSalt: user.salt, storedHashes: recoveryHashes, providedCode: recoveryCode });
                verified = consumed.ok === true;
                if (verified) {
                    await setUserMfaFields({
                        dbRequest,
                        userId,
                        fields: { mfa_recovery_codes: JSON.stringify(consumed.nextHashes) },
                    });
                }
            }

            if (!verified) {
                return res.status(400).json({ error: 'Invalid 2FA code' });
            }

            await setStepUp({ redisClient: client, sid, userId });
            return res.json({ ok: true, ttlSeconds: STEP_UP_TTL_SECONDS });
        } catch (err) {
            const st = Number(err?.status) || 500;
            if (st === 401) return res.status(401).json({ error: 'Authentication required' });
            if (st === 404) return res.status(404).json({ error: 'User not found' });
            return res.status(503).json({ error: 'Service temporarily unavailable' });
        }
    });

    app.get('/api/auth/2fa/step-up/status', async (req, res) => {
        try {
            const { sid, userId } = authenticateAccessToken({ jwt, jwtSecret, jwtIssuer, jwtAudience, req });

            const { ready, client } = getRedisState();
            if (!ready || !client) {
                return res.status(503).json({ error: 'Service temporarily unavailable' });
            }

            const status = await getStepUpStatus({ redisClient: client, sid });
            if (status.ok !== true) {
                return res.json({ ok: false, at: null });
            }
            if (Number(status.userId) !== Number(userId)) {
                return res.json({ ok: false, at: null });
            }
            return res.json({ ok: true, at: status.at || null });
        } catch (err) {
            const st = Number(err?.status) || 500;
            if (st === 401) return res.status(401).json({ error: 'Authentication required' });
            return res.status(503).json({ error: 'Service temporarily unavailable' });
        }
    });

    // NOTE: /api/auth/2fa/recovery/regenerate moved to the Go security-service
    // (hot path, multi-user concurrent load). See backend/security-service.

    app.post('/api/auth/2fa/disable', async (req, res) => {
        try {
            const { userId, sid } = authenticateAccessToken({ jwt, jwtSecret, jwtIssuer, jwtAudience, req });
            const { token, recoveryCode } = req.body || {};

            const { ready, client } = getRedisState();
            if (!ready || !client) {
                return res.status(503).json({ error: 'Service temporarily unavailable' });
            }

            const rl = await checkMfaRateLimit({ redisClient: client, userId });
            if (rl.blocked) {
                return res.status(429).json({ error: 'Too many MFA attempts', retryAfter: rl.retryAfter });
            }

            const user = await getUserById({ dbRequest, userId });
            if (!user?.salt) {
                return res.status(503).json({ error: 'Service temporarily unavailable' });
            }
            if (user.mfa_enabled !== true) {
                return res.status(409).json({ error: 'MFA not enabled' });
            }

            const secretBase32 = decryptMfaSecret({ decryptData, user });
            const recoveryHashes = parseRecoveryHashes(user);

            let verified = false;

            if (token !== undefined) {
                if (secretBase32) {
                    verified = verifyTotp({ secretBase32, token, window: 1 });
                }
            } else if (recoveryCode !== undefined) {
                verified = tryConsumeRecoveryCode({ userSalt: user.salt, storedHashes: recoveryHashes, providedCode: recoveryCode }).ok === true;
            }

            if (!verified) {
                return res.status(400).json({ error: 'Invalid 2FA code' });
            }

            await setUserMfaFields({
                dbRequest,
                userId,
                fields: {
                    mfa_enabled: false,
                    mfa_enabled_at: null,
                    mfa_secret_encrypted: null,
                    mfa_recovery_codes: null,
                },
            });

            await clearStepUp({ redisClient: client, sid });

            const cached = await getCachedUserProfile(userId);
            if (cached) {
                await setCachedUserProfile(userId, { ...cached, mfaEnabled: false });
            }

            return res.json({ enabled: false });
        } catch (err) {
            const st = Number(err?.status) || 500;
            if (st === 401) return res.status(401).json({ error: 'Authentication required' });
            if (st === 404) return res.status(404).json({ error: 'User not found' });
            return res.status(503).json({ error: 'Service temporarily unavailable' });
        }
    });
}

module.exports = { mountMfaRoutes, STEP_UP_TTL_SECONDS };
