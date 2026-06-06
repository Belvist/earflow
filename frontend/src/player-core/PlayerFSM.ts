export type PlayerFSMState =
    | 'IDLE'
    | 'LOADING'
    | 'PLAYING'
    | 'PAUSED'
    | 'SEEKING'
    | 'ERROR';

type TransitionRule = readonly [from: PlayerFSMState | '*', to: PlayerFSMState];

const TRANSITIONS: ReadonlyArray<TransitionRule> = [
    ['IDLE', 'LOADING'],
    ['LOADING', 'PLAYING'],
    ['LOADING', 'PAUSED'],
    ['LOADING', 'ERROR'],
    ['LOADING', 'IDLE'],
    ['PLAYING', 'PAUSED'],
    ['PLAYING', 'LOADING'],
    ['PLAYING', 'SEEKING'],
    ['PLAYING', 'IDLE'],
    ['PAUSED', 'PLAYING'],
    ['PAUSED', 'LOADING'],
    ['PAUSED', 'SEEKING'],
    ['PAUSED', 'IDLE'],
    ['SEEKING', 'PLAYING'],
    ['SEEKING', 'PAUSED'],
    ['SEEKING', 'LOADING'],
    ['SEEKING', 'IDLE'],
    ['ERROR', 'LOADING'],
    ['ERROR', 'IDLE'],
    ['*', 'IDLE'],
    ['*', 'ERROR'],
] as const;

export type FSMListener = (_next: PlayerFSMState, _prev: PlayerFSMState) => void;

export class PlayerFSM {
    private state: PlayerFSMState = 'IDLE';
    private priorToSeek: PlayerFSMState | null = null;
    private readonly listeners = new Set<FSMListener>();

    get current(): PlayerFSMState {
        return this.state;
    }

    transition(to: PlayerFSMState): boolean {
        const from = this.state;
        if (from === to) return true;

        const allowed = TRANSITIONS.some(([f, t]) => (f === '*' || f === from) && t === to);
        if (!allowed) return false;

        if (to === 'SEEKING') {
            this.priorToSeek = from;
        } else {
            this.priorToSeek = null;
        }

        this.state = to;
        this.emit(to, from);
        return true;
    }

    exitSeeking(): boolean {
        if (this.state !== 'SEEKING') return false;
        const target = this.priorToSeek ?? 'PLAYING';
        this.priorToSeek = null;
        return this.transition(target);
    }

    subscribe(fn: FSMListener): () => void {
        this.listeners.add(fn);
        return (): void => { this.listeners.delete(fn); };
    }

    reset(): void {
        const prev = this.state;
        this.state = 'IDLE';
        this.priorToSeek = null;
        if (prev !== 'IDLE') this.emit('IDLE', prev);
    }

    private emit(next: PlayerFSMState, prev: PlayerFSMState): void {
        for (const fn of this.listeners) {
            try { fn(next, prev); } catch { }
        }
    }
}
