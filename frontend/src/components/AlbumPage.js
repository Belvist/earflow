import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate, useParams } from 'react-router-dom';
import { FaPlay, FaPlus, FaCheck, FaChevronLeft, FaShareAlt } from 'react-icons/fa';
import apiClient from '../api/client';
import { usePlayer } from '../context/PlayerContext';
import useAuth from '../hooks/useAuth';
import { redirectToAuth, buildReturnToFromCurrentLocation } from '../utils/authRedirect';
import { slugifyForRoute } from '../utils/routeSlug';
import CachedCoverImage, { CachedCoverImageBase } from './CachedCoverImage';
import BrandLink from './BrandLink';
import ArtistLinks from './ArtistLinks';
import asyncMapLimit from '../utils/asyncMapLimit';
import { resolveArtistPath } from '../utils/artistRoute';
import { getCanonicalOrigin, setPageMeta } from '../utils/seo';
import {
  trackRowStyles,
  TrackRowNumber,
  TrackRowIndicator,
  TrackRowPlayingBars,
  TrackRowCover,
  TrackRowInfo,
  TrackRowTitle,
  TrackRowSubtitle,
  TrackRowDuration,
  formatTrackDuration,
} from './tracks/trackRowStyles';
import { heroOverlayBackground } from './tracks/heroStyles';
import TrackRowMenu from './tracks/TrackRowMenu';

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

const Hero = styled.div`
  position: relative;
  width: 100%;
  overflow: hidden;
  background: var(--ef-surface-main, #0d0d0d);
`;

const HeroLayer = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: -60px;
  bottom: -60px;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
  contain: paint;
  clip-path: inset(0);
`;

const heroDrift = keyframes`
  0% { transform: translate3d(-4%, 6%, 0) scale(1.24); }
  50% { transform: translate3d(4%, 9.5%, 0) scale(1.30); }
  100% { transform: translate3d(-3%, 12.5%, 0) scale(1.32); }
`;

const HeroImage = styled(CachedCoverImageBase)`
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 35%;
  filter: blur(38px) saturate(0.95);
  transform: translate3d(0, 9%, 0) scale(1.26);
  opacity: 0.5;
  box-shadow: 0 50px 100px rgba(0, 0, 0, 0.75);
  backface-visibility: hidden;
  will-change: transform, filter;
  animation: ${heroDrift} 18s ease-in-out infinite alternate;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const HeroOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  ${heroOverlayBackground}
`;

const Content = styled.div`
  position: relative;
  z-index: 1;
  max-width: 980px;
  margin: 0 auto;
  padding: 0 20px;
`;

const HeroContent = styled(Content)`
  padding-top: calc(56px + env(safe-area-inset-top, 0px) + 40px);
  padding-bottom: 26px;
`;

const TopBarOuter = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1200;
  height: calc(56px + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.74);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.03),
    0 10px 30px rgba(0, 0, 0, 0.45);
`;

const TopBarInner = styled.div`
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 0 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
`;

const TopBarLeft = styled.div`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 12px;
`;

const TopBarRight = styled.div`
  justify-self: end;
  display: flex;
  align-items: center;
`;

const BackButton = styled.button`
  width: 42px;
  height: 42px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.13);
    border-color: rgba(255, 255, 255, 0.26);
  }

  &:active {
    transform: scale(0.97);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.62);
    outline-offset: 2px;
  }
`;

const TopTitle = styled.div`
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.9);

  @media (max-width: 520px) {
    display: none;
  }
`;

const AlbumHeader = styled.div`
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 32px;
  margin-bottom: 40px;
  
  @media (max-width: 640px) {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
    gap: 16px;
    margin-bottom: 24px;
  }
`;

const CoverWrapper = styled.div`
  width: 100%;
  max-width: 240px;
  aspect-ratio: 4 / 5;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0,0,0,0.6);
  border: 1px solid rgba(255,255,255,0.1);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  @media (max-width: 640px) {
    max-width: 170px;
    border-radius: 14px;
  }
`;

const AlbumInfo = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
`;

const AlbumType = styled.div`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: rgba(255,255,255,0.5);
  margin-bottom: 6px;

  @media (min-width: 641px) {
    font-size: 12px;
    margin-bottom: 8px;
  }
`;

const AlbumTitle = styled.h1`
  font-size: 28px;
  font-weight: 900;
  margin-bottom: 12px;
  line-height: 1.1;
  
  @media (max-width: 768px) {
    font-size: 22px;
    margin-bottom: 8px;
  }
`;

const ArtistLink = styled.div`
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;

  @media (min-width: 641px) {
    font-size: 14px;
  }
  
  &:hover {
    text-decoration: underline;
  }
