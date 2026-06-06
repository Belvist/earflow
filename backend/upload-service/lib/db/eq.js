const { query } = require('./pool');

function parsePositiveInt(value) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    if (!/^\d+$/.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    return n;
}

async function getEqSettings(userId) {
    const uid = parsePositiveInt(userId);
    if (!uid) {
        const e = new Error('Требуется авторизация');
        e.status = 401;
        throw e;
    }

    const result = await query('SELECT enabled, gains FROM user_eq_settings WHERE user_id = $1', [uid]);
    if (!result.rows || result.rows.length === 0) {
        return {
            enabled: false,
            gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        };
    }

    const gains = result.rows[0].gains;
    return {
        enabled: Boolean(result.rows[0].enabled),
        gains: typeof gains === 'string' ? JSON.parse(gains) : gains,
    };
}

async function saveEqSettings(userId, body) {
    const uid = parsePositiveInt(userId);
    if (!uid) {
        const e = new Error('Требуется авторизация');
        e.status = 401;
        throw e;
    }

    const { enabled, gains } = body || {};

    if (typeof enabled !== 'boolean') {
        const e = new Error('enabled должен быть boolean');
        e.status = 400;
        throw e;
    }

    if (!Array.isArray(gains) || gains.length !== 10) {
        const e = new Error('gains должен быть массивом из 10 чисел');
        e.status = 400;
        throw e;
    }

    for (let i = 0; i < gains.length; i++) {
        const val = gains[i];
        if (typeof val !== 'number' || val < -12 || val > 12) {
            const e = new Error(`gains[${i}] должен быть числом от -12 до 12`);
            e.status = 400;
            throw e;
        }
    }

    await query(
        `INSERT INTO user_eq_settings (user_id, enabled, gains, updated_at)
     VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       gains = EXCLUDED.gains,
       updated_at = CURRENT_TIMESTAMP`,
        [uid, enabled, JSON.stringify(gains)]
    );

    return { success: true, enabled, gains };
}

module.exports = {
    getEqSettings,
    saveEqSettings,
};
