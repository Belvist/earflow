import {
  GESTURE_AXIS,
  IOS_GESTURE,
  classifyAxisIntent,
  classifyMiniBarSheetIntent,
  shouldCommitHorizontalSwipe,
  shouldCommitVerticalDismiss,
} from '../utils/gestureIntent';

export const GESTURE_PROFILE = Object.freeze({
  DEFAULT_AXIS: 'defaultAxis',
  MINI_PLAYER_OPEN: 'miniPlayerOpen',
  HORIZONTAL_SWIPE: 'horizontalSwipe',
  DISMISS_DOWN: 'dismissDown',
  SHEET_DRAG: 'sheetDrag',
  SEEK: 'seek',
});

export const gestureProfiles = Object.freeze({
  [GESTURE_PROFILE.DEFAULT_AXIS]: Object.freeze({
    id: GESTURE_PROFILE.DEFAULT_AXIS,
    intentPx: IOS_GESTURE.intentPx,
    classify: (input = {}) => classifyAxisIntent(input),
  }),
  [GESTURE_PROFILE.MINI_PLAYER_OPEN]: Object.freeze({
    id: GESTURE_PROFILE.MINI_PLAYER_OPEN,
    intentPx: IOS_GESTURE.intentPx,
    classify: (input = {}) => classifyMiniBarSheetIntent(input),
    commitOpen: ({ y, velocityY, height, travelY, chooseSnap, openTarget }) => {
      if (typeof chooseSnap !== 'function') return false;
      return chooseSnap({ y, velocityY, height, travelY }) === openTarget;
    },
  }),
  [GESTURE_PROFILE.HORIZONTAL_SWIPE]: Object.freeze({
    id: GESTURE_PROFILE.HORIZONTAL_SWIPE,
    intentPx: IOS_GESTURE.intentPx,
    classify: (input = {}) => classifyAxisIntent(input),
    commit: (input = {}) => shouldCommitHorizontalSwipe(input),
  }),
  [GESTURE_PROFILE.DISMISS_DOWN]: Object.freeze({
    id: GESTURE_PROFILE.DISMISS_DOWN,
    intentPx: IOS_GESTURE.intentPx,
    classify: (input = {}) => classifyAxisIntent({ ...input, verticalSign: 1 }),
    commit: (input = {}) => shouldCommitVerticalDismiss(input),
  }),
  [GESTURE_PROFILE.SHEET_DRAG]: Object.freeze({
    id: GESTURE_PROFILE.SHEET_DRAG,
    intentPx: IOS_GESTURE.intentPx,
    classify: (input = {}) => classifyAxisIntent(input),
  }),
  [GESTURE_PROFILE.SEEK]: Object.freeze({
    id: GESTURE_PROFILE.SEEK,
    intentPx: 0,
    classify: () => GESTURE_AXIS.HORIZONTAL,
  }),
});

export function getGestureProfile(profileId) {
  return gestureProfiles[profileId] || gestureProfiles[GESTURE_PROFILE.DEFAULT_AXIS];
}
