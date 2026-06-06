'use strict';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function nonNegative(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function createMetrics(options = {}) {
  const state = {
    startedAt: Date.now(),
    ready: false,
    shutdownRequested: false,
    activeJobs: 0,
    activeTranscodeJobs: 0,
    activeWaveformJobs: 0,
    concurrency: Math.max(1, Number(options.concurrency || 1)),
    waveformConcurrency: Math.max(1, Number(options.waveformConcurrency || 1)),
    claimedTotal: 0,
    completedTotal: 0,
    failedTotal: 0,
    requeuedFailedTotal: 0,
    uploadedBytesTotal: 0,
    variantsUploadedTotal: 0,
    lastPollAt: 0,
    lastJobStartedAt: 0,
    lastJobFinishedAt: 0,
    lastErrorAt: 0,
    lastError: '',
  };

  return {
    setReady(value) {
      state.ready = Boolean(value);
    },
    setShutdownRequested(value) {
      state.shutdownRequested = Boolean(value);
    },
    setActiveJobs(total, transcode, waveform) {
      if (transcode === undefined) {
        state.activeJobs = nonNegative(total);
        return;
      }
      state.activeTranscodeJobs = nonNegative(transcode);
      state.activeWaveformJobs = nonNegative(waveform);
      state.activeJobs = nonNegative(total);
    },
    markPoll() {
      state.lastPollAt = nowSeconds();
    },
    markJobClaimed() {
      state.claimedTotal += 1;
    },
    markJobStarted() {
      state.lastJobStartedAt = nowSeconds();
    },
    markJobCompleted(result = {}) {
      state.completedTotal += 1;
      state.variantsUploadedTotal += nonNegative(result.variants);
      state.uploadedBytesTotal += nonNegative(result.bytes);
      state.lastJobFinishedAt = nowSeconds();
    },
    markJobFailed(err) {
      state.failedTotal += 1;
      state.lastJobFinishedAt = nowSeconds();
      state.lastErrorAt = nowSeconds();
      state.lastError = String(err?.message || err || 'unknown').slice(0, 500);
    },
    markRequeued(count) {
      state.requeuedFailedTotal += nonNegative(count);
    },
    markError(err) {
      state.lastErrorAt = nowSeconds();
      state.lastError = String(err?.message || err || 'unknown').slice(0, 500);
    },
    snapshot() {
      return {
        ok: state.ready && !state.shutdownRequested,
        status: state.shutdownRequested ? 'shutting_down' : state.ready ? 'healthy' : 'starting',
        ready: state.ready,
        shutdownRequested: state.shutdownRequested,
        activeJobs: state.activeJobs,
        activeTranscodeJobs: state.activeTranscodeJobs,
        activeWaveformJobs: state.activeWaveformJobs,
        concurrency: state.concurrency,
        waveformConcurrency: state.waveformConcurrency,
        claimedTotal: state.claimedTotal,
        completedTotal: state.completedTotal,
        failedTotal: state.failedTotal,
        requeuedFailedTotal: state.requeuedFailedTotal,
        variantsUploadedTotal: state.variantsUploadedTotal,
        uploadedBytesTotal: state.uploadedBytesTotal,
        lastPollAt: state.lastPollAt || null,
        lastJobStartedAt: state.lastJobStartedAt || null,
        lastJobFinishedAt: state.lastJobFinishedAt || null,
        lastErrorAt: state.lastErrorAt || null,
        lastError: state.lastError || null,
        uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
      };
    },
    prometheusText() {
      const up = state.ready && !state.shutdownRequested ? 1 : 0;
      const uptime = Math.floor((Date.now() - state.startedAt) / 1000);
      return [
        '# HELP transcode_worker_up Worker readiness state.',
        '# TYPE transcode_worker_up gauge',
        `transcode_worker_up ${up}`,
        '# HELP transcode_worker_active_jobs Active jobs (transcode + waveform).',
        '# TYPE transcode_worker_active_jobs gauge',
        `transcode_worker_active_jobs ${state.activeJobs}`,
        '# HELP transcode_worker_active_transcode_jobs Active transcode jobs.',
        '# TYPE transcode_worker_active_transcode_jobs gauge',
        `transcode_worker_active_transcode_jobs ${state.activeTranscodeJobs}`,
        '# HELP transcode_worker_active_waveform_jobs Active waveform-only jobs.',
        '# TYPE transcode_worker_active_waveform_jobs gauge',
        `transcode_worker_active_waveform_jobs ${state.activeWaveformJobs}`,
        '# HELP transcode_worker_concurrency Configured transcode concurrency.',
        '# TYPE transcode_worker_concurrency gauge',
        `transcode_worker_concurrency ${state.concurrency}`,
        '# HELP transcode_worker_waveform_concurrency Configured waveform-only concurrency.',
        '# TYPE transcode_worker_waveform_concurrency gauge',
        `transcode_worker_waveform_concurrency ${state.waveformConcurrency}`,
        '# HELP transcode_worker_jobs_claimed_total Claimed transcode jobs.',
        '# TYPE transcode_worker_jobs_claimed_total counter',
        `transcode_worker_jobs_claimed_total ${state.claimedTotal}`,
        '# HELP transcode_worker_jobs_completed_total Completed transcode jobs.',
        '# TYPE transcode_worker_jobs_completed_total counter',
        `transcode_worker_jobs_completed_total ${state.completedTotal}`,
        '# HELP transcode_worker_jobs_failed_total Failed transcode jobs.',
        '# TYPE transcode_worker_jobs_failed_total counter',
        `transcode_worker_jobs_failed_total ${state.failedTotal}`,
        '# HELP transcode_worker_jobs_requeued_failed_total Failed jobs moved back to pending.',
        '# TYPE transcode_worker_jobs_requeued_failed_total counter',
        `transcode_worker_jobs_requeued_failed_total ${state.requeuedFailedTotal}`,
        '# HELP transcode_worker_variants_uploaded_total Uploaded output variants.',
        '# TYPE transcode_worker_variants_uploaded_total counter',
        `transcode_worker_variants_uploaded_total ${state.variantsUploadedTotal}`,
        '# HELP transcode_worker_uploaded_bytes_total Uploaded output bytes.',
        '# TYPE transcode_worker_uploaded_bytes_total counter',
        `transcode_worker_uploaded_bytes_total ${state.uploadedBytesTotal}`,
        '# HELP transcode_worker_last_poll_timestamp_seconds Last poll timestamp.',
        '# TYPE transcode_worker_last_poll_timestamp_seconds gauge',
        `transcode_worker_last_poll_timestamp_seconds ${state.lastPollAt}`,
        '# HELP transcode_worker_last_job_started_timestamp_seconds Last job start timestamp.',
        '# TYPE transcode_worker_last_job_started_timestamp_seconds gauge',
        `transcode_worker_last_job_started_timestamp_seconds ${state.lastJobStartedAt}`,
        '# HELP transcode_worker_last_job_finished_timestamp_seconds Last job finish timestamp.',
        '# TYPE transcode_worker_last_job_finished_timestamp_seconds gauge',
        `transcode_worker_last_job_finished_timestamp_seconds ${state.lastJobFinishedAt}`,
        '# HELP transcode_worker_last_error_timestamp_seconds Last worker error timestamp.',
        '# TYPE transcode_worker_last_error_timestamp_seconds gauge',
        `transcode_worker_last_error_timestamp_seconds ${state.lastErrorAt}`,
        '# HELP transcode_worker_uptime_seconds Worker uptime in seconds.',
        '# TYPE transcode_worker_uptime_seconds gauge',
        `transcode_worker_uptime_seconds ${uptime}`,
        '',
      ].join('\n');
    },
  };
}

module.exports = { createMetrics };
