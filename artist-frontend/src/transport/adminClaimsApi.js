import { httpJson } from './http';

const normalizeStatus = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'pending' || s === 'approved' || s === 'rejected' || s === 'needs_changes') return s;
    return 'pending';
};

const normalizeAction = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'approve' || s === 'reject' || s === 'needs_changes') return s;
    return '';
};

export const adminClaimsApi = {
    async listClaims({ status = 'pending', limit = 50, offset = 0 } = {}) {
        const params = new URLSearchParams();
        params.set('status', normalizeStatus(status));
        if (Number.isFinite(Number(limit))) params.set('limit', String(Math.max(1, Math.min(200, Number(limit)))));
        if (Number.isFinite(Number(offset))) params.set('offset', String(Math.max(0, Number(offset))));
        return await httpJson('/api/artists/admin/claims?' + params.toString(), { method: 'GET' });
    },

    async reviewClaim({ id, action, reason } = {}) {
        const claimId = String(id || '').trim();
        const act = normalizeAction(action);
        if (!claimId || !act) {
            const err = new Error('INVALID_INPUT');
            err.status = 400;
            err.data = { code: 'INVALID_INPUT' };
            throw err;
        }

        const payload = {
            action: act,
            reason: reason === null || reason === undefined ? '' : String(reason).slice(0, 1000),
        };

        return await httpJson(`/api/artists/admin/claims/${encodeURIComponent(claimId)}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },
};
