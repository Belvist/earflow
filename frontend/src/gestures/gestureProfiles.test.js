import { GESTURE_AXIS, IOS_GESTURE } from '../utils/gestureIntent';
import { GESTURE_PROFILE, getGestureProfile } from './gestureProfiles';

describe('gestureProfiles', () => {
  it('uses Spotify-style direction lock for mini-player', () => {
    const profile = getGestureProfile(GESTURE_PROFILE.MINI_PLAYER_OPEN);
    expect(profile.classify({ dx: 18, dy: -40 })).toBe(GESTURE_AXIS.VERTICAL);
    expect(profile.classify({ dx: 72, dy: -12 })).toBe(GESTURE_AXIS.HORIZONTAL);
    expect(profile.classify({ dx: 44, dy: -34 })).toBe(GESTURE_AXIS.HORIZONTAL);
  });

  it('mini-player profile never returns page scroll', () => {
    const profile = getGestureProfile(GESTURE_PROFILE.MINI_PLAYER_OPEN);
    expect(profile.classify({
      dx: 4,
      dy: 24,
      scrollY: 900,
      maxScrollY: 1200,
    })).toBe(null);
    expect(profile.classify({
      dx: 4,
      dy: -24,
      scrollY: 900,
      maxScrollY: 1200,
    })).toBe(GESTURE_AXIS.VERTICAL);
  });

  it('treats dismissDown as downward-only vertical intent', () => {
    const profile = getGestureProfile(GESTURE_PROFILE.DISMISS_DOWN);
    expect(profile.classify({ dx: 4, dy: IOS_GESTURE.intentPx + 8 })).toBe(GESTURE_AXIS.VERTICAL);
    expect(profile.classify({ dx: 4, dy: -(IOS_GESTURE.intentPx + 8) })).toBe(GESTURE_AXIS.SCROLL);
  });

  it('commits horizontal swipes through the profile strategy', () => {
    const profile = getGestureProfile(GESTURE_PROFILE.HORIZONTAL_SWIPE);
    expect(profile.commit({ dx: -IOS_GESTURE.swipeDistancePx, dy: 6, velocityX: 0 })).toBe(-1);
    expect(profile.commit({ dx: 40, dy: 38, velocityX: 900 })).toBe(0);
  });
});
