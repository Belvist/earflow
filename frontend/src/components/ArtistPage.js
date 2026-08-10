import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useNavigate, useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { usePlayer } from '../context/PlayerContext';
import {
  ArtistHeroSection,
  ArtistActionBar,
  ArtistPopularSection,
  ArtistDiscographyTabs,
  ArtistAboutSection,
  ArtistPageSkeleton,
} from './artist-page';
import { normalizeArtistNameForRoute } from '../utils/artist';
import { resolveArtistPath } from '../utils/artistRoute';
import { slugifyForRoute } from '../utils/routeSlug';
import { setPageMeta } from '../utils/seo';

const Page = styled.div`
  min-height: 0;
  background: var(--ef-surface-main, #0d0d0d);
  color: #fff;
  font-family: 'Unbounded', sans-serif;
  padding-bottom: 28px;

  @media (min-width: 768px) {
    padding-bottom: 36px;
  }
`;

const Center = styled.div`
  padding: 40px 24px;
  max-width: 980px;
  margin: 0 auto;
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  font-weight: 600;
`;

function parseArtistParam(value) {
  const raw = value === undefined || value === null ? '' : String(value);
  const normalized = raw.normalize('NFC').trim();
  const m = normalized.match(/^([a-f0-9]{32})(?:-.*)?$/i);
  if (m) return m[1].toLowerCase();
  return normalizeArtistNameForRoute(normalized) || normalized;
}

function safeText(v) {
  return (v ?? '').toString().trim();
}

function popularityScore(track) {
  const popularity = Number(track && (track.popularity ?? 0));
  const plays = Number(track && (track.play_count ?? track.playCount ?? 0));
  const p = Number.isFinite(popularity) ? popularity : 0;
  const c = Number.isFinite(plays) ? plays : 0;
  return p * 1_000_000 + c;
}

