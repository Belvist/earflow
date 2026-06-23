export const normalizeHttpStatus = (status) => {
    const s = Number(status);
    return Number.isFinite(s) ? s : 0;
};

export const attachLegacyStatusFields = (err, status) => {
    const st = normalizeHttpStatus(status);
    try {
        err.status = st;
        err.responseStatus = st;
    } catch {
    }
    return err;
};
