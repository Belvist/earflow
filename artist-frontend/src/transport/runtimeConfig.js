export const getArtistRuntimeConfig = () => {
    try {
        if (typeof window === 'undefined') return Object.freeze({});
        const cfg = window.__EARFLOW_ARTIST_RUNTIME_CONFIG__;
        if (!cfg || typeof cfg !== 'object') return Object.freeze({});
        return cfg;
    } catch {
        return Object.freeze({});
    }
};
