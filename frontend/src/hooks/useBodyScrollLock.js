import { useEffect, useRef } from 'react';

let lockCount = 0;
let savedState = null;

function lockBody() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const body = document.body;
    if (!body) return;

    const docEl = document.documentElement;

    if (lockCount === 0) {
        const scrollY = Number.isFinite(window.scrollY) ? window.scrollY : (window.pageYOffset || 0);

        savedState = {
            scrollY,
            body: {
                overflow: body.style.overflow || '',
                position: body.style.position || '',
                top: body.style.top || '',
                left: body.style.left || '',
                right: body.style.right || '',
                width: body.style.width || '',
                overscrollBehaviorY: body.style.overscrollBehaviorY || '',
            },
            docEl: {
                overscrollBehaviorY: docEl ? (docEl.style.overscrollBehaviorY || '') : '',
            },
        };

        body.style.overflow = 'hidden';
        body.style.position = 'fixed';
        body.style.top = `-${scrollY}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        body.style.overscrollBehaviorY = 'none';

        if (docEl) {
            docEl.style.overscrollBehaviorY = 'none';
        }
    }

    lockCount += 1;
}

function unlockBody() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const body = document.body;
    if (!body) return;

    if (lockCount <= 0) {
        lockCount = 0;
        return;
    }

    lockCount -= 1;
    if (lockCount > 0) return;

    const docEl = document.documentElement;
    const state = savedState;
    savedState = null;

    if (!state) {
        body.style.overflow = '';
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.width = '';
        body.style.overscrollBehaviorY = '';

        if (docEl) {
            docEl.style.overscrollBehaviorY = '';
        }

        return;
    }

    body.style.overflow = state.body.overflow;
    body.style.position = state.body.position;
    body.style.top = state.body.top;
    body.style.left = state.body.left;
    body.style.right = state.body.right;
    body.style.width = state.body.width;
    body.style.overscrollBehaviorY = state.body.overscrollBehaviorY;

    if (docEl) {
        docEl.style.overscrollBehaviorY = state.docEl.overscrollBehaviorY;
    }

    try {
        window.scrollTo(0, Math.max(0, state.scrollY || 0));
    } catch {
    }
}

export default function useBodyScrollLock(isLocked) {
    const appliedRef = useRef(false);

    useEffect(() => {
        const shouldLock = Boolean(isLocked);

        if (shouldLock && !appliedRef.current) {
            lockBody();
            appliedRef.current = true;
            return;
        }

        if (!shouldLock && appliedRef.current) {
            unlockBody();
            appliedRef.current = false;
        }
    }, [isLocked]);

    useEffect(() => {
        return () => {
            if (appliedRef.current) {
                unlockBody();
                appliedRef.current = false;
            }
        };
    }, []);
}
