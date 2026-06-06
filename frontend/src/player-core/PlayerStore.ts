import type { PlayerFSMState } from './PlayerFSM';
import type { RepeatMode, QueueSource } from './types';

export type PlayerStoreSnapshot = {
    readonly isPlaying: boolean;
    readonly isBuffering: boolean;
    readonly isSeeking: boolean;
    readonly currentTrackIndex: number;
    readonly currentTime: number;
    readonly duration: number;
    readonly fsmState: PlayerFSMState;

    readonly volume: number;
    readonly playbackRate: number;
    readonly preservePitch: boolean;
    readonly eqEnabled: boolean;
    readonly eqGains: readonly number[];
    readonly repeatMode: RepeatMode;
    readonly shuffleEnabled: boolean;
    readonly queueSource: QueueSource;
    readonly queueName: string;
    readonly playbackEngine: string;
    readonly lastErrorCode: string | null;
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type PlayerStoreInit = Partial<Mutable<Pick<
    PlayerStoreSnapshot,
    | 'volume' | 'playbackRate' | 'preservePitch'
    | 'eqEnabled' | 'eqGains'
    | 'repeatMode' | 'shuffleEnabled'
    | 'queueSource' | 'queueName'
    | 'playbackEngine' | 'lastErrorCode'
    | 'currentTrackIndex'
>>>;

const DEFAULT_EQ_GAINS: readonly number[] = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const DEFAULTS: PlayerStoreSnapshot = {
    isPlaying: false,
    isBuffering: false,
    isSeeking: false,
    currentTrackIndex: 0,
    currentTime: 0,
    duration: 0,
    fsmState: 'IDLE',

    volume: 1,
    playbackRate: 1,
    preservePitch: true,
    eqEnabled: false,
    eqGains: DEFAULT_EQ_GAINS,
    repeatMode: 'all',
    shuffleEnabled: false,
    queueSource: 'auto',
    queueName: '',
    playbackEngine: 'legacy',
    lastErrorCode: null,
};

export class PlayerStore {
    private readonly data: { -readonly [K in keyof PlayerStoreSnapshot]: PlayerStoreSnapshot[K] };
    private snapshot: PlayerStoreSnapshot;
    private readonly listeners = new Set<() => void>();

    constructor(init?: PlayerStoreInit) {
        if (init) {
            const merged = { ...DEFAULTS };
            const keys = Object.keys(init) as Array<keyof PlayerStoreInit>;
            for (const k of keys) {
                const v = init[k];
                if (v !== undefined) {
                    (merged as Record<string, unknown>)[k] = v;
                }
            }
            this.data = merged;
        } else {
            this.data = { ...DEFAULTS };
        }
        this.snapshot = { ...this.data } as PlayerStoreSnapshot;
    }

    getSnapshot(): PlayerStoreSnapshot {
        return this.snapshot;
    }

    get<K extends keyof PlayerStoreSnapshot>(key: K): PlayerStoreSnapshot[K] {
        return this.data[key];
    }

    write<K extends keyof PlayerStoreSnapshot>(key: K, value: PlayerStoreSnapshot[K]): void {
        (this.data as Record<string, unknown>)[key] = value;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return (): void => {
            this.listeners.delete(listener);
        };
    }

    patch(changes: Partial<PlayerStoreSnapshot>): void {
        let dirty = false;
        const keys = Object.keys(changes) as Array<keyof PlayerStoreSnapshot>;
        for (const k of keys) {
            const next = changes[k] as PlayerStoreSnapshot[typeof k];
            if (this.data[k] !== next) {
                (this.data as Record<string, unknown>)[k] = next;
                dirty = true;
            }
        }
        if (!dirty) return;
        this.snapshot = { ...this.data } as PlayerStoreSnapshot;
        this.notify();
    }

    private notify(): void {
        for (const fn of this.listeners) {
            try {
                fn();
            } catch (e) {
                if (typeof queueMicrotask === 'function') {
                    queueMicrotask(() => { throw e; });
                }
            }
        }
    }

    destroy(): void {
        this.listeners.clear();
    }
}