`;

const AlbumMeta = styled.div`
  margin-top: 10px;
  font-size: 12px;
  color: rgba(255,255,255,0.6);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;

  @media (min-width: 641px) {
    margin-top: 16px;
    font-size: 14px;
    gap: 12px;
    justify-content: flex-start;
  }
`;

const ActionBar = styled.div`
  margin-top: 12px;
  padding: 12px 0;
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const PlayButton = styled.button`
  height: 44px;
  padding: 0 24px;
  background: #fff;
  color: #000;
  border: none;
  border-radius: 999px;
  font-family: inherit;
  font-weight: 800;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s ease;

  @media (min-width: 641px) {
    height: 48px;
    padding: 0 32px;
    font-size: 15px;
    gap: 10px;
  }

  &:hover { background: rgba(255,255,255,0.92); }
  &:active { background: rgba(255,255,255,0.85); }
`;

const SecondaryButton = styled.button`
  height: 44px;
  width: 44px;
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.1);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;

  @media (min-width: 641px) {
    height: 48px;
    width: 48px;
  }
  
  &:hover {
    background: rgba(255,255,255,0.2);
    border-color: rgba(255,255,255,0.3);
  }
`;

const TrackList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
  background: transparent;
  margin: 0;
  padding: 0;
`;

const ListSection = styled(Content)`
  z-index: 2;
  padding-top: 20px;
  background: transparent;
`;

const TrackRow = styled.button`
  ${trackRowStyles}
