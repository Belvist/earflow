export class EventBus<TEvents extends Record<string, (..._args: any[]) => void>> {
    private readonly listeners: { [K in keyof TEvents]?: Array<TEvents[K]> } = {};

    on<K extends keyof TEvents>(event: K, listener: TEvents[K]): () => void {
        const arr = (this.listeners[event] ??= []);
        arr.push(listener);
        return () => {
            const current = this.listeners[event];
            if (!current) return;
            const idx = current.indexOf(listener);
            if (idx >= 0) current.splice(idx, 1);
        };
    }

    emit<K extends keyof TEvents>(event: K, ...args: Parameters<TEvents[K]>): void {
        const current = this.listeners[event];
        if (!current || current.length === 0) return;
        for (const fn of current.slice()) {
            fn(...args);
        }
    }

    clear(): void {
        for (const k of Object.keys(this.listeners)) {
            delete (this.listeners as any)[k];
        }
    }
}
