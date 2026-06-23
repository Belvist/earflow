import React, { useState, useEffect, useRef, memo, useMemo } from 'react';

const LOADED_CACHE_MAX = 500;
const FAILED_CACHE_MAX = 200;
const MAX_RETRY_ATTEMPTS = 3;
const ERROR_CACHE_TTL = 5 * 60 * 1000;

const loadedCoversCache = new Map();
const failedCoversCache = new Map();

function lruSet(map, key, value, maxSize) {
    map.delete(key);
    map.set(key, value);
    if (map.size > maxSize) {
        map.delete(map.keys().next().value);
    }
}

function CachedCoverImageBase({
    src,
    alt,
    className,
    style,
    onLoad,
    onError,
    fallbackSrc,
    ...props
}) {
    const [imageSrc, setImageSrc] = useState(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!src) {
            setImageSrc(fallbackSrc || null);
            setHasError(true);
            return;
        }

        if (loadedCoversCache.has(src)) {
            setImageSrc(src);
            setIsLoaded(true);
            setHasError(false);
            return;
        }

        const failedEntry = failedCoversCache.get(src);
        if (failedEntry) {
            const { attempts, timestamp } = failedEntry;
            const isExpired = Date.now() - timestamp > ERROR_CACHE_TTL;

            if (!isExpired && attempts >= MAX_RETRY_ATTEMPTS) {
                setImageSrc(fallbackSrc || null);
                setHasError(true);
                return;
            }

            if (isExpired) {
                failedCoversCache.delete(src);
            }
        }

        setImageSrc(src);
        setIsLoaded(false);
        setHasError(false);
    }, [src, fallbackSrc]);

    const handleLoad = (e) => {
        if (!mountedRef.current) return;

        if (src) {
            lruSet(loadedCoversCache, src, true, LOADED_CACHE_MAX);
            failedCoversCache.delete(src);
        }

        setIsLoaded(true);
        setHasError(false);
        if (onLoad) onLoad(e);
    };

    const handleError = (e) => {
        if (!mountedRef.current) return;

        if (src) {
            const existing = failedCoversCache.get(src);
            const attempts = existing ? existing.attempts + 1 : 1;
            lruSet(failedCoversCache, src, { attempts, timestamp: Date.now() }, FAILED_CACHE_MAX);
        }

        setHasError(true);
        if (fallbackSrc) {
            setImageSrc(fallbackSrc);
        }
        if (onError) onError(e);
    };

    const imgStyle = useMemo(() => ({
        ...style,
        opacity: isLoaded || hasError ? 1 : 0.5,
        transition: 'opacity 0.2s ease',
    }), [style, isLoaded, hasError]);

    if (!imageSrc) {
        return null;
    }

    return (
        <img
            src={imageSrc}
            alt={alt || ''}
            className={className}
            style={imgStyle}
            onLoad={handleLoad}
            onError={handleError}
            loading="lazy"
            decoding="async"
            {...props}
        />
    );
}

const CachedCoverImage = memo(CachedCoverImageBase);

CachedCoverImage.displayName = 'CachedCoverImage';

export { CachedCoverImageBase };

export const clearCoverCache = () => {
    loadedCoversCache.clear();
    failedCoversCache.clear();
};

export const getCacheStats = () => ({
    loaded: loadedCoversCache.size,
    failed: failedCoversCache.size,
});

export default CachedCoverImage;