`;

export default function AlbumPage() {
  const { artist: artistParam, albumName: albumNameParam, albumPublicId } = useParams();
  const navigate = useNavigate();
  const player = usePlayer();
  const { isAuthenticated } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [albumMeta, setAlbumMeta] = useState(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [stats, setStats] = useState({ plays: 0 });

  const artist = useMemo(() => (artistParam ? artistParam.normalize('NFC').trim() : ''), [artistParam]);
  const albumName = useMemo(() => (albumNameParam ? albumNameParam.normalize('NFC').trim() : ''), [albumNameParam]);
  const canonicalAlbumPublicId = useMemo(() => {
    const raw = (albumPublicId || '').toString().trim();
    const m = raw.match(/^([a-f0-9]{32})(?:-.*)?$/i);
    return m ? m[1].toLowerCase() : '';
  }, [albumPublicId]);

  const displayAlbumName = useMemo(() => {
    const fromParam = (albumName || '').toString().trim();
    if (fromParam && !/^[a-f0-9]{32}$/i.test(fromParam)) return fromParam;
    const fromMeta = albumMeta && typeof albumMeta === 'object' ? (albumMeta.title ?? albumMeta.album ?? albumMeta.name ?? '') : '';
    const metaTitle = (fromMeta || '').toString().trim();
    if (metaTitle) return metaTitle;
    const t0 = tracks && tracks.length ? tracks[0] : null;
    const fromTrack = t0 && (t0.album ?? t0.release);
    return (fromTrack || '').toString().trim();
  }, [albumName, albumMeta, tracks]);

  const displayArtistName = useMemo(() => {
    const fromParam = (artist || '').toString().trim();
    if (fromParam && !/^[a-f0-9]{32}$/i.test(fromParam)) return fromParam;
    const fromMeta = albumMeta && typeof albumMeta === 'object' ? (albumMeta.artist ?? albumMeta.artistName ?? '') : '';
    const metaArtist = (fromMeta || '').toString().trim();
    if (metaArtist) return metaArtist;
    const t0 = tracks && tracks.length ? tracks[0] : null;
    const fromTrack = t0 && t0.artist;
    return (fromTrack || '').toString().trim();
  }, [artist, albumMeta, tracks]);

  useEffect(() => {
    const pid = canonicalAlbumPublicId || (albumMeta && (albumMeta.albumPublicId || albumMeta.album_public_id) ? String(albumMeta.albumPublicId || albumMeta.album_public_id).trim().toLowerCase() : '');
    if (!pid) return;

    const origin = getCanonicalOrigin();
    const slug = slugifyForRoute(displayAlbumName);
    const canonicalPath = `/album/${encodeURIComponent(pid)}${slug ? `-${encodeURIComponent(slug)}` : ''}`;
    const canonicalUrl = `${origin}${canonicalPath}`;

    const artistName = (displayArtistName || '').trim();
    const albumName = (displayAlbumName || '').trim() || 'Альбом';
    const titleLeft = artistName ? `${artistName} — ${albumName}` : albumName;
    const description = artistName ? `Альбом ${albumName} — ${artistName}` : `Альбом: ${albumName}`;

    setPageMeta({
      title: `${titleLeft} — Earflow`,
      description,
      canonicalUrl,
    });
  }, [canonicalAlbumPublicId, albumMeta, displayAlbumName, displayArtistName]);

  useEffect(() => {
    const fetchAlbum = async () => {
      setLoading(true);
      try {
        if (canonicalAlbumPublicId) {
          const meta = await apiClient.getAlbumByPublicId(canonicalAlbumPublicId);
          const list = await apiClient.getAlbumTracksByPublicId(canonicalAlbumPublicId, { limit: 500 });
          const albumTracks = Array.isArray(list) ? list : [];

          setAlbumMeta(meta && typeof meta === 'object' ? meta : null);

          if (!meta || albumTracks.length === 0) {
            setError('Альбом не найден');
          } else {
            setTracks(albumTracks);
            const totalPlays = albumTracks.reduce((acc, t) => acc + (Number(t.play_count || t.playCount) || 0), 0);
            setStats({ plays: totalPlays });
          }
          return;
        }

        if (!artist || !albumName) {
          setError('Альбом не найден');
          return;
        }

        if (isAuthenticated) {
          const resolved = await apiClient.resolveAlbumPublicId(artist, albumName);
          const pid = resolved && (resolved.albumPublicId || resolved.album_public_id) ? String(resolved.albumPublicId || resolved.album_public_id) : '';
          if (pid) {
            const slug = slugifyForRoute(albumName);
            navigate(`/album/${encodeURIComponent(pid)}${slug ? `-${encodeURIComponent(slug)}` : ''}`, { replace: true });
            return;
          }
        }

        const r = await apiClient.getArtistTracks(artist, { limit: 500 });
        const allTracks = Array.isArray(r) ? r : (r && Array.isArray(r.tracks) ? r.tracks : []);

        const albumTracks = allTracks.filter(t => {
          const tAlbum = (t.album || t.release || '').trim().toLowerCase();
          return tAlbum === albumName.toLowerCase();
        });

        if (albumTracks.length === 0) {
          setError('Альбом не найден');
        } else {
          setTracks(albumTracks);
          setAlbumMeta(null);
          const totalPlays = albumTracks.reduce((acc, t) => acc + (Number(t.play_count || t.playCount) || 0), 0);
          setStats({ plays: totalPlays });
        }
      } catch (e) {
        setError('Ошибка загрузки данных');
      } finally {
        setLoading(false);
      }
    };
    fetchAlbum();
  }, [artist, albumName, canonicalAlbumPublicId, isAuthenticated, navigate]);

  const handleShareAlbum = useCallback(async () => {
    const url = `${getCanonicalOrigin()}/album/${encodeURIComponent(canonicalAlbumPublicId || '')}`;
    const title = displayAlbumName || 'Альбом';
    if (navigator.share) {
      try {
        await navigator.share({ title, text: title, url });
      } catch {
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Скопируйте ссылку:', url);
    }
  }, [canonicalAlbumPublicId, displayAlbumName]);

  const handlePlayAll = useCallback(() => {
    if (tracks.length === 0) return;
    player.playFromList(tracks, tracks[0].id, displayAlbumName || 'Альбом');
  }, [player, tracks, displayAlbumName]);

  const handleSaveAlbum = useCallback(async () => {
    if (!isAuthenticated) {
      redirectToAuth({ reason: 'save_album', returnTo: buildReturnToFromCurrentLocation(), replace: true });
      return;
    }
    if (isSaved || isSaving) return;
    if (!tracks.length) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const playlist = await apiClient.createPlaylist({
        name: displayAlbumName || 'Альбом',
        description: displayArtistName ? `Альбом артиста ${displayArtistName}` : 'Альбом',
        is_public: false,
      });
      const playlistId = playlist && playlist.id ? playlist.id : null;
      if (!playlistId) {
        setSaveError('Не удалось сохранить альбом');
        return;
      }

      const ids = tracks.map((t) => t && t.id).filter(Boolean);
      await asyncMapLimit(ids, 4, async (songId) => {
        await apiClient.addTrackToPlaylist(playlistId, songId);
      });

      setIsSaved(true);
    } catch (e) {
      setSaveError('Не удалось сохранить альбом');
    } finally {
      setIsSaving(false);
    }
  }, [displayAlbumName, displayArtistName, isAuthenticated, isSaved, isSaving, tracks]);

  if (loading) {
    return (
      <Page>
        <TopBarOuter>
          <TopBarInner>
            <TopBarLeft>
              <BackButton onClick={() => navigate(-1)} aria-label="Назад">
                <FaChevronLeft />
              </BackButton>
              <TopTitle>Альбом</TopTitle>
            </TopBarLeft>
            <TopBarRight>
              <BrandLink size="sm" />
            </TopBarRight>
          </TopBarInner>
        </TopBarOuter>
        <Content style={{ paddingTop: 'calc(56px + env(safe-area-inset-top, 0px) + 24px)' }}>Загрузка...</Content>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <TopBarOuter>
          <TopBarInner>
            <TopBarLeft>
              <BackButton onClick={() => navigate(-1)} aria-label="Назад">
                <FaChevronLeft />
              </BackButton>
              <TopTitle>Альбом</TopTitle>
            </TopBarLeft>
            <TopBarRight>
              <BrandLink size="sm" />
            </TopBarRight>
          </TopBarInner>
        </TopBarOuter>
        <Content style={{ paddingTop: 'calc(56px + env(safe-area-inset-top, 0px) + 24px)' }}>{error}</Content>
      </Page>
    );
  }

  const firstTrack = tracks[0];
  const coverUrl = firstTrack ? apiClient.getCoverUrl(firstTrack) : null;
  const heroSrc = coverUrl ? String(coverUrl) : null;

  return (
    <Page>
      <TopBarOuter>
        <TopBarInner>
          <TopBarLeft>
            <BackButton onClick={() => navigate(-1)} aria-label="Назад">
              <FaChevronLeft />
            </BackButton>
            <TopTitle>Альбом</TopTitle>
          </TopBarLeft>
          <TopBarRight>
            <BrandLink size="sm" />
          </TopBarRight>
        </TopBarInner>
      </TopBarOuter>

      <Hero>
        <HeroLayer>
          <HeroImage src={heroSrc} alt="" />
          <HeroOverlay />
        </HeroLayer>

        <HeroContent>
          <AlbumHeader>
            <CoverWrapper>
              <CachedCoverImage src={coverUrl} alt={displayAlbumName} />
            </CoverWrapper>
            <AlbumInfo>
              <AlbumType>Альбом</AlbumType>
              <AlbumTitle>{displayAlbumName}</AlbumTitle>
              <ArtistLink>
                <ArtistLinks
                  value={displayArtistName}
                  onNavigate={(name) => {
                    void resolveArtistPath(apiClient, name)
                      .then((path) => {
                        if (path) navigate(path);
                      })
                      .catch(() => { });
                  }}
                />
              </ArtistLink>
              <AlbumMeta>
                {firstTrack?.year && <span>{firstTrack.year}</span>}
                <span>{tracks.length} треков</span>
                {stats.plays > 0 && <span>{stats.plays.toLocaleString()} прослушиваний</span>}
              </AlbumMeta>
              {saveError && (
                <div style={{ marginTop: 10, color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
                  {saveError}
                </div>
              )}
            </AlbumInfo>
          </AlbumHeader>

          <ActionBar>
            <Actions>
              <PlayButton onClick={handlePlayAll}>
                <FaPlay size={14} /> Играть
              </PlayButton>
              <SecondaryButton onClick={handleSaveAlbum} title="Добавить в медиатеку" disabled={isSaved || isSaving} aria-disabled={isSaved || isSaving}>
                {isSaved ? <FaCheck color="#32d74b" /> : <FaPlus />}
              </SecondaryButton>
              <SecondaryButton onClick={handleShareAlbum} title="Поделиться альбомом" aria-label="Поделиться альбомом">
                <FaShareAlt />
              </SecondaryButton>
            </Actions>
          </ActionBar>
        </HeroContent>
      </Hero>

      <ListSection>
          <TrackList>
            {tracks.map((track, i) => {
              const isActive = String(player.currentTrack?.id ?? '') === String(track?.id ?? '');
              const isPlaying = isActive && !!player.isPlaying;
              return (
                <TrackRow
                  key={track.id}
                  $active={isActive}
                  onClick={() => player.playFromList(tracks, track.id, displayAlbumName)}
                >
                  {isActive ? (
                    <TrackRowIndicator>
                      {isPlaying ? (
                        <TrackRowPlayingBars aria-label="Играет">
                          <span />
                          <span />
                          <span />
                        </TrackRowPlayingBars>
                      ) : (
                        <FaPlay size={10} aria-label="Выбрано" />
                      )}
                    </TrackRowIndicator>
                  ) : (
                    <TrackRowNumber>{i + 1}</TrackRowNumber>
                  )}
                  <TrackRowCover>
                    <CachedCoverImage src={apiClient.getCoverUrl(track)} alt="" />
                  </TrackRowCover>
                  <TrackRowInfo>
                    <TrackRowTitle title={track.title}>{track.title || 'Без названия'}</TrackRowTitle>
                    {(track.artist || track.album) && (
                      <TrackRowSubtitle>{[track.artist, track.album].filter(Boolean).join(' — ')}</TrackRowSubtitle>
                    )}
                  </TrackRowInfo>
                  <TrackRowDuration>{formatTrackDuration(track.duration)}</TrackRowDuration>
                  <TrackRowMenu track={track} />
                </TrackRow>
              );
            })}
          </TrackList>
      </ListSection>
    </Page>
  );
}
