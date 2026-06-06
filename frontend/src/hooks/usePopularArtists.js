import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../api/client';

function normalizeArtistItem(raw) {
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r) return null;

  const artistName = (r.artistName ?? r.name ?? r.artist ?? '').toString().trim();
  if (!artistName) return null;

  const artistPublicId = (r.artistPublicId ?? r.publicId ?? r.public_id ?? '').toString().trim().toLowerCase();
  const heroCoverPath = r.heroCoverPath ?? r.hero_cover_path ?? r.heroCover ?? r.hero_cover ?? null;
  const avatarCoverPath = r.avatarCoverPath ?? r.avatar_cover_path ?? null;
  const bannerCoverPath = r.bannerCoverPath ?? r.banner_cover_path ?? null;
  const isVerified = r.isVerified === true || r.is_verified === true;
  const trackCount = Number.isFinite(Number(r.trackCount ?? r.track_count)) ? Number(r.trackCount ?? r.track_count) : null;

  const coverPath =
    avatarCoverPath ||
    heroCoverPath ||
    bannerCoverPath ||
    r.avatar_cover_path ||
    r.hero_cover_path ||
    r.banner_cover_path ||
    null;
  const coverUrl = (() => {
    const p = coverPath === undefined || coverPath === null ? '' : String(coverPath).trim();
    if (!p) return null;
    if (/^https?:\/\//i.test(p)) return p;
    try {
      return apiClient.getCoverUrl({ cover_path: p });
    } catch {
      return null;
    }
  })();

  return {
    artistName,
    artistPublicId: artistPublicId && /^[A-Za-z0-9_-]{6,80}$/.test(artistPublicId) ? artistPublicId : null,
    heroCoverPath,
    avatarCoverPath,
    bannerCoverPath,
    coverUrl,
    isVerified,
    trackCount,
  };
}

export default function usePopularArtists({ limit = 12, autoLoad = true } = {}) {
  const safeLimit = useMemo(() => {
    const n = Number.parseInt(String(limit ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, 1), 48) : 12;
  }, [limit]);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(Boolean(autoLoad));
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [source, setSource] = useState(null);

  const abortRef = useRef(null);
  const isMountedRef = useRef(true);

  const loadPage = useCallback(async ({ nextOffset, append }) => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { }
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const data = await apiClient.getPopularArtists({ limit: safeLimit, offset: nextOffset, signal: controller.signal });
      if (!isMountedRef.current) return null;

      const rawItems = data && typeof data === 'object' && Array.isArray(data.items) ? data.items : [];
      const normalized = rawItems.map(normalizeArtistItem).filter(Boolean);

      setSource(data && typeof data === 'object' && typeof data.source === 'string' ? data.source : null);
      setOffset(nextOffset);
      setItems((prev) => (append ? [...prev, ...normalized] : normalized));
      return normalized;
    } catch (e) {
      if (!isMountedRef.current) return null;
      if (e?.name === 'AbortError') return null;
      setError(e?.message ? e.message : 'Failed to load popular artists');
      return null;
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [safeLimit]);

  const refresh = useCallback(() => loadPage({ nextOffset: 0, append: false }), [loadPage]);

  const loadMore = useCallback(() => {
    const nextOffset = offset + safeLimit;
    return loadPage({ nextOffset, append: true });
  }, [loadPage, offset, safeLimit]);

  useEffect(() => {
    isMountedRef.current = true;

    if (autoLoad) {
      refresh();
    } else {
      setLoading(false);
    }

    return () => {
      isMountedRef.current = false;
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { }
      }
    };
  }, [autoLoad, refresh]);

  const canLoadMore = useMemo(() => items.length >= safeLimit && !loading, [items.length, loading, safeLimit]);

  return {
    items,
    loading,
    error,
    source,
    refresh,
    loadMore,
    canLoadMore,
  };
}
