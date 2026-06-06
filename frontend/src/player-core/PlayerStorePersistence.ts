import type { PlayerStoreInit } from './PlayerStore';
import type { RepeatMode } from './types';

const REPEAT_MODES: ReadonlySet<string> = new Set(['off', 'all', 'one']);

function safeGet(key: string): string | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSet(key: string, value: string): void {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(key, value);
    } catch {
    }
}

function parseFloat01(raw: string | null, fallback: number): number {
    if (raw === null) return fallback;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
}

function parseBool(raw: string | null, fallback: boolean): boolean {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
}

function parseEqGains(raw: string | null): readonly number[] | undefined {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length !== 10) return undefined;
        const gains = parsed.map((v: unknown) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return 0;
            return Math.max(-12, Math.min(12, n));
        });
        gains[5] = 0;
        gains[6] = 0;
        gains[8] = 0;
        return Object.freeze(gains);
    } catch {
        return undefined;
    }
}

export function loadInitFromLocalStorage(): PlayerStoreInit {
    const init: PlayerStoreInit = {};

    const vol = safeGet('playerVolume');
    if (vol !== null) init.volume = parseFloat01(vol, 1);

    const pitch = safeGet('playback_preserve_pitch');
    if (pitch !== null) init.preservePitch = parseBool(pitch, true);

    const eqOn = safeGet('eq_enabled');
    if (eqOn !== null) init.eqEnabled = parseBool(eqOn, false);

    const eqG = parseEqGains(safeGet('eq_gains'));
    if (eqG) init.eqGains = eqG;

    const rm = safeGet('playerRepeatMode');
    if (rm && REPEAT_MODES.has(rm)) init.repeatMode = rm as RepeatMode;

    const sh = safeGet('playerShuffleEnabled');
    if (sh !== null) init.shuffleEnabled = parseBool(sh, false);

    const idx = safeGet('lastTrackIndex');
    if (idx !== null) {
        const n = Number.parseInt(idx, 10);
        if (Number.isFinite(n) && n >= 0) init.currentTrackIndex = Math.floor(n);
    }

    return init;
}

export type PersistKey =
    | 'volume' | 'preservePitch' | 'eqEnabled' | 'eqGains'
    | 'repeatMode' | 'shuffleEnabled' | 'currentTrackIndex';

const KEY_MAP: Record<PersistKey, string> = {
    volume: 'playerVolume',
    preservePitch: 'playback_preserve_pitch',
    eqEnabled: 'eq_enabled',
    eqGains: 'eq_gains',
    repeatMode: 'playerRepeatMode',
    shuffleEnabled: 'playerShuffleEnabled',
    currentTrackIndex: 'lastTrackIndex',
};

export function persistField(field: PersistKey, value: unknown): void {
    const lsKey = KEY_MAP[field];
    if (!lsKey) return;

    switch (field) {
        case 'volume': {
            const v = Number(value);
            if (Number.isFinite(v)) safeSet(lsKey, String(v));
            break;
        }
        case 'preservePitch':
        case 'eqEnabled':
        case 'shuffleEnabled':
            safeSet(lsKey, value ? 'true' : 'false');
            break;
        case 'eqGains':
            if (Array.isArray(value) && value.length === 10) {
                safeSet(lsKey, JSON.stringify(value));
            }
            break;
        case 'repeatMode':
            if (typeof value === 'string' && REPEAT_MODES.has(value)) {
                safeSet(lsKey, value);
            }
            break;
        case 'currentTrackIndex': {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 0) {
                safeSet(lsKey, String(Math.floor(n)));
            }
            break;
        }
    }
}
