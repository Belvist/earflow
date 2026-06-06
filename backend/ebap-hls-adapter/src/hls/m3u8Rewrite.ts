function normalizeFileNameFromUri(uri: string): string {
    const raw = String(uri || '').trim();
    const noHash = raw.split('#')[0] || '';
    const noQuery = (noHash.split('?')[0] || '').trim();
    return noQuery.replace(/^\//, '').replace(/\\/g, '/');
}

function normalizePosixPath(path: string): string {
    const raw = String(path || '').replace(/\\/g, '/');
    const parts = raw.split('/');
    const out: string[] = [];
    for (const p of parts) {
        const seg = String(p || '').trim();
        if (!seg || seg === '.') continue;
        if (seg === '..') return '';
        out.push(seg);
    }
    return out.join('/');
}

function resolveAgainstBaseDir(baseDir: string, fileName: string): string {
    const base = String(baseDir || '').replace(/\\/g, '/').replace(/^\//, '');
    const baseNorm = base && !base.endsWith('/') ? `${base}/` : base;
    const rel = String(fileName || '').replace(/\\/g, '/').replace(/^\//, '');
    const combined = rel ? `${baseNorm}${rel}` : baseNorm;
    return normalizePosixPath(combined);
}

function appendTokenToUri(uri: string, token: string): string {
    const raw = String(uri || '').trim();
    if (!raw) return raw;
    if (raw.includes('token=')) return raw;
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}token=${encodeURIComponent(token)}`;
}

export function rewriteM3u8WithTokens(params: {
    m3u8Text: string;
    baseDir: string;
    tokenForFileName: (fileName: string) => string;
}): string {
    const lines = String(params.m3u8Text || '').split(/\r?\n/);

    const out: string[] = [];
    for (const line of lines) {
        const raw = String(line);
        const trimmed = raw.trim();
        if (!trimmed) {
            out.push(raw);
            continue;
        }

        if (trimmed.startsWith('#')) {
            if (trimmed.startsWith('#EXT-X-MAP:')) {
                const replaced = raw.replace(/URI="([^"]+)"/g, (_m: string, uri: string) => {
                    const fileName = normalizeFileNameFromUri(uri);
                    if (!fileName || uri.startsWith('http://') || uri.startsWith('https://')) return `URI="${uri}"`;
                    const resolved = resolveAgainstBaseDir(params.baseDir, fileName);
                    if (!resolved) return `URI="${uri}"`;
                    const token = params.tokenForFileName(resolved);
                    return `URI="${appendTokenToUri(uri, token)}"`;
                });
                out.push(replaced);
                continue;
            }

            out.push(raw);
            continue;
        }

        const uri = trimmed;
        const fileName = normalizeFileNameFromUri(uri);
        if (!fileName || uri.startsWith('http://') || uri.startsWith('https://')) {
            out.push(raw);
            continue;
        }

        const resolved = resolveAgainstBaseDir(params.baseDir, fileName);
        if (!resolved) {
            out.push(raw);
            continue;
        }

        const token = params.tokenForFileName(resolved);
        out.push(appendTokenToUri(uri, token));
    }

    return out.join('\n');
}
