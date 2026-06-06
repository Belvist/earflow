export type WorkerMetrics = {
    startedAtMs: number;
    processedOk: number;
    processedError: number;
    stuckReleasedTotal: number;
    lastOkAtMs: number | null;
    lastErrorAtMs: number | null;
    lastErrorSongId: number | null;
    activeSongId: number | null;
};

export function createWorkerMetrics(): WorkerMetrics {
    return {
        startedAtMs: Date.now(),
        processedOk: 0,
        processedError: 0,
        stuckReleasedTotal: 0,
        lastOkAtMs: null,
        lastErrorAtMs: null,
        lastErrorSongId: null,
        activeSongId: null,
    };
}

function toUnixSeconds(ms: number | null): number {
    if (ms === null) return 0;
    const s = Math.floor(ms / 1000);
    return Number.isFinite(s) && s >= 0 ? s : 0;
}

export function renderPrometheus(metrics: WorkerMetrics): string {
    const nowMs = Date.now();
    const uptimeSeconds = Math.max(0, Math.floor((nowMs - metrics.startedAtMs) / 1000));

    const lines: string[] = [];

    lines.push('# HELP ebap_encoder_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE ebap_encoder_uptime_seconds gauge');
    lines.push(`ebap_encoder_uptime_seconds ${uptimeSeconds}`);

    lines.push('# HELP ebap_encoder_processed_total Total processed songs');
    lines.push('# TYPE ebap_encoder_processed_total counter');
    lines.push(`ebap_encoder_processed_total{status="ok"} ${metrics.processedOk}`);
    lines.push(`ebap_encoder_processed_total{status="error"} ${metrics.processedError}`);

    lines.push('# HELP ebap_encoder_stuck_released_total Jobs released from processing timeout');
    lines.push('# TYPE ebap_encoder_stuck_released_total counter');
    lines.push(`ebap_encoder_stuck_released_total ${metrics.stuckReleasedTotal}`);

    lines.push('# HELP ebap_encoder_last_ok_timestamp_seconds Last successful encode time');
    lines.push('# TYPE ebap_encoder_last_ok_timestamp_seconds gauge');
    lines.push(`ebap_encoder_last_ok_timestamp_seconds ${toUnixSeconds(metrics.lastOkAtMs)}`);

    lines.push('# HELP ebap_encoder_last_error_timestamp_seconds Last encode error time');
    lines.push('# TYPE ebap_encoder_last_error_timestamp_seconds gauge');
    lines.push(`ebap_encoder_last_error_timestamp_seconds ${toUnixSeconds(metrics.lastErrorAtMs)}`);

    lines.push('# HELP ebap_encoder_active_song_id Currently processed song id');
    lines.push('# TYPE ebap_encoder_active_song_id gauge');
    lines.push(`ebap_encoder_active_song_id ${metrics.activeSongId ?? 0}`);

    lines.push('# HELP ebap_encoder_last_error_song_id Last song id that failed');
    lines.push('# TYPE ebap_encoder_last_error_song_id gauge');
    lines.push(`ebap_encoder_last_error_song_id ${metrics.lastErrorSongId ?? 0}`);

    return lines.join('\n') + '\n';
}
