let initialized = false;

export function initAppViewport() {
    if (initialized) return;
    initialized = true;

    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const root = document.documentElement;

    let focusedEditable = false;

    const isEditableTarget = (target) => {
        if (!target || !(target instanceof Element)) return false;
        return Boolean(
            target.closest('input, textarea, select, [contenteditable="true"]')
        );
    };

    const update = () => {
        const viewport = window.visualViewport || null;
        const height = viewport && viewport.height ? viewport.height : window.innerHeight;
        const vh = height * 0.01;
        const rawKeyboardOffset = viewport
            ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
            : 0;
        const keyboardLikelyOpen = rawKeyboardOffset > 80 || (focusedEditable && window.innerWidth <= 768);
        const keyboardOffset = keyboardLikelyOpen ? Math.max(rawKeyboardOffset, focusedEditable ? 1 : 0) : 0;
        root.style.setProperty('--app-vh', `${vh}px`);
        root.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
        root.classList.toggle('keyboard-open', keyboardLikelyOpen);
    };

    update();

    const onResize = () => update();

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    window.addEventListener('focusin', (event) => {
        focusedEditable = isEditableTarget(event.target);
        update();
    }, { passive: true });
    window.addEventListener('focusout', () => {
        focusedEditable = false;
        window.setTimeout(update, 80);
    }, { passive: true });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onResize, { passive: true });
        window.visualViewport.addEventListener('scroll', onResize, { passive: true });
    }
}
