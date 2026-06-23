export function slugifyForRoute(value) {
    const raw = (value ?? '').toString().normalize('NFC').trim().toLowerCase();
    if (!raw) return '';
    const dashed = raw
        .replace(/[\s_]+/g, '-')
        .replace(/[^\p{L}\p{N}-]+/gu, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    return dashed.slice(0, 80);
}
