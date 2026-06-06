/**
 * Play/pause glyphs aligned to design refs (Frame 35–38).
 * viewBox 32×32 — metallic ring icons + adaptive (no ring).
 */

/** Rounded play triangle — ref Frame 35 / 38 */
export const IOS_PLAY_PATH =
  'M12.25 10.85c-.33 0-.6.27-.6.6v9.1c0 .33.27.6.6.6.15 0 .3-.06.41-.17l7.7-4.85c.28-.18.28-.6 0-.78l-7.7-4.85c-.11-.11-.26-.17-.41-.17z';

/** Capsule pause bars — ref Frame 36 / 37 */
export const IOS_PAUSE_RECTS = [
  { x: 10.65, y: 10, w: 3.5, h: 12, rx: 1.75 },
  { x: 17.85, y: 10, w: 3.5, h: 12, rx: 1.75 },
];

export const ADAPTIVE_PLAY_PATH = IOS_PLAY_PATH;

export const ADAPTIVE_PAUSE_RECTS = [
  { x: 10.4, y: 9.6, w: 3.8, h: 12.8, rx: 1.9 },
  { x: 17.8, y: 9.6, w: 3.8, h: 12.8, rx: 1.9 },
];
