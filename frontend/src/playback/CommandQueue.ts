export type CommandTask<T> = () => Promise<T> | T;

export class CommandQueue {
    private tail: Promise<void> = Promise.resolve();

    run<T>(task: CommandTask<T>): Promise<T> {
        let resolve!: (_value: T) => void;
        let reject!: (_reason?: unknown) => void;

        const result = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });

        this.tail = this.tail
            .then(async () => {
                const value = await task();
                resolve(value);
            })
            .catch((e) => {
                reject(e);
            })
            .then(() => undefined);

        return result;
    }

    drain(): Promise<void> {
        return this.tail;
    }
}
