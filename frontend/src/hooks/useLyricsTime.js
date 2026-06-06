import { useEffect, useRef, useState } from 'react';

const TICK_MS = 100;

export const useLyricsTime = (audioRef, fallbackTime) => {
    const fallbackRef = useRef(fallbackTime);
    fallbackRef.current = fallbackTime;

    const [time, setTime] = useState(() => {
        const a = audioRef?.current;
        if (a) {
            const t = Number(a.currentTime);
            if (Number.isFinite(t) && t >= 0) return t;
        }
        const fb = Number(fallbackTime);
        return Number.isFinite(fb) && fb >= 0 ? fb : 0;
    });

    const lastEmitRef = useRef(0);
    const timerRef = useRef(null);

    useEffect(() => {
        let active = true;

        const tick = () => {
            if (!active) return;

            const isHidden = typeof document !== 'undefined' && document.hidden;
            const interval = isHidden ? 1000 : TICK_MS;

            const a = audioRef?.current;
            if (!a) {
                const fb = Number(fallbackRef.current);
                if (Number.isFinite(fb) && fb >= 0) {
                    setTime((prev) => Math.abs(prev - fb) > 0.05 ? fb : prev);
                }
                timerRef.current = setTimeout(tick, interval);
                return;
            }

            const t = Number(a.currentTime);
            const now = performance.now();

            if (Number.isFinite(t) && t >= 0 && (now - lastEmitRef.current >= interval)) {
                lastEmitRef.current = now;
                setTime(t);
            }

            timerRef.current = setTimeout(tick, interval);
        };

        timerRef.current = setTimeout(tick, TICK_MS);

        return () => {
            active = false;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [audioRef]);

    return time;
};
