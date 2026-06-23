type MetricType = 'counter' | 'gauge';

type Metric = {
    type: MetricType;
    value: number;
};

type Summary = {
    count: number;
    sum: number;
};

const metrics = new Map<string, Metric>();
const summaries = new Map<string, Summary>();

function getMetric(name: string, type: MetricType): Metric {
    const existing = metrics.get(name);
    if (existing) return existing;
    const created: Metric = { type, value: 0 };
    metrics.set(name, created);
    return created;
}

export function incCounter(name: string, delta = 1): void {
    const m = getMetric(name, 'counter');
    m.value += Number.isFinite(delta) ? delta : 0;
}

export function setGauge(name: string, value: number): void {
    const m = getMetric(name, 'gauge');
    m.value = Number.isFinite(value) ? value : 0;
}

export function observeMs(name: string, ms: number): void {
    const v = Number.isFinite(ms) ? ms : 0;
    const s = summaries.get(name) ?? { count: 0, sum: 0 };
    s.count += 1;
    s.sum += v;
    summaries.set(name, s);
}

export function renderPrometheus(): string {
    const lines: string[] = [];

    const names = [...metrics.keys()].sort();
    for (const name of names) {
        const m = metrics.get(name);
        if (!m) continue;
        lines.push(`# TYPE ${name} ${m.type}`);
        lines.push(`${name} ${m.value}`);
    }

    const snames = [...summaries.keys()].sort();
    for (const base of snames) {
        const s = summaries.get(base);
        if (!s) continue;
        lines.push(`# TYPE ${base} summary`);
        lines.push(`${base}_count ${s.count}`);
        lines.push(`${base}_sum ${s.sum}`);
    }

    return `${lines.join('\n')}\n`;
}
