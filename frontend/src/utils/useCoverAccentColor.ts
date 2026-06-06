import { useEffect, useState } from 'react';
import { extractDominantColor, toDarkenedRgba, type RgbColor } from './dominantColor';

export type CoverAccent = {
    color: RgbColor | null;
    background: string | null;
};

/**
 * Resolve the dominant color from a cover image URL and return it
 * darkened for use as a background (50% darken by default).
 */
export function useCoverAccentColor(
    coverUrl: string | null | undefined,
    darkenFactor = 0.5,
    alpha = 1,
): CoverAccent {
    const [color, setColor] = useState<RgbColor | null>(null);

    useEffect(() => {
        if (!coverUrl) {
            setColor(null);
            return;
        }

        let cancelled = false;
        extractDominantColor(coverUrl)
            .then((c) => {
                if (cancelled) return;
                setColor(c);
            })
            .catch(() => {
                if (cancelled) return;
                setColor(null);
            });

        return () => {
            cancelled = true;
        };
    }, [coverUrl]);

    return {
        color,
        background: toDarkenedRgba(color, darkenFactor, alpha),
    };
}
