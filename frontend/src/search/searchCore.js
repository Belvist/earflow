const YO_RE = /\u0451/g;
const MULTI_SPACE_RE = /\s+/g;
const TOKEN_SEP_RE = /[\s\-_]+/;

function normalizeStr(s) {
    if (typeof s !== 'string') return '';
    return s
        .normalize('NFC')
        .toLowerCase()
        .replace(YO_RE, '\u0435')
        .replace(MULTI_SPACE_RE, ' ')
        .trim();
}

function tokenize(s) {
    return normalizeStr(s).split(TOKEN_SEP_RE).filter(Boolean);
}

const S_EXACT_TITLE = 1000;
const S_PREFIX_TITLE = 500;
const S_WORD_PREFIX_TITLE = 300;
const S_SUBSTR_TITLE = 100;
const S_EXACT_ARTIST = 400;
const S_PREFIX_ARTIST = 200;
const S_WORD_PREFIX_ARTIST = 120;
const S_SUBSTR_ARTIST = 40;

function scoreEntry(entry, normQ, qTokens) {
    let score = 0;

    const t = entry.title;
    if (t) {
        if (t === normQ) {
            score += S_EXACT_TITLE;
        } else if (t.startsWith(normQ)) {
            score += S_PREFIX_TITLE;
        } else {
            let hit = false;
            for (let qi = 0; qi < qTokens.length && !hit; qi++) {
                const qt = qTokens[qi];
                for (let ti = 0; ti < entry.titleTokens.length && !hit; ti++) {
                    if (entry.titleTokens[ti].startsWith(qt)) hit = true;
                }
            }
            score += hit ? S_WORD_PREFIX_TITLE : (t.includes(normQ) ? S_SUBSTR_TITLE : 0);
        }
    }

    const a = entry.artist;
    if (a) {
        if (a === normQ) {
            score += S_EXACT_ARTIST;
        } else if (a.startsWith(normQ)) {
            score += S_PREFIX_ARTIST;
        } else {
            let hit = false;
            for (let qi = 0; qi < qTokens.length && !hit; qi++) {
                const qt = qTokens[qi];
                for (let ai = 0; ai < entry.artistTokens.length && !hit; ai++) {
                    if (entry.artistTokens[ai].startsWith(qt)) hit = true;
                }
            }
            score += hit ? S_WORD_PREFIX_ARTIST : (a.includes(normQ) ? S_SUBSTR_ARTIST : 0);
        }
    }

    return score;
}

export function buildIndex(entities) {
    if (!Array.isArray(entities)) return [];
    const out = new Array(entities.length);
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        const title = normalizeStr(e?.title ?? '');
        const artist = normalizeStr(e?.artist ?? '');
        out[i] = {
            id: e?.id ?? null,
            title,
            artist,
            titleTokens: tokenize(e?.title ?? ''),
            artistTokens: tokenize(e?.artist ?? ''),
            original: e,
        };
    }
    return out;
}

export function search(index, query, topN = 30) {
    if (!Array.isArray(index) || index.length === 0) return [];
    const normQ = normalizeStr(query);
    if (!normQ) return [];

    const qTokens = tokenize(query);
    const scored = [];

    for (let i = 0; i < index.length; i++) {
        const s = scoreEntry(index[i], normQ, qTokens);
        if (s > 0) scored.push({ score: s, idx: i, original: index[i].original });
    }

    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx));
    const out = new Array(Math.min(scored.length, topN));
    for (let i = 0; i < out.length; i++) out[i] = scored[i].original;
    return out;
}

export function rerank(items, query) {
    if (!Array.isArray(items) || items.length === 0) return items;
    const normQ = normalizeStr(query);
    if (!normQ) return items;

    const qTokens = tokenize(query);
    const idx = buildIndex(items);
    const scored = new Array(idx.length);
    for (let i = 0; i < idx.length; i++) {
        scored[i] = { score: scoreEntry(idx[i], normQ, qTokens), idx: i, original: items[i] };
    }
    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx));
    const out = new Array(scored.length);
    for (let i = 0; i < scored.length; i++) out[i] = scored[i].original;
    return out;
}
