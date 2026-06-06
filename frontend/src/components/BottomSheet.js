import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import useSheetDragArbitration from './BottomSheet/useSheetDragArbitration';
import { mobilePanelSurface } from './panels/panelSurface.styles';
import {
    getBottomSheetGeometry,
    getViewportHeight,
    pickBottomSheetSnapTarget,
    subscribeSheetGeometryInvalidation,
} from '../gestures/sheetGeometryRegistry';
import { GESTURE_SURFACE } from '../gestures/gestureContracts';

const Overlay = styled(motion.div)`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 10010;
`;

const Sheet = styled(motion.div)`
  position: fixed;
  left: ${props => props.$sideInset};
  right: ${props => props.$sideInset};
  bottom: ${props => props.$bottom};
  height: ${props => props.$height}px;
  ${mobilePanelSurface}
  z-index: 10020;
  display: flex;
  flex-direction: column;
  touch-action: pan-y;
  overscroll-behavior: contain;
  will-change: transform;
`;

const HandleWrap = styled.div`
  height: 56px;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
  overscroll-behavior: contain;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  flex-shrink: 0;
  position: relative;
  z-index: 2;

  &:active {
    cursor: grabbing;
  }
`;

const HandleBar = styled.div`
  width: 40px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.3);
`;

const Content = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  overscroll-behavior-y: contain;
`;

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function parseSnapPoints(points) {
    const result = [];
    for (const p of Array.isArray(points) ? points : []) {
        const n = Number(p);
        if (!Number.isFinite(n)) continue;
        result.push(clamp(n, 0.12, 0.98));
    }
    result.sort((a, b) => a - b);
    return result.length > 0 ? result : [0.6, 0.95];
}

export default function BottomSheet({
    isOpen,
    onClose,
    children,
    snapPoints = [0.6, 0.95],
    initialSnap = 0.6,
    bottomOffsetPx = 0,
    sideInsetPx = 0,
    topInsetPx = 8,
    closeThresholdPx = 80,
    showOverlay = true,
    contentPaddingBottomPx = 0,
}) {
    const y = useMotionValue(0);
    const animRef = useRef(null);
    const contentRef = useRef(null);

    const [viewportH, setViewportH] = useState(getViewportHeight);

    const normalizedSnapPoints = useMemo(() => parseSnapPoints(snapPoints), [snapPoints]);

    const geometry = useMemo(() => getBottomSheetGeometry({
        viewportHeight: viewportH,
        bottomOffsetPx,
        topInsetPx,
        snapPoints: normalizedSnapPoints,
    }), [bottomOffsetPx, normalizedSnapPoints, topInsetPx, viewportH]);

    const sheetHeight = geometry.sheetHeight;

    const bottomCss = useMemo(() => {
        const px = Math.max(0, Number(bottomOffsetPx) || 0);
        return px > 0 ? `calc(${px}px + env(safe-area-inset-bottom, 0px))` : 'env(safe-area-inset-bottom, 0px)';
    }, [bottomOffsetPx]);

    const sideInsetCss = useMemo(() => {
        const px = Math.max(0, Number(sideInsetPx) || 0);
        return px > 0
            ? `max(${px}px, env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px))`
            : 'max(env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px))';
    }, [sideInsetPx]);

    const hiddenY = geometry.hiddenY;
    const snapYs = geometry.snapYs;

    const initialY = useMemo(() => {
        const p = clamp(Number(initialSnap), 0.12, 0.98);
        return Math.round(sheetHeight * (1 - p));
    }, [initialSnap, sheetHeight]);

    useBodyScrollLock(isOpen);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const onResize = () => {
            setViewportH(getViewportHeight());
        };
        return subscribeSheetGeometryInvalidation(onResize);
    }, []);

    const stopAnim = useCallback(() => {
        if (animRef.current) {
            animRef.current.stop();
            animRef.current = null;
        }
    }, []);

    const animateTo = useCallback((targetY) => {
        stopAnim();
        animRef.current = animate(y, clamp(targetY, 0, hiddenY), {
            type: 'spring',
            stiffness: 460,
            damping: 36,
            mass: 0.9,
        });
    }, [hiddenY, stopAnim, y]);

    const pickSnapTarget = useCallback((currentY, velocityY) => {
        return pickBottomSheetSnapTarget({
            currentY,
            velocityY,
            snapYs,
            hiddenY,
            closeThresholdPx,
        });
    }, [closeThresholdPx, hiddenY, snapYs]);

    const sheetDragHandlers = useSheetDragArbitration({
        contentRef,
        y,
        hiddenY,
        stopAnim,
        pickSnapTarget,
        animateTo,
        onClose,
        thresholdPx: 10,
    });

    useEffect(() => {
        if (!isOpen) return;
        y.set(hiddenY);
        animateTo(initialY);
    }, [animateTo, hiddenY, initialY, isOpen, y]);

    useEffect(() => {
        if (!isOpen) return;

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                onClose?.();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    return (
        <AnimatePresence>
            {isOpen ? (
                <>
                    {showOverlay ? (
                        <Overlay
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            onMouseDown={(e) => {
                                if (e.target === e.currentTarget) onClose?.();
                            }}
                            onTouchStart={(e) => {
                                if (e.target === e.currentTarget) onClose?.();
                            }}
                        />
                    ) : null}

                    <Sheet
                        data-gesture-surface={GESTURE_SURFACE.BOTTOM_SHEET}
                        $height={sheetHeight}
                        $bottom={bottomCss}
                        $sideInset={sideInsetCss}
                        style={{ y }}
                        initial={false}
                    >
                        <HandleWrap
                            data-gesture-surface={GESTURE_SURFACE.SHEET_HANDLE_DRAG}
                            onPointerDown={sheetDragHandlers.onPointerDown}
                            onPointerMove={sheetDragHandlers.onPointerMove}
                            onPointerUp={sheetDragHandlers.onPointerUp}
                            onPointerCancel={sheetDragHandlers.onPointerCancel}
                        >
                            <HandleBar />
                        </HandleWrap>

                        <Content
                            ref={contentRef}
                            $contentPaddingBottom={Math.max(0, Number(contentPaddingBottomPx) || 0)}
                            onPointerDown={sheetDragHandlers.onPointerDown}
                            onPointerMove={sheetDragHandlers.onPointerMove}
                            onPointerUp={sheetDragHandlers.onPointerUp}
                            onPointerCancel={sheetDragHandlers.onPointerCancel}
                        >
                            {children}
                        </Content>
                    </Sheet>
                </>
            ) : null}
        </AnimatePresence>
    );
}
