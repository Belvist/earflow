import { useEffect, useRef, useState } from 'react';

const TICK_MS = 100;

export const useLyricsPlaybackTime = (playerState, fallbackTime) => {
    const st = playerState && typeof playerState === 'object' ? playerState : null;
    const audioRef = st?.audioRef;
    const currentTimeRef = st?.currentTimeRef;

    const fallbackRef = useRef(fallbackTime);
    fallbackRef.current = fallbackTime;

    const [time, setTime] = useState(() => {
        const fb = Number(fallbackTime);
        return Number.isFinite(fb) && fb >= 0 ? fb : 0;
    });

    const lastEmitRef = useRef(0);
    const timerRef = useRef(null);

    useEffect(() => {
        let active = true;

        const getTime = () => {
            const tAudio = Number(audioRef?.current?.currentTime);
            if (Number.isFinite(tAudio) && tAudio >= 0) return tAudio;

            const tRef2 = Number(currentTimeRef?.current);
            if (Number.isFinite(tRef2) && tRef2 >= 0) return tRef2;

            const fb = Number(fallbackRef.current);
            return Number.isFinite(fb) && fb >= 0 ? fb : 0;
        };

        const tick = () => {
            if (!active) return;

            const isHidden = typeof document !== 'undefined' && document.hidden;
            const now = performance.now();
            const interval = isHidden ? 1000 : TICK_MS;

            if (now - lastEmitRef.current >= interval) {
                lastEmitRef.current = now;
                setTime(getTime());
            }

            timerRef.current = setTimeout(tick, isHidden ? 1000 : TICK_MS);
        };

        timerRef.current = setTimeout(tick, TICK_MS);

        return () => {
            active = false;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [audioRef, currentTimeRef]);

    return time;
};
