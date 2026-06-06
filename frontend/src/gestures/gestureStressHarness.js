const DEFAULT_POINTER_ID = 7000;
const FRAME_MS = 16;

function isHarnessEnabled() {
  return typeof window !== 'undefined' && process.env.NODE_ENV !== 'production';
}

function wait(ms = 0) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function emitPointer(surface, type, point, pointerId) {
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

function getPoint(surface, offsetX = 0.5, offsetY = 0.5) {
  const rect = surface.getBoundingClientRect();
  return {
    x: rect.left + rect.width * offsetX,
    y: rect.top + rect.height * offsetY,
  };
}

async function runGesture(surface, gesture, index) {
  const pointerId = DEFAULT_POINTER_ID + (index % 97);
  const start = gesture.start || getPoint(surface, gesture.offsetX ?? 0.5, gesture.offsetY ?? 0.5);
  const steps = Math.max(1, Number(gesture.steps) || 1);
  emitPointer(surface, 'pointerdown', start, pointerId);
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    emitPointer(surface, 'pointermove', {
      x: start.x + (Number(gesture.dx) || 0) * progress,
      y: start.y + (Number(gesture.dy) || 0) * progress,
    }, pointerId);
    if (step % 3 === 0) await wait(0);
  }
  emitPointer(surface, gesture.cancel ? 'pointercancel' : 'pointerup', {
    x: start.x + (Number(gesture.dx) || 0),
    y: start.y + (Number(gesture.dy) || 0),
  }, pointerId);
}

export function installGestureStressHarness({ name, selector, createGesture, iterations = 1000 } = {}) {
  if (!isHarnessEnabled() || !name || !selector || typeof createGesture !== 'function') return null;
  const api = {
    run: async (options = {}) => {
      const total = Math.max(1, Number(options.iterations) || iterations);
      const errors = [];
      const startedAt = performance.now();
      for (let index = 0; index < total; index += 1) {
        const surface = document.querySelector(selector);
        if (!surface) {
          errors.push({ index, reason: 'surface-not-found' });
          break;
        }
        try {
          await runGesture(surface, createGesture(index, surface), index);
        } catch (error) {
          errors.push({ index, reason: error?.message || 'gesture-failed' });
        }
        if (index % 37 === 0) await wait(FRAME_MS);
      }
      await wait(FRAME_MS * 2);
      const diagnostics = window.__earflowGestureDiagnostics?.getSnapshot?.() || null;
      return {
        name,
        iterations: total,
        errors,
        durationMs: Math.round(performance.now() - startedAt),
        diagnostics,
      };
    },
  };
  window.__earflowGestureStress = window.__earflowGestureStress || {};
  window.__earflowGestureStress[name] = api;
  return api;
}
