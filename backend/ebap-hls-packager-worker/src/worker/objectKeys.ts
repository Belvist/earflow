import { basename } from 'node:path';

function normalizeKey(raw: string): string {
    return String(raw || '').replace(/^\/+/, '');
}

export function candidateAudioKeys(filePath: string): string[] {
    const key = normalizeKey(filePath);
    const out: string[] = [];

    if (key) out.push(key);

    if (key && !key.startsWith('audio/')) {
        out.push(`audio/${key}`);
    }

    const base = basename(key);
    if (base && base !== key) {
        out.push(base);
        out.push(`audio/${base}`);
        out.push(`audio/library/${base}`);
    }

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const k of out) {
        const kk = String(k || '').trim();
        if (!kk || seen.has(kk)) continue;
        if (kk.includes('..') || kk.includes('\\') || kk.includes('\u0000')) continue;
        seen.add(kk);
        unique.push(kk);
    }

    return unique;
}
