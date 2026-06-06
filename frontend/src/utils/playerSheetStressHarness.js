const DEFAULT_ITERATIONS = 10000;
const DEFAULT_POINTER_ID = 9001;
const FRAME_MS = 16;

function isHarnessEnabled() {
  return typeof window !== 'undefined' && process.env.NODE_ENV !== 'production';
}

function wait(ms = 0) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getSurface() {
  return document.querySelector('[data-player-sheet-gesture-surface="true"]');
}

function getPoint(surface, offsetX = 0.5, offsetY = 0.5) {
  const rect = surface.getBoundingClientRect();
  return {
    x: rect.left + rect.width * offsetX,
    y: rect.top + rect.height * offsetY,
  };
}

function emitPointer(surface, type, point, pointerId = DEFAULT_POINTER_ID) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    clientX: point.x,
    clientY: point.y,
  });
  surface.dispatchEvent(event);
}

function createGesture(index, surface) {
  const start = getPoint(surface, 0.52, 0.5);
  const pattern = index % 8;
  if (pattern === 0) return { dx: 0, dy: -520, steps: 8, end: 'up' };
  if (pattern === 1) return { dx: 0, dy: -92, steps: 4, end: 'up' };
  if (pattern === 2) return { dx: -160, dy: -8, steps: 5, end: 'up' };
  if (pattern === 3) return { dx: 160, dy: 12, steps: 5, end: 'up' };
  if (pattern === 4) return { dx: 62, dy: -88, steps: 6, end: 'up' };
  if (pattern === 5) return { dx: 0, dy: -760, steps: 5, end: 'cancel' };
  if (pattern === 6) return { dx: 22, dy: 96, steps: 4, end: 'up' };
  return { dx: ((index * 37) % 180) - 90, dy: -(((index * 53) % 720) + 24), steps: 3 + (index % 7), end: 'up', start };
}

async function runGesture(surface, gesture, index) {
  const pointerId = DEFAULT_POINTER_ID + (index % 29);
  const start = gesture.start || getPoint(surface, 0.52, 0.5);
  emitPointer(surface, 'pointerdown', start, pointerId);
  for (let step = 1; step <= gesture.steps; step += 1) {
    const progress = step / gesture.steps;
    emitPointer(surface, 'pointermove', {
      x: start.x + gesture.dx * progress,
      y: start.y + gesture.dy * progress,
    }, pointerId);
    if (step % 3 === 0) await wait(0);
  }
  const end = {
    x: start.x + gesture.dx,
    y: start.y + gesture.dy,
  };
  emitPointer(surface, gesture.end === 'cancel' ? 'pointercancel' : 'pointerup', end, pointerId);
  if (index % 19 === 0) window.dispatchEvent(new Event('resize'));
  if (index % 37 === 0) await wait(FRAME_MS);
}

export function installPlayerSheetStressHarness() {
  if (!isHarnessEnabled()) return null;
  const api = {
    run: async ({ iterations = DEFAULT_ITERATIONS } = {}) => {
      const total = Math.max(1, Number(iterations) || DEFAULT_ITERATIONS);
      const startedAt = performance.now();
      const errors = [];
      for (let index = 0; index < total; index += 1) {
        const surface = getSurface();
        if (!surface) {
          errors.push({ index, reason: 'surface-not-found' });
          break;
        }
        try {
          await runGesture(surface, createGesture(index, surface), index);
        } catch (error) {
          errors.push({ index, reason: error?.message || 'gesture-failed' });
        }
      }
      await wait(FRAME_MS * 3);
      return {
        iterations: total,
        errors,
        durationMs: Math.round(performance.now() - startedAt),
        diagnostics: window.__earflowGestureDiagnostics?.getSnapshot?.() || null,
      };
    },
  };
  window.__earflowPlayerSheetStress = api;
  return api;
}
