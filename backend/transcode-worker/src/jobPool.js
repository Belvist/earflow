'use strict';

/**
 * Tracks in-flight async jobs and per-queue concurrency (transcode vs waveform).
 */
function createJobPool({ transcodeConcurrency, waveformConcurrency, onActiveChange }) {
  const state = {
    transcodeConcurrency: Math.max(1, transcodeConcurrency),
    waveformConcurrency: Math.max(1, waveformConcurrency),
    activeTranscode: 0,
    activeWaveform: 0,
    inFlight: new Set(),
    onActiveChange: typeof onActiveChange === 'function' ? onActiveChange : null,
  };

  function emitActive() {
    if (state.onActiveChange) state.onActiveChange(activeCounts());
  }

  function canStart(kind) {
    if (kind === 'waveform') {
      return state.activeWaveform < state.waveformConcurrency;
    }
    return state.activeTranscode < state.transcodeConcurrency;
  }

  function activeCounts() {
    return {
      transcode: state.activeTranscode,
      waveform: state.activeWaveform,
      total: state.activeTranscode + state.activeWaveform,
      inFlight: state.inFlight.size,
    };
  }

  function schedule(kind, shutdownRequested, runner) {
    if (shutdownRequested) return null;
    if (!canStart(kind)) return null;

    if (kind === 'waveform') {
      state.activeWaveform += 1;
    } else {
      state.activeTranscode += 1;
    }

    const jobPromise = (async () => runner())();
    state.inFlight.add(jobPromise);

    emitActive();

    jobPromise.finally(() => {
      state.inFlight.delete(jobPromise);
      if (kind === 'waveform') {
        state.activeWaveform = Math.max(0, state.activeWaveform - 1);
      } else {
        state.activeTranscode = Math.max(0, state.activeTranscode - 1);
      }
      emitActive();
    });

    return jobPromise;
  }

  async function drainInFlight(timeoutMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (state.inFlight.size > 0 && Date.now() < deadline) {
      await Promise.race([...state.inFlight, sleep(250)]);
    }
    return state.inFlight.size === 0;
  }

  return {
    canStart,
    activeCounts,
    schedule,
    drainInFlight,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { createJobPool };
