function clamp01(v) {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function abs(v) {
    return v < 0 ? -v : v;
}

function fnv1a32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.codePointAt(i) ?? 0;
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function stableJitter01(sessionId, trackId) {
    const sid = typeof sessionId === 'string' ? sessionId : '';
    const tid = Number.parseInt(trackId, 10);
    if (Number.isFinite(tid) && tid > 0) {
        const seed = fnv1a32(`${sid}:${tid}`);
        return (seed % 1_000_000) / 1_000_000;
    }
    return 0.5;
}

function applyArtistPenalty(score, artist, artistCounts, factor, maxPerArtist) {
    if (artist) {
        const cnt = artistCounts.get(artist) || 0;
        if (maxPerArtist > 0 && cnt >= maxPerArtist) {
            return -1e18;
        }
        if (cnt > 0) {
            return score * (1 / (1 + cnt * factor));
        }
    }
    return score;
}

function applyTempoPenalty(score, tempo, currentTempo, scale, denom) {
    if (currentTempo != null && tempo != null) {
        const d = abs(Number(tempo) - Number(currentTempo));
        if (Number.isFinite(d)) {
            return score - scale * clamp01(d / denom);
        }
    }
    return score;
}

function pickBestIndex(scored, artistCounts, currentTempo, options) {
    let bestIdx = -1;
    let bestScore = -1e18;

    for (let i = 0; i < scored.length; i += 1) {
        const item = scored[i];
        if (item && item.c) {
            const cand = item.c;
            let s = item.base;

            const artist = typeof cand.artist === 'string' ? cand.artist : '';
            s = applyArtistPenalty(s, artist, artistCounts, options.artistFactor, options.maxPerArtist || 0);
            s = applyTempoPenalty(s, cand.tempo, currentTempo, options.tempoScale, options.tempoDenom);

            if (s > bestScore) {
                bestScore = s;
                bestIdx = i;
            }
        }
    }

    return { bestIdx, bestScore };
}

function computeSkipRatePenalty(candidate) {
    const p = Number(candidate?.userPlayCount) || 0;
    const sk = Number(candidate?.userSkipCount) || 0;
    const denom = p + sk + 1;
    const skipRate = sk / denom;
    return 0.85 * skipRate;
}

function computeArtistDislikePenalty(candidate) {
    const cnt = Number(candidate?.userArtistDislikeCount) || 0;
    if (cnt <= 0) return 0;
    if (cnt >= 5) return 0.9;
    if (cnt >= 3) return 0.6;
    return 0.25 * cnt;
}

function computeUserAffinityBonus(candidate) {
    const plays = Number(candidate?.userPlayCount) || 0;
    const skips = Number(candidate?.userSkipCount) || 0;
    if (plays <= 0) return 0;
    const total = plays + skips;
    const completionRate = plays / total;
    return 0.15 * clamp01(completionRate) * clamp01(Math.log2(total + 1) / 5);
}

function computeUserWeightProfile(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    let totalPlays = 0;
    let totalSkips = 0;
    let interactedCount = 0;
    let totalArtistDislikes = 0;

    for (const c of list) {
        const plays = Number(c?.userPlayCount) || 0;
        const skips = Number(c?.userSkipCount) || 0;
        if (plays > 0 || skips > 0) {
            interactedCount++;
            totalPlays += plays;
            totalSkips += skips;
        }
        totalArtistDislikes += Number(c?.userArtistDislikeCount) || 0;
    }

    const totalInteractions = totalPlays + totalSkips;

    if (totalInteractions < 5) {
        return { popWeight: 0.08, affinityScale: 1, skipScale: 1, artistDislikeScale: 1 };
    }

    const completionRate = totalPlays / totalInteractions;
    const explorationRatio = list.length > 0 ? clamp01(interactedCount / list.length) : 0;

    const popWeight = 0.08 * (0.5 + 0.5 * explorationRatio);
    const affinityScale = 0.7 + 0.6 * completionRate;
    let skipScale = 1;
    if (completionRate > 0.7) skipScale = 0.8;
    else if (completionRate < 0.3) skipScale = 1.4;
    const avgDislikes = totalArtistDislikes / Math.max(1, list.length);
    const artistDislikeScale = avgDislikes > 2 ? 1.3 : 1;

    return { popWeight, affinityScale, skipScale, artistDislikeScale };
}

function computeEveningEnergyPenalty(candidate, ctx) {
    if (ctx?.isEvening === true && candidate?.energy != null) {
        const e = Number(candidate.energy);
        if (Number.isFinite(e) && e > 0.65) {
            return 0.10 * clamp01((e - 0.65) / 0.35);
        }
    }
    return 0;
}

function computeSeedTempoPenalty(candidate, ctx) {
    if (ctx?.seedTempo == null) return 0;
    if (candidate?.tempo == null) return 0;
    const d = abs(Number(candidate.tempo) - Number(ctx.seedTempo));
    if (!Number.isFinite(d)) return 0;
    return 0.20 * clamp01(d / 60);
}

function getInitialTempo(ctx) {
    const v = ctx?.seedTempo;
    const n = v == null ? null : Number(v);
    return Number.isFinite(n) ? n : null;
}

function updateStateAfterPick(pickedCandidate, artistCounts) {
    const artist = typeof pickedCandidate?.artist === 'string' ? pickedCandidate.artist : '';
    if (artist) {
        artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    }

    if (pickedCandidate?.tempo == null) {
        return null;
    }

    const t = Number(pickedCandidate.tempo);
    return Number.isFinite(t) ? t : null;
}

function selectDiversified(scoredInput, limit, ctx, options) {
    const scored = Array.isArray(scoredInput) ? scoredInput.slice() : [];
    if (scored.length === 0) return [];

    const selected = [];
    const artistCounts = new Map();
    let currentTempo = getInitialTempo(ctx);

    while (selected.length < limit) {
        const { bestIdx, bestScore } = pickBestIndex(scored, artistCounts, currentTempo, options);

        if (bestIdx < 0) {
            break;
        }

        const picked = scored[bestIdx];
        scored.splice(bestIdx, 1);

        selected.push({ id: picked.c.id, score: bestScore });

        const nextTempo = updateStateAfterPick(picked.c, artistCounts);
        if (nextTempo != null) {
            currentTempo = nextTempo;
        }
    }

    return selected;
}

function parseRankedList(ranked) {
    const list = Array.isArray(ranked) ? ranked : [];
    return list
        .map((x) => ({
            id: Number.parseInt(x?.id, 10),
            score: Number(x?.score),
        }))
        .filter((x) => Number.isFinite(x.id) && x.id > 0 && Number.isFinite(x.score));
}

function buildScoredFromRanked(parsedRanked, candidatesById, ctx, jitterScale) {
    const sessionId = ctx?.sessionId;
    const out = [];

    for (const x of parsedRanked) {
        const c = candidatesById.get(x.id);
        if (c) {
            const jitter = stableJitter01(sessionId, x.id) - 0.5;
            out.push({ c, base: x.score + jitter * jitterScale });
        }
    }

    return out;
}

function diversifyRanked(ranked, candidatesById, limit, ctx) {
    const parsed = parseRankedList(ranked);
    if (parsed.length === 0) {
        return [];
    }

    const scored = buildScoredFromRanked(parsed, candidatesById, ctx, 0.001);
    if (scored.length === 0) {
        return parsed.slice(0, limit);
    }

    const maxPerArtist = limit <= 20 ? 2 : 3;
    return selectDiversified(scored, limit, ctx, {
        artistFactor: 1.2,
        tempoScale: 0.10,
        tempoDenom: 60,
        maxPerArtist,
    });
}

function computePopNorm(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (list.length === 0) return () => 0;
    let maxPop = 0;
    for (const c of list) {
        const p = Number(c?.popularity) || 0;
        if (p > maxPop) maxPop = p;
    }
    if (maxPop <= 0) return () => 0;
    return (pop) => clamp01((Number(pop) || 0) / maxPop);
}

function scoreCandidate(c, ctx, normPop, weights) {
    const w = weights || { popWeight: 0.08, affinityScale: 1, skipScale: 1, artistDislikeScale: 1 };
    const pop = normPop ? normPop(c.popularity) : clamp01((Number(c.popularity) || 0) / 100);
    let s = (Number(c.sourceScore) || 0) + w.popWeight * pop;

    s += w.affinityScale * computeUserAffinityBonus(c);
    s -= w.skipScale * computeSkipRatePenalty(c);
    s -= w.artistDislikeScale * computeArtistDislikePenalty(c);
    s -= computeEveningEnergyPenalty(c, ctx);
    s -= computeSeedTempoPenalty(c, ctx);

    return s;
}

function rankLocally(candidates, limit, ctx) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (list.length === 0) return [];

    const normPop = computePopNorm(list);
    const weights = computeUserWeightProfile(list);
    const sessionId = ctx?.sessionId;
    const scored = list
        .filter((c) => Number.isFinite(Number(c?.id)) && Number(c.id) > 0)
        .map((c) => {
            const jitter = stableJitter01(sessionId, c.id) - 0.5;
            return { c, base: scoreCandidate(c, ctx, normPop, weights) + jitter * 0.03 };
        });

    const maxPerArtist = limit <= 20 ? 2 : 3;
    return selectDiversified(scored, limit, ctx, {
        artistFactor: 1.0,
        tempoScale: 0.15,
        tempoDenom: 50,
        maxPerArtist,
    });
}

async function rankWithService(axios, url, timeoutMs, candidates, limit, ctx) {
    const res = await axios.post(
        `${String(url).replace(/\/+$/, '')}/rank`,
        {
            limit,
            context: {
                isEvening: ctx?.isEvening === true,
                seedTempo: ctx?.seedTempo != null ? Number(ctx.seedTempo) : null,
                sessionId: typeof ctx?.sessionId === 'string' ? ctx.sessionId : null,
            },
            candidates,
        },
        {
            timeout: Math.max(1, Number(timeoutMs) || 1),
            headers: { 'Content-Type': 'application/json' },
            validateStatus: (s) => s >= 200 && s < 300,
        }
    );

    const ranked = res?.data?.ranked;
    const list = Array.isArray(ranked) ? ranked : [];

    const candidatesById = new Map(
        (Array.isArray(candidates) ? candidates : [])
            .filter((c) => Number.isFinite(Number(c?.id)) && Number(c.id) > 0)
            .map((c) => [Number.parseInt(c.id, 10), c])
    );

    const diversified = diversifyRanked(list, candidatesById, limit, ctx);
    return diversified;
}

module.exports = {
    rankWithService,
    rankLocally,
};
