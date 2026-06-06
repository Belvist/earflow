import React, { useEffect, useMemo, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useNavigate, useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { usePlayer } from '../context/PlayerContext';
import ArtistTracksSection from './ArtistTracksSection';
import { normalizeArtistParamForApi } from '../utils/artistRoute';
import { resolveArtistPath } from '../utils/artistRoute';
import { extractArtistPublicIdFromRouteParam } from '../utils/artistRoute';
import { slugifyForRoute } from '../utils/routeSlug';

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
  padding: 24px;
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.65);
`;

function safeText(v) {
    return (v ?? '').toString().trim();
}

function parseArtistParam(value) {
    return normalizeArtistParamForApi(value);
}

function getYearValue(t) {
    const y = t && (t.year ?? t.release_year ?? t.releaseYear);
    const n = parseInt(String(y ?? ''), 10);
    return Number.isFinite(n) ? n : null;
}

function popularityScore(t) {
    const popularity = Number(t && (t.popularity ?? 0));
    const plays = Number(t && (t.play_count ?? t.playCount ?? 0));
    const p = Number.isFinite(popularity) ? popularity : 0;
    const c = Number.isFinite(plays) ? plays : 0;
    return p * 1_000_000 + c;
}

function sortByNew(a, b) {
    const ad = safeText(a && (a.created_at ?? a.createdAt));
    const bd = safeText(b && (b.created_at ?? b.createdAt));
    if (ad && bd) return bd.localeCompare(ad);
    return (Number(b && b.id) || 0) - (Number(a && a.id) || 0);
}

export default function ArtistTracksPage() {
    const navigate = useNavigate();
    const params = useParams();
    const player = usePlayer();
    const artist = useMemo(() => parseArtistParam(params.artist), [params.artist]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [tracks, setTracks] = useState([]);
    const [sort, setSort] = useState('popular');
    const [year, setYear] = useState(null);

    useEffect(() => {
        setSort('popular');
        setYear(null);
    }, [artist]);

    useEffect(() => {
        const controller = new AbortController();

        const run = async () => {
            if (!artist) {
                setLoading(false);
                setTracks([]);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                let canonicalMeta = null;
                try {
                    canonicalMeta = await apiClient.getArtistMeta(artist, { signal: controller.signal });
                } catch {
                    canonicalMeta = null;
                }

                const pid = canonicalMeta && canonicalMeta.artistPublicId ? String(canonicalMeta.artistPublicId).trim().toLowerCase() : '';
                if (pid && typeof params.artist === 'string') {
                    const currentRaw = params.artist.toString().normalize('NFC').trim();
                    const currentLower = currentRaw.toLowerCase();
                    const extracted = extractArtistPublicIdFromRouteParam(currentRaw);
                    const currentPid = extracted && extracted.publicId ? String(extracted.publicId).toLowerCase() : '';
                    const slug = slugifyForRoute(canonicalMeta.artist || pid);
                    const canonicalParam = `${pid}${slug ? `-${slug}` : ''}`;
                    if (currentPid !== pid || currentLower !== canonicalParam.toLowerCase()) {
                        const canonical = `/artist/${encodeURIComponent(pid)}${slug ? `-${encodeURIComponent(slug)}` : ''}/tracks`;
                        navigate(canonical, { replace: true });
                    }
                }

                const tracksRes = await apiClient.getArtistTracks(artist, { limit: 500, offset: 0, signal: controller.signal });
                if (controller.signal.aborted) return;
                setTracks(Array.isArray(tracksRes) ? tracksRes : []);
            } catch (e) {
                if (controller.signal.aborted) return;
                setTracks([]);
                setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Ошибка загрузки');
            } finally {
                if (controller.signal.aborted) return;
                setLoading(false);
            }
        };

        void run();
        return () => {
            controller.abort();
        };
    }, [artist]);

    const allTracks = useMemo(() => (Array.isArray(tracks) ? tracks : []), [tracks]);

    const years = useMemo(() => {
        const set = new Set();
        for (const t of allTracks) {
            const y = getYearValue(t);
            if (y) set.add(y);
        }
        return Array.from(set);
    }, [allTracks]);

    const viewTracks = useMemo(() => {
        const filtered = year ? allTracks.filter((t) => getYearValue(t) === year) : allTracks;
        const sorted = [...filtered].sort((a, b) => {
            if (sort === 'popular') return popularityScore(b) - popularityScore(a);
            return sortByNew(a, b);
        });
        return sorted;
    }, [allTracks, sort, year]);

    const onPlayTrack = useCallback((trackId) => {
        if (!viewTracks.length) return;
        player.playFromList(viewTracks, trackId, artist || 'Артист');
    }, [player, viewTracks, artist]);

    const onBack = useCallback(() => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
            navigate(-1);
            return;
        }
        void resolveArtistPath(apiClient, params.artist)
            .then((path) => {
                if (path) {
                    navigate(path);
                }
            })
            .catch(() => { });
    }, [navigate, artist, params.artist]);

    return (
        <Page>
            {loading ? (
                <Center>Загрузка...</Center>
            ) : error ? (
                <Center>{error}</Center>
            ) : (
                <ArtistTracksSection
                    tracks={viewTracks}
                    artistName={artist}
                    sort={sort}
                    year={year}
                    years={years}
                    onSortChange={setSort}
                    onYearChange={setYear}
                    onPlayTrack={onPlayTrack}
                    showAll
                    onToggleShowAll={onBack}
                />
            )}
        </Page>
    );
}
