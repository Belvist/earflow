import { useMemo } from 'react';
import usePlayerSheetState from './usePlayerSheetState';
import useMiniPlayerPan from './useMiniPlayerPan';

/**
 * Unified mini-player session: sheet physics + single pan controller (INV-GESTURE-012, INV-SHEET-010).
 */
export default function useMiniPlayerGestureSession({ player } = {}) {
  const sheet = usePlayerSheetState();
  const pan = useMiniPlayerPan({ sheet, player });

  const session = useMemo(() => ({
    phaseRef: sheet.phaseRef,
    sheetDragY: sheet.sheetDragY,
    sheetProgress: sheet.sheetProgress,
    open: sheet.open,
    beginDrag: sheet.beginExpandPan,
    beginSheetDrag: sheet.beginSheetDrag,
    applySheetDragDelta: sheet.applySheetDragDelta,
    settleDrag: sheet.settleDrag,
    cancel: sheet.cancel,
    finishOpen: sheet.finishOpen,
    finishClosed: sheet.finishClosed,
    recoverInteraction: sheet.recoverInteraction,
    resetOnTrackChange: sheet.resetOnTrackChange,
    getSheetClosedY: sheet.getSheetClosedY,
    stopSnapAnimation: sheet.stopSnapAnimation,
    miniOpacity: sheet.miniOpacity,
    miniScale: sheet.miniScale,
    miniY: sheet.miniY,
    miniRadius: sheet.miniRadius,
    modalVisible: sheet.modalVisible,
    sheetOpen: sheet.sheetOpen,
    miniBarPointerEvents: sheet.miniBarPointerEvents,
  }), [sheet]);

  return {
    session,
    sheet,
    controls: pan.controls,
    cleanupTrackAnimation: pan.cleanupTrackAnimation,
    recoverGestures: pan.forceUnlockGestures,
    forceUnlockGestures: pan.forceUnlockGestures,
    resetTrackVisual: pan.resetTrackVisual,
  };
}