function fisherYatesShuffle(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function ArtistPage() {
  const navigate = useNavigate();
  const params = useParams();
  const player = usePlayer();

  const artist = useMemo(() => parseArtistParam(params.artist), [params.artist]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [meta, setMeta] = useState(null);

  const displayArtistName = useMemo(() => {
    const fromMeta = safeText(meta && (meta.artist ?? meta.artistName ?? meta.name));
    if (fromMeta) return fromMeta;
    const fromParam = safeText(artist);
    if (!fromParam) return 'Артист';
    if (/^[a-f0-9]{32}$/i.test(fromParam)) return 'Артист';
    return fromParam;
  }, [artist, meta]);

  const canonicalUrl = useMemo(() => {
    const pid = meta && meta.artistPublicId ? String(meta.artistPublicId).trim().toLowerCase() : '';
    if (!pid) return typeof window !== 'undefined' ? window.location.href : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://earflow.ru';
    const slug = slugifyForRoute(meta?.artist || displayArtistName);
    const path = `/artist/${encodeURIComponent(pid)}${slug ? `-${encodeURIComponent(slug)}` : ''}`;
    return `${origin}${path}`;
  }, [meta, displayArtistName]);

  useEffect(() => {
    if (!meta || typeof meta !== 'object') return;
    const pid = meta && meta.artistPublicId ? String(meta.artistPublicId).trim().toLowerCase() : '';
    if (!pid) return;
    const titleName = safeText(meta.artist || displayArtistName) || 'Артист';
    const description = titleName ? `Треки и релизы: ${titleName}` : 'Страница артиста в Earflow';
    const coverPath = safeText(meta.avatarCoverPath || meta.heroCoverPath || meta.bannerCoverPath);
    const image = coverPath ? apiClient.getCoverUrl({ cover_path: coverPath }) : undefined;
    setPageMeta({
      title: `${titleName} — Earflow`,
      description,
      canonicalUrl,
      image,
    });
  }, [meta, displayArtistName, canonicalUrl]);

  useEffect(() => {
    const controller = new AbortController();

    setMeta(null);
    setTracks([]);
    setError(null);

    if (!artist) {
      setLoading(false);
      return () => { controller.abort(); };
    }

    setLoading(true);

    const run = async () => {
      try {
        const [metaRes, tracksRes] = await Promise.all([
          apiClient.getArtistMeta(artist, { signal: controller.signal }),
          apiClient.getArtistTracks(artist, { limit: 200, offset: 0, signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;

        const nextMeta = metaRes && typeof metaRes === 'object' ? metaRes : null;
        const pid = nextMeta && nextMeta.artistPublicId ? String(nextMeta.artistPublicId).trim().toLowerCase() : '';
        setMeta(nextMeta);
        setTracks(Array.isArray(tracksRes) ? tracksRes : []);

        if (pid && typeof params.artist === 'string') {
          const currentRaw = params.artist.toString().normalize('NFC').trim();
          const current = currentRaw.toLowerCase();
          const slug = slugifyForRoute(nextMeta.artist || artist);
          const canonicalParam = `${pid}${slug ? `-${slug}` : ''}`;
          const canonical = `/artist/${encodeURIComponent(pid)}${slug ? `-${encodeURIComponent(slug)}` : ''}`;
          if (current !== canonicalParam.toLowerCase()) {
            navigate(canonical, { replace: true });
          }
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e && e.name === 'AbortError') return;
        setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Ошибка загрузки');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      controller.abort();
    };
  }, [artist, params.artist, navigate]);

  const allTracks = useMemo(() => (Array.isArray(tracks) ? tracks : []), [tracks]);

  const popularTracks = useMemo(() => {
    return [...allTracks].sort((a, b) => popularityScore(b) - popularityScore(a));
  }, [allTracks]);

  const heroImageUrl = useMemo(() => {
    const heroCoverPath = meta && typeof meta.heroCoverPath === 'string' ? meta.heroCoverPath.trim() : '';
    if (heroCoverPath) return apiClient.getCoverUrl({ cover_path: heroCoverPath });

    const fallback = [...allTracks].sort((a, b) => popularityScore(b) - popularityScore(a)).find((t) => apiClient.getCoverUrl(t));
    return fallback ? apiClient.getCoverUrl(fallback) : null;
  }, [meta, allTracks]);

  const bannerImageUrl = useMemo(() => {
    const bannerPath = meta && typeof meta.bannerCoverPath === 'string' ? meta.bannerCoverPath.trim() : '';
    if (bannerPath) return apiClient.getCoverUrl({ cover_path: bannerPath });
    return heroImageUrl;
  }, [meta, heroImageUrl]);

  const avatarImageUrl = useMemo(() => {
    const avatarPath = meta && typeof meta.avatarCoverPath === 'string' ? meta.avatarCoverPath.trim() : '';
    if (avatarPath) return apiClient.getCoverUrl({ cover_path: avatarPath });
    return heroImageUrl;
  }, [meta, heroImageUrl]);

  const totalPlays = meta && meta.totalPlays !== null && meta.totalPlays !== undefined ? meta.totalPlays : null;
  const trackCount = useMemo(() => {
    const metaCount = meta && Number.isFinite(Number(meta.trackCount)) ? Number(meta.trackCount) : null;
    const loaded = allTracks.length;
    if (metaCount === null) return loaded;
    return Math.max(loaded, metaCount);
  }, [meta, allTracks]);
  const albumCount = meta && Number.isFinite(Number(meta.albumCount)) ? Number(meta.albumCount) : 0;
  const isVerified = !!(meta && meta.isVerified === true);
  const bio = meta && typeof meta.bio === 'string' ? meta.bio : '';

  const playAll = useCallback(() => {
    if (popularTracks.length === 0) return;
    player.playFromList(popularTracks, popularTracks[0].id, displayArtistName);
  }, [player, popularTracks, displayArtistName]);

  const shuffleAll = useCallback(() => {
    if (allTracks.length === 0) return;
    const shuffled = fisherYatesShuffle(allTracks);
    if (shuffled.length === 0) return;
    player.playFromList(shuffled, shuffled[0].id, displayArtistName);
  }, [player, allTracks, displayArtistName]);

  const playTrack = useCallback((trackId) => {
    if (popularTracks.length === 0) return;
    player.playFromList(popularTracks, trackId, displayArtistName);
  }, [player, popularTracks, displayArtistName]);

  const startArtistRadio = useCallback(async () => {
    const raw = displayArtistName || artist;
    if (!raw) return;
    try {
      const excludeIds = allTracks.map((t) => t?.id).filter(Boolean).join(',');
      const radio = await apiClient.getArtistRadio(raw, {
        limit: 30,
        userId: player.userId ?? null,
        exclude: excludeIds,
      });
      if (!Array.isArray(radio) || radio.length === 0) return;
      player.playFromList(radio, radio[0].id, `${raw} Radio`);
    } catch { }
  }, [displayArtistName, artist, allTracks, player]);

  const seeAllTracks = useCallback(() => {
    void resolveArtistPath(apiClient, params.artist)
      .then((path) => {
        if (path) navigate(`${path}/tracks`);
      })
      .catch(() => { });
  }, [params.artist, navigate]);

  const playRelease = useCallback((release) => {
    if (!release || !Array.isArray(release.tracks) || release.tracks.length === 0) return;
    const first = release.tracks[0];
    player.playFromList(release.tracks, first.id, release.name || displayArtistName);
  }, [player, displayArtistName]);

  const openRelease = useCallback(async (release) => {
    if (!release || !Array.isArray(release.tracks) || release.tracks.length === 0) return;

    if (release.kind === 'single') {
      playRelease(release);
      return;
    }

    const albumName = release.name;
    if (!albumName) {
      playRelease(release);
      return;
    }

    try {
      const resolved = await apiClient.resolveAlbumPublicId(displayArtistName, albumName);
      const pid = resolved && (resolved.albumPublicId || resolved.album_public_id)
        ? String(resolved.albumPublicId || resolved.album_public_id)
        : '';
      if (pid) {
        const slug = slugifyForRoute(albumName);
        navigate(`/album/${encodeURIComponent(pid)}${slug ? `-${encodeURIComponent(slug)}` : ''}`);
        return;
      }
    } catch { }

    if (displayArtistName) {
      navigate(`/album/${encodeURIComponent(displayArtistName)}/${encodeURIComponent(albumName)}`);
      return;
    }

    playRelease(release);
  }, [displayArtistName, navigate, playRelease]);

  const canPlay = allTracks.length > 0;

  return (
    <Page>
      <ArtistHeroSection
        artistName={displayArtistName}
        isVerified={isVerified}
        bannerImageUrl={bannerImageUrl}
        avatarImageUrl={avatarImageUrl}
        trackCount={trackCount}
        totalPlays={totalPlays}
        onBack={() => navigate(-1)}
      />

      <ArtistActionBar
        canPlay={canPlay}
        onPlayAll={playAll}
        onShuffle={shuffleAll}
        onStartRadio={startArtistRadio}
        artistName={displayArtistName}
        shareUrl={canonicalUrl}
      />

      {loading ? (
        <ArtistPageSkeleton />
      ) : error ? (
        <Center>{error}</Center>
      ) : (
        <>
          <ArtistPopularSection
            tracks={popularTracks}
            onPlayTrack={playTrack}
            onSeeAll={seeAllTracks}
          />
          <ArtistDiscographyTabs
            tracks={allTracks}
            onPlayRelease={playRelease}
            onOpenRelease={openRelease}
          />
          <ArtistAboutSection
            bio={bio}
            isVerified={isVerified}
            trackCount={trackCount}
            albumCount={albumCount}
            totalPlays={totalPlays}
          />
        </>
      )}
    </Page>
  );
}
