import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { FaChartBar } from 'react-icons/fa';

import Shell from '../layout/Shell';
import ArtistTopBar from '../components/ArtistTopBar';
import {
    DashboardHero,
    DashboardStats,
    DashboardFeature,
    DashboardRecentTracks,
} from '../components/dashboard';
import { useAuth } from '../../state/auth/AuthContext';
import { artistPortalUsecase } from '../../usecases/artistPortalUsecase';

function normalizeTrack(t) {
    if (!t || typeof t !== 'object') return null;
    return {
        id: t.id !== undefined && t.id !== null ? String(t.id) : '',
        title: t.title ? String(t.title) : '',
        artist: t.artist ? String(t.artist) : '',
        album: t.album ? String(t.album) : '',
        cover_path: t.cover_path ? String(t.cover_path) : (t.coverPath ? String(t.coverPath) : ''),
        plays: t.plays ?? t.play_count ?? t.playCount,
        play_count: t.play_count ?? t.playCount ?? t.plays,
        is_available: t.is_available === true,
        created_at: t.created_at ? String(t.created_at) : (t.createdAt ? String(t.createdAt) : ''),
    };
}

function normalizeTracksResponse(data) {
    let items = [];
    if (Array.isArray(data)) items = data;
    else if (data && Array.isArray(data.items)) items = data.items;
    return items.map(normalizeTrack).filter(Boolean);
}

export default function DashboardPage() {
    const { portal, logout } = useAuth();
    const nav = useNavigate();

    const [dashboardMeta, setDashboardMeta] = useState(null);
    const [artistCard, setArtistCard] = useState(null);
    const [tracks, setTracks] = useState([]);
    const [loadingTracks, setLoadingTracks] = useState(true);
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        let cancelled = false;

        const loadAll = async () => {
            setLoadError('');
            setLoadingTracks(true);

            const [dashRes, tracksRes, cardRes] = await Promise.all([
                artistPortalUsecase.loadDashboard(),
                artistPortalUsecase.listTracks(),
                artistPortalUsecase.loadArtistCard(),
            ]);

            if (cancelled) return;

            if (dashRes.ok && dashRes.data && typeof dashRes.data === 'object') {
                const meta = dashRes.data.meta && typeof dashRes.data.meta === 'object' ? dashRes.data.meta : null;
                setDashboardMeta(meta);
            } else if (!dashRes.ok && dashRes.error?.type === 'forbidden') {
                nav('/onboarding', { replace: true });
                return;
            } else if (!dashRes.ok && dashRes.error?.type === 'mfa_required') {
                nav('/security/2fa', { replace: true });
                return;
            }

            if (cardRes.ok && cardRes.data && typeof cardRes.data === 'object') {
                setArtistCard(cardRes.data);
            }

            if (tracksRes.ok) {
                setTracks(normalizeTracksResponse(tracksRes.data));
            } else if (tracksRes.error?.type !== 'forbidden' && tracksRes.error?.type !== 'unauthorized') {
                setLoadError('Не удалось загрузить каталог');
            }

            setLoadingTracks(false);
        };

        void loadAll();

        return () => {
            cancelled = true;
        };
    }, [nav]);

    const derivedMeta = useMemo(() => {
        const base = dashboardMeta && typeof dashboardMeta === 'object' ? { ...dashboardMeta } : {};
        const loadedCount = Array.isArray(tracks) ? tracks.length : 0;
        const metaCountRaw = Number(base.trackCount);
        const metaCount = Number.isFinite(metaCountRaw) && metaCountRaw >= 0 ? metaCountRaw : null;
        base.trackCount = metaCount === null ? loadedCount : Math.max(metaCount, loadedCount);

        if (artistCard && typeof artistCard === 'object') {
            if (!base.avatarCoverPath && artistCard.avatarCoverPath) base.avatarCoverPath = artistCard.avatarCoverPath;
            if (!base.bannerCoverPath && artistCard.bannerCoverPath) base.bannerCoverPath = artistCard.bannerCoverPath;
            if (!base.heroCoverPath && artistCard.heroCoverPath) base.heroCoverPath = artistCard.heroCoverPath;
        }
        return base;
    }, [dashboardMeta, artistCard, tracks]);

    const onUploadClick = useCallback(() => {
        nav('/tracks');
    }, [nav]);

    const onSeeAll = useCallback(() => {
        nav('/tracks');
    }, [nav]);

    return (
        <Shell>
            <ArtistTopBar portal={portal} onLogout={logout} />

            <Main>
                <Wrap>
                    <DashboardHero portal={portal} meta={derivedMeta} />

                    <DashboardStats meta={derivedMeta} />

                    <AnalyticsCta type="button" onClick={() => nav('/analytics')}>
                        <FaChartBar size={13} aria-hidden="true" />
                        <span>Подробная аналитика</span>
                    </AnalyticsCta>

                    <DashboardFeature
                        tracks={tracks}
                        meta={derivedMeta}
                        onUploadClick={onUploadClick}
                    />

                    <DashboardRecentTracks
                        tracks={tracks}
                        loading={loadingTracks}
                        onSeeAll={onSeeAll}
                    />

                    {loadError ? <ErrorStrip>{loadError}</ErrorStrip> : null}
                </Wrap>
            </Main>
        </Shell>
    );
}

const Main = styled.div`
  padding: 22px 18px 80px;

  @media (max-width: 720px) {
    padding: 16px 14px 80px;
  }
`;

const Wrap = styled.div`
  width: min(1080px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ErrorStrip = styled.div`
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.10);
  border: 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
`;

const AnalyticsCta = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-end;
  padding: 8px 14px;
  border-radius: 999px;
  border: 0;
  background: #fff;
  color: #000;
  font-family: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.15s ease;
  letter-spacing: 0.02em;

  &:hover {
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }
`;
