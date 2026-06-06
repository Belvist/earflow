type Handler<T> = T extends void ? () => void : (payload: T) => void;

export class PlayerEventEmitter<Events extends Record<string, unknown>> {
    private readonly map: { [K in keyof Events]?: Array<Handler<Events[K]>> } = Object.create(null);

    on<K extends keyof Events>(event: K, fn: Handler<Events[K]>): () => void {
        if (!this.map[event]) this.map[event] = [] as Array<Handler<Events[K]>>;
        this.map[event]!.push(fn);
        return (): void => {
            const arr = this.map[event];
            if (!arr) return;
            const idx = arr.indexOf(fn);
            if (idx >= 0) arr.splice(idx, 1);
        };
    }

    emit<K extends keyof Events>(event: K, ...args: Events[K] extends void ? [] : [payload: Events[K]]): void {
        const arr = this.map[event];
        if (!arr?.length) return;
        const payload = args[0] as Events[K];
        for (const fn of arr.slice()) {
            try {
                (fn as (p: Events[K]) => void)(payload);
            } catch (e) {
                if (typeof queueMicrotask === 'function') {
                    queueMicrotask(() => { throw e; });
                }
            }
        }
    }

    destroy(): void {
        for (const key of Object.keys(this.map) as Array<keyof Events>) {
            delete this.map[key];
        }
    }
}
