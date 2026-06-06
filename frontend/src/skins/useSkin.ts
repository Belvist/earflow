import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { SKINS, DEFAULT_SKIN_ID, type Skin } from './skinDefinitions';

interface SkinContextValue {
    skin: Skin;
    skinId: string;
    setSkinId: (id: string) => void;
    availableSkins: Skin[];
}

const SkinContext = createContext<SkinContextValue | null>(null);

const STORAGE_KEY = 'earflow_skin_id';

function loadStoredSkinId(): string {
    try {
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (stored && SKINS[stored]) return stored;
    } catch { }
    return DEFAULT_SKIN_ID;
}

export { SkinContext };

export function useSkin(): SkinContextValue {
    const ctx = useContext(SkinContext);
    if (!ctx) throw new Error('useSkin must be used within SkinProvider');
    return ctx;
}

export function useSkinState(): SkinContextValue {
    const [skinId, setSkinIdRaw] = useState(loadStoredSkinId);

    const setSkinId = useCallback((id: string) => {
        if (!SKINS[id]) return;
        setSkinIdRaw(id);
        try {
            localStorage.setItem(STORAGE_KEY, id);
        } catch { }
    }, []);

    const skin = SKINS[skinId] || SKINS[DEFAULT_SKIN_ID];

    useEffect(() => {
        const root = typeof document !== 'undefined' ? document.documentElement : null;
        if (!root) return;
        const c = skin.colors;
        root.style.setProperty('--color-primary', c.primary);
        root.style.setProperty('--color-primary-hover', c.primaryHover);
        root.style.setProperty('--color-on-primary', c.onPrimary);
        root.style.setProperty('--color-background', c.background);
        root.style.setProperty('--color-surface', c.surface);
        root.style.setProperty('--color-surface-hover', c.surfaceHover);
        root.style.setProperty('--color-text', c.text);
        root.style.setProperty('--color-text-secondary', c.textSecondary);
        root.style.setProperty('--color-accent', c.accent);
        root.style.setProperty('--color-border', c.border);
        root.style.setProperty('--color-player-bg', c.playerBg);
        root.style.setProperty('--color-progress-bar', c.progressBar);
        root.style.setProperty('--color-progress-fill', c.progressBarFill);

        const p = skin.player;
        root.style.setProperty('--player-accent-gradient', p.accentGradient);
        root.style.setProperty('--player-progress-style', p.progressBarStyle);
        root.style.setProperty('--player-progress-radius',
            p.progressBarStyle === 'pill' ? '999px' : p.progressBarStyle === 'sharp' ? '0px' : '3px');
        root.style.setProperty('--player-cover-shadow', p.coverShadow);
        root.style.setProperty('--player-progress-glow', p.progressGlow ? '1' : '0');
    }, [skin]);

    const availableSkins = useMemo(() => Object.values(SKINS), []);

    return { skin, skinId, setSkinId, availableSkins };
}
