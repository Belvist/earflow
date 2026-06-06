import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Reorder, useDragControls } from 'framer-motion';
import { FaChevronLeft, FaEdit, FaEllipsisH, FaLink, FaPlay, FaPlus, FaTrash, FaTimes, FaGripVertical } from 'react-icons/fa';
import apiClient from '../api/client';
import ArtistLinks from './ArtistLinks';
import { notifyPlaylistChanged } from '../utils/playlistLiveUpdate';
import { usePlayer } from '../context/PlayerContext';
import { buildPlaylistShareUrlFromSlug } from '../utils/playlistUrls';
import { loadVirtualPlaylist, saveVirtualPlaylist } from '../utils/virtualPlaylists';
import { resolveArtistPath } from '../utils/artistRoute';
import useAuth from '../hooks/useAuth';
import { CachedCoverImageBase } from './CachedCoverImage';
import BrandLink from './BrandLink';
import { useSearch } from '../search/useSearch';
import { GESTURE_SURFACE } from '../gestures/gestureContracts';
import { useGestureArbiter } from '../gestures/GestureArbiterProvider';

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
  z-index: 0;
`;

const HeroLayer = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: -60px;
  height: 520px;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
  contain: paint;
  clip-path: inset(0);

  &::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 260px;
    background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 100%);
  }
`;

const heroDrift = keyframes`
  0% { transform: translate3d(-4%, 6%, 0) scale(1.24); }
  50% { transform: translate3d(4%, 9.5%, 0) scale(1.30); }
  100% { transform: translate3d(-3%, 12.5%, 0) scale(1.32); }
`;

const HeroImage = styled(CachedCoverImageBase)`
  width: 100%;
  height: 520px;
  object-fit: cover;
  object-position: 50% 35%;
  filter: blur(38px) saturate(0.95);
  transform: translate3d(0, 9%, 0) scale(1.26);
  opacity: 0.34;
  box-shadow: 0 50px 100px rgba(0, 0, 0, 0.75);
  backface-visibility: hidden;
  will-change: transform, filter;
  animation: ${heroDrift} 22s ease-in-out infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const HeroOverlay = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 100%;
  background:
    radial-gradient(1300px 460px at 50% 12%, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.70) 68%, rgba(0,0,0,0.98) 100%),
    linear-gradient(180deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.34) 58%, rgba(0,0,0,0.78) 78%, rgba(0,0,0,1) 100%),
    linear-gradient(90deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 24%, rgba(0,0,0,0) 76%, rgba(0,0,0,0.42) 100%);
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

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.62);
    outline-offset: 2px;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.13);
    border-color: rgba(255, 255, 255, 0.26);
  }

  &:active {
    transform: scale(0.97);
  }
`;

const Content = styled.div`
  position: relative;
  z-index: 1;
  max-width: 980px;
  margin: 0 auto;
  padding: 0 12px;

  @media (min-width: 641px) {
    padding: 0 20px;
  }
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
  }
`;

const Cover = styled.div`
  width: 100%;
  max-width: 240px;
  aspect-ratio: 4 / 5;
  border-radius: 14px;
  overflow: hidden;

  @media (min-width: 641px) {
    border-radius: 18px;
  }
  background: rgba(255, 255, 255, 0.06);
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
  }
`;

const Info = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
`;

const Type = styled.div`
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: rgba(255,255,255,0.5);
  margin-bottom: 8px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 28px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1.1;

  @media (max-width: 768px) {
    font-size: 22px;
  }
`;

const Description = styled.div`
  margin-top: 8px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.5;
  white-space: pre-wrap;

  @media (min-width: 641px) {
    margin-top: 10px;
    font-size: 12.5px;
  }
`;

const Meta = styled.div`
  margin-top: 10px;
  font-size: 12px;
  color: rgba(255,255,255,0.6);
  display: flex;
  align-items: center;

  @media (min-width: 641px) {
    margin-top: 16px;
    font-size: 14px;
  }
  gap: 12px;
  flex-wrap: wrap;
`;

const ActionBar = styled.div`
  margin-top: 12px;
  padding: 12px 0;
  position: relative;
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  flex-wrap: wrap;

  @media (max-width: 640px) {
    justify-content: center;
  }
`;

const PlayButton = styled.button`
  height: 44px;
  padding: 0 22px;
  background: #fff;
  color: #000;
  border: none;
  border-radius: 999px;
  font-family: inherit;
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;

  @media (min-width: 641px) {
    height: 48px;
    padding: 0 32px;
    font-size: 15px;
  }
  gap: 10px;
  transition: background 0.15s ease;

  &:hover { background: rgba(255,255,255,0.92); }
  &:active { background: rgba(255,255,255,0.85); }
`;

const SecondaryButton = styled.button`
  height: 44px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.12);

  @media (min-width: 641px) {
    height: 48px;
    padding: 0 18px;
  }
  color: #fff;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255,255,255,0.18);
    border-color: rgba(255,255,255,0.22);
  }
`;

const DangerButton = styled(SecondaryButton)`
  border-color: rgba(255, 100, 100, 0.35);
  color: rgba(255, 180, 180, 0.95);
`;

const SmallButton = styled.button`
  height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  cursor: pointer;
  font-family: 'Unbounded', sans-serif;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 10px;
`;

const SmallPrimaryButton = styled(SmallButton)`
  border: none;
  background: #fff;
  color: #000;
`;

const SectionTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.85);
  text-transform: uppercase;
  margin: 0 0 8px;
`;

const ActionsOverflow = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
`;

const MoreButton = styled(SecondaryButton)`
  width: 44px;
  padding: 0;
  justify-content: center;

  @media (min-width: 641px) {
    width: 48px;
    padding: 0;
  }
`;

const ActionsMenu = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 190px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(18, 18, 18, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  z-index: 10;

  ${SecondaryButton},
  ${DangerButton} {
    width: 100%;
    justify-content: flex-start;
    height: 40px;
    padding: 0 12px;
  }

  @media (max-width: 640px) {
    right: auto;
    left: 50%;
    transform: translateX(-50%);
  }
`;

const TrackList = styled(Reorder.Group)`
  display: flex;
  flex-direction: column;
  gap: 0;
  background: transparent;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const ListSection = styled(Content)`
  z-index: 2;
  padding-top: 10px;
  background: var(--ef-surface-main, #0d0d0d);

  &::before {
    content: '';
    position: absolute;
    left: 50%;
    top: -92px;
    width: 100vw;
    height: 120px;
    transform: translateX(-50%);
    background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.82) 58%, rgba(0,0,0,1) 100%);
    pointer-events: none;
    z-index: -1;
  }
`;

const TrackRow = styled(Reorder.Item)`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 8px 10px;
  font-family: inherit;
  border-radius: 0;
  cursor: pointer;

  @media (min-width: 641px) {
    gap: 12px;
    padding: 12px;
  }
  transition: background 0.2s;
  width: 100%;
  border: none;
  text-align: left;
  background: ${p => (p.$active ? 'rgba(255,255,255,0.12)' : 'transparent')};
  color: #fff;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  list-style: none;

  &:hover {
    background: rgba(255,255,255,0.05);
  }

  &:active {
    background: rgba(255,255,255,0.10);
  }
`;

const Indicator = styled.div`
  width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.85);
`;

const TrackNum = styled.div`
  width: 20px;
  text-align: right;
  font-size: 12px;
  color: rgba(255,255,255,0.4);

  @media (min-width: 641px) {
    width: 24px;
    font-size: 14px;
  }
`;

const PlayingBars = styled.div`
  width: 18px;
  height: 14px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;

  span {
    width: 3px;
    height: 100%;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.92);
    transform-origin: bottom;
    animation: playlistBars 0.85s ease-in-out infinite;
  }

  span:nth-child(2) { animation-delay: 0.12s; }
  span:nth-child(3) { animation-delay: 0.24s; }

  @keyframes playlistBars {
    0% { transform: scaleY(0.35); opacity: 0.55; }
    50% { transform: scaleY(1); opacity: 1; }
    100% { transform: scaleY(0.35); opacity: 0.55; }
  }
`;

const DragHandle = styled.div`
  width: 28px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.35);
  cursor: grab;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
`;

const TrackCover = styled.div`
  width: 38px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);

  @media (min-width: 641px) {
    width: 44px;
    height: 56px;
    border-radius: 10px;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

const TrackInfo = styled.div`
  min-width: 0;
  flex: 1;
`;

const TrackTitle = styled.div`
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;

  @media (min-width: 641px) {
    font-size: 14px;
  }
  text-overflow: ellipsis;
`;

const TrackArtist = styled.div`
  margin-top: 2px;
  font-size: 10px;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.5);

  @media (min-width: 641px) {
    font-size: 11px;
  }
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TrackArtistLink = styled(TrackArtist)`
  cursor: pointer;
`;

const TrackActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
`;

const IconButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const PlaylistTrackRow = ({
    track,
    index,
    isOwner,
    dragEnabled,
    isActive,
    isPlaying,
    onPlayFrom,
    onRemoveTrack,
}) => {
    const navigate = useNavigate();
    const controls = useDragControls();
    const arbiter = useGestureArbiter();
    const reorderPointerIdRef = useRef(null);

    // Clean up reorder gesture claim on unmount to prevent leaked arbiter ownership
    useEffect(() => {
        return () => {
            const pid = reorderPointerIdRef.current;
            if (pid != null) {
                arbiter.release({
                    surfaceId: GESTURE_SURFACE.PLAYLIST_REORDER,
                    pointerId: pid,
                    reason: 'playlist-reorder-unmount',
                });
            }
        };
    }, [arbiter]);

    const releaseReorder = (e) => {
        const pid = reorderPointerIdRef.current;
        if (pid == null) return;
        reorderPointerIdRef.current = null;

        try {
            e?.currentTarget?.releasePointerCapture?.(pid);
        } catch {
        }

        arbiter.release({
            surfaceId: GESTURE_SURFACE.PLAYLIST_REORDER,
            pointerId: pid,
            reason: 'playlist-reorder-end',
        });
    };

    const onRowKeyDown = (e) => {
        const key = e?.key;
        if (key !== 'Enter' && key !== ' ') return;
        if (e?.preventDefault) e.preventDefault();
        onPlayFrom(index);
    };

    return (
        <TrackRow
            value={track}
            dragListener={false}
            dragControls={controls}
            drag={isOwner && dragEnabled ? "y" : false}
            dragMomentum={false}
            $active={isActive}
            role="button"
            tabIndex={0}
            onKeyDown={onRowKeyDown}
            onClick={() => onPlayFrom(index)}
        >
            {isOwner ? (
                <DragHandle
                    title="Перетащить"
                    onPointerDown={(e) => {
                        if (!dragEnabled) return;
                        e.stopPropagation();
                        if (!arbiter.tryClaim({
                            surfaceId: GESTURE_SURFACE.PLAYLIST_REORDER,
                            pointerId: e.pointerId,
                            reason: 'playlist-reorder',
                        })) {
                            return;
                        }
                        reorderPointerIdRef.current = e.pointerId;
                        try {
                            e.currentTarget?.setPointerCapture?.(e.pointerId);
                        } catch {
                        }
                        controls.start(e);
                    }}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    onPointerUp={releaseReorder}
                    onPointerCancel={releaseReorder}
                    onLostPointerCapture={releaseReorder}
                >
                    <FaGripVertical />
                </DragHandle>
            ) : null}

            {isActive ? (
                <Indicator>
                    {isPlaying ? (
                        <PlayingBars aria-label="Играет">
                            <span />
                            <span />
                            <span />
                        </PlayingBars>
                    ) : (
                        <FaPlay size={10} aria-label="Выбрано" />
                    )}
                </Indicator>
            ) : (
                <TrackNum>{index + 1}</TrackNum>
            )}
            <TrackCover>
                <img
                    src={apiClient.getCoverUrl(track)}
                    alt=""
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                    }}
                />
            </TrackCover>
            <TrackInfo>
                <TrackTitle title={track.title || ''}>{track.title || 'Без названия'}</TrackTitle>
                <TrackArtistLink
                    title={track.artist || ''}
                    role="link"
                    tabIndex={0}
                >
                    <ArtistLinks
                        value={track.artist}
                        onNavigate={(name) => {
                            void resolveArtistPath(apiClient, name)
                                .then((path) => {
                                    if (path) navigate(path);
                                })
                                .catch(() => { });
                        }}
                    />
                </TrackArtistLink>
            </TrackInfo>
            <TrackActions>
                {isOwner ? (
                    <IconButton
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemoveTrack(track.id);
                        }}
                        title="Удалить"
                    >
                        <FaTimes />
                    </IconButton>
                ) : null}
            </TrackActions>
        </TrackRow>
    );
};

const Panel = styled.div`
  margin-top: 14px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.04);
`;

const PanelTitle = styled.div`
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: rgba(255,255,255,0.85);
  text-transform: uppercase;
  margin-bottom: 10px;
`;

const Input = styled.input`
  width: 100%;
  height: 42px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  padding: 0 12px;
  outline: none;
  font-family: 'Unbounded', sans-serif;
`;

const TextArea = styled.textarea`
  width: 100%;
  min-height: 96px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  padding: 10px 12px;
  outline: none;
  font-family: 'Unbounded', sans-serif;
  resize: vertical;
`;

const SmallText = styled.div`
  margin-top: 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const ErrorText = styled.div`
  margin-top: 10px;
  font-size: 12px;
  color: rgba(255, 120, 120, 0.95);
`;

function parsePositiveInt(value) {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (!s || !/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function chunkArray(items, chunkSize) {
    const list = Array.isArray(items) ? items : [];
    const size = Number.isSafeInteger(chunkSize) && chunkSize > 0 ? chunkSize : 100;
    const chunks = [];
    for (let i = 0; i < list.length; i += size) {
        chunks.push(list.slice(i, i + size));
    }
    return chunks;
}

function isShareSlug(value) {
    const v = String(value || '').trim();
    return /^[A-Za-z0-9]{32}$/.test(v);
}

function isLikelyMixToken(value) {
    const v = String(value || '');
    return v.startsWith('v1.') && v.split('.').length === 3;
}

function extractLegacyDiscoverSeed(identifier) {
    const raw = identifier === undefined || identifier === null ? '' : String(identifier).trim();
    if (!raw || !raw.includes(':')) return null;
    const parts = raw.split('_').filter(Boolean);
    if (parts.length < 2) return null;
    const last = parts[parts.length - 1];
    const lastIsIndex = /^\d+$/.test(last);
    const candidate = lastIsIndex ? parts[parts.length - 2] : last;
    return candidate && candidate.includes(':') ? candidate : null;
}

function extractSeedBase(discoverSeed) {
    const s = discoverSeed === undefined || discoverSeed === null ? '' : String(discoverSeed).trim();
    if (!s) return null;
    const idx = s.lastIndexOf(':');
    if (idx <= 0) return null;
    const base = s.slice(0, idx);
    const scope = s.slice(idx + 1);
    if (scope === 'anon') return base;
    if (/^u:\d+$/.test(scope)) return base;
    return null;
}

function findDiscoverPlaylistByIdentifier(playlists, identifier) {
    const items = Array.isArray(playlists) ? playlists : [];
    const raw = identifier === undefined || identifier === null ? '' : String(identifier).trim();
    if (!raw) return null;
    const direct = items.find((p) => p && typeof p === 'object' && String(p.id || '') === raw);
    if (direct) return direct;

    if (!raw.includes(':')) return null;
    const parts = raw.split('_').filter(Boolean);
    if (parts.length < 2) return null;

    const last = parts[parts.length - 1];
    const lastIsIndex = /^\d+$/.test(last);
    if (lastIsIndex && parts.length >= 3) {
        const baseId = parts[0];
        const idx = last;
        const byChunk = items.find((p) => {
            const id = p && typeof p === 'object' ? String(p.id || '') : '';
            return id.startsWith(`${baseId}_`) && id.endsWith(`_${idx}`);
        });
        if (byChunk) return byChunk;
        const bySingle = items.find((p) => {
            const id = p && typeof p === 'object' ? String(p.id || '') : '';
            return id.startsWith(`${baseId}_`);
        });
        if (bySingle) return bySingle;
    }

    const underscore = raw.lastIndexOf('_');
    if (underscore > 0) {
        const prefix = raw.slice(0, underscore + 1);
        const byPrefix = items.find((p) => {
            const id = p && typeof p === 'object' ? String(p.id || '') : '';
            return id.startsWith(prefix);
        });
        if (byPrefix) return byPrefix;
    }

    return null;
}

export default function PlaylistPage({ playlistIdentifier }) {
    const navigate = useNavigate();
    const params = useParams();
    const location = useLocation();
    const { isAuthenticated } = useAuth();
    const player = usePlayer();

    const identifier = useMemo(() => {
        return playlistIdentifier || params.idOrToken || params.id || '';
    }, [playlistIdentifier, params.idOrToken, params.id]);

    const seedFromQuery = useMemo(() => {
        try {
            const sp = new URLSearchParams(location.search || '');
            const seed = sp.get('seed');
            return seed ? String(seed) : '';
        } catch {
            return '';
        }
    }, [location.search]);

    const resolvedPlaylistId = useMemo(() => parsePositiveInt(identifier), [identifier]);
    const resolvedShareSlug = useMemo(() => (isShareSlug(identifier) ? String(identifier).trim() : null), [identifier]);
    const resolvedMixToken = useMemo(() => (isLikelyMixToken(identifier) ? String(identifier).trim() : null), [identifier]);
    const virtualPlaylist = useMemo(() => {
        if (resolvedPlaylistId || resolvedShareSlug || resolvedMixToken) return null;
        return loadVirtualPlaylist(identifier);
    }, [identifier, resolvedPlaylistId, resolvedShareSlug, resolvedMixToken]);
    const isPublicView = !!resolvedShareSlug && !resolvedPlaylistId;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [playlist, setPlaylist] = useState(null);
    const [tracks, setTracks] = useState([]);
    const [isOwner, setIsOwner] = useState(false);
    const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
    const actionsMenuRef = useRef(null);

    const playlistIdFromData = useMemo(() => {
        const id = playlist && typeof playlist === 'object' ? playlist.id : null;
        return parsePositiveInt(id);
    }, [playlist]);

    const effectivePlaylistId = useMemo(() => {
        if (resolvedPlaylistId) return resolvedPlaylistId;
        if (isOwner && playlistIdFromData) return playlistIdFromData;
        return null;
    }, [resolvedPlaylistId, isOwner, playlistIdFromData]);

    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editError, setEditError] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);

    const [addOpen, setAddOpen] = useState(false);
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [libraryError, setLibraryError] = useState(null);
    const [librarySongs, setLibrarySongs] = useState([]);
    const [search, setSearch] = useState('');
    const [addingSongId, setAddingSongId] = useState(null);

    const lastOrderRef = useRef([]);
    const reorderDebounceTimerRef = useRef(null);
    const reorderInFlightRef = useRef(false);
    const [reorderLocked, setReorderLocked] = useState(false);
    const reorderNeedsFlushRef = useRef(false);
    const reorderPendingRef = useRef(null);
    const reorderDragStartTracksRef = useRef(null);
    const canEditRef = useRef(false);

    const headerMeta = useMemo(() => {
        const count = Array.isArray(tracks) ? tracks.length : 0;
        return `${count} ${count === 1 ? 'трек' : 'треков'}`;
    }, [tracks]);

    const coverUrl = useMemo(() => {
        if (playlist?.cover_path) {
            return apiClient.getCoverUrl({ cover_path: playlist.cover_path });
        }
        const first = Array.isArray(tracks) ? tracks[0] : null;
        return first ? apiClient.getCoverUrl(first) : null;
    }, [playlist, tracks]);

    const loadPlaylist = useCallback(async () => {
        if (!resolvedPlaylistId && !resolvedShareSlug && !resolvedMixToken) {
            if (virtualPlaylist) {
                setPlaylist({
                    ...(virtualPlaylist && typeof virtualPlaylist === 'object' ? virtualPlaylist : {}),
                    name: virtualPlaylist.title || 'Плейлист',
                    description: virtualPlaylist.description || '',
                    isOwner: false,
                });
                setTracks(Array.isArray(virtualPlaylist.tracks) ? virtualPlaylist.tracks : []);
                setIsOwner(false);
                setEditName(String(virtualPlaylist.title || ''));
                setEditDescription(String(virtualPlaylist.description || ''));
                setLoading(false);
                setError(null);
                return;
            }

            try {
                let resolved = null;
                try {
                    resolved = await apiClient.resolvePlaylistIdentifier(identifier, { skipAuth: true });
                } catch {
                    resolved = null;
                }

                const redirectTo = resolved && typeof resolved.redirectTo === 'string' ? resolved.redirectTo : '';
                const seedBaseFromResolve = resolved && typeof resolved.seedBase === 'string' ? resolved.seedBase : '';
                const nextSeed = seedFromQuery || seedBaseFromResolve || (extractSeedBase(extractLegacyDiscoverSeed(identifier)) || '');

                if (redirectTo && redirectTo !== identifier) {
                    const qs = nextSeed ? `?seed=${encodeURIComponent(nextSeed)}` : '';
                    navigate(`/playlist/${encodeURIComponent(redirectTo)}${qs}`, { replace: true });
                    return;
                }

                const discover = await apiClient.getDiscoverRails({ seed: nextSeed });
                const rails = Array.isArray(discover?.rails) ? discover.rails : [];
                const all = rails
                    .flatMap((r) => (r && Array.isArray(r.playlists) ? r.playlists : []))
                    .filter(Boolean);

                const effectiveIdentifier = redirectTo || identifier;
                const found = findDiscoverPlaylistByIdentifier(all, effectiveIdentifier);
                if (!found) {
                    setError('Плейлист не найден');
                    setLoading(false);
                    return;
                }

                const title = found?.title ?? found?.name ?? 'Плейлист';
                const description = found?.description ?? '';
                const tracksFromDiscover = Array.isArray(found?.tracks) ? found.tracks : [];

                setPlaylist({
                    ...(found && typeof found === 'object' ? found : {}),
                    name: String(title || 'Плейлист'),
                    description: typeof description === 'string' ? description : String(description || ''),
                    isOwner: false,
                    share_slug: null,
                });
                setTracks(tracksFromDiscover);
                setIsOwner(false);
                setEditName(String(title || ''));
                setEditDescription(typeof description === 'string' ? description : String(description || ''));

                try {
                    saveVirtualPlaylist({
                        id: String(found?.id || identifier),
                        title: String(title || 'Плейлист'),
                        description: typeof description === 'string' ? description : String(description || ''),
                        tracks: tracksFromDiscover,
                        type: typeof found?.type === 'string' ? found.type : null,
                    });
                } catch {
                }

                const canonicalId = found?.id ? String(found.id) : '';
                if (canonicalId && canonicalId !== effectiveIdentifier) {
                    const qs = nextSeed ? `?seed=${encodeURIComponent(nextSeed)}` : '';
                    navigate(`/playlist/${encodeURIComponent(canonicalId)}${qs}`, { replace: true });
                }

                setLoading(false);
                setError(null);
                return;
            } catch (e) {
                setError(e?.message || 'Некорректная ссылка');
                setLoading(false);
                return;
            }
        }

        setLoading(true);
        setError(null);

        try {
            let data;
            if (resolvedMixToken) {
                data = await apiClient.getMixByToken(resolvedMixToken);
                const nextTracks = Array.isArray(data?.tracks) ? data.tracks : [];
                setPlaylist({
                    ...(data && typeof data === 'object' ? data : {}),
                    name: data?.name || data?.title || 'Микс',
                    description: data?.description || '',
                    isOwner: false,
                    share_slug: null,
                });
                setTracks(nextTracks);
                setIsOwner(false);
                setEditName(String(data?.name || data?.title || ''));
                setEditDescription(String(data?.description || ''));
            } else {
                data = resolvedShareSlug
                    ? await apiClient.getPublicPlaylistBySlug(resolvedShareSlug)
                    : await apiClient.getPlaylist(resolvedPlaylistId);
                const nextTracks = Array.isArray(data?.tracks) ? data.tracks : [];
                setPlaylist(data);
                setTracks(nextTracks);
                setIsOwner(!!data?.isOwner);
                setEditName(String(data?.name || ''));
                setEditDescription(String(data?.description || ''));
            }
        } catch (e) {
            setError(e?.message || 'Не удалось загрузить плейлист');
        } finally {
            setLoading(false);
        }
    }, [resolvedPlaylistId, resolvedShareSlug, resolvedMixToken]);

    const canEdit = Boolean(isAuthenticated) && isOwner && !!effectivePlaylistId;

    useEffect(() => {
        canEditRef.current = Boolean(canEdit);
    }, [canEdit]);

    useEffect(() => {
        if (isAuthenticated) return;

        setEditing(false);
        setAddOpen(false);
        setIsOwner(false);
        setActionsMenuOpen(false);
        setReorderLocked(false);

        const t = reorderDebounceTimerRef.current;
        if (t) {
            reorderDebounceTimerRef.current = null;
            try {
                if (typeof window !== 'undefined' && window.clearTimeout) {
                    window.clearTimeout(t);
                }
            } catch {
            }
        }

        reorderPendingRef.current = null;
        reorderDragStartTracksRef.current = null;
        reorderNeedsFlushRef.current = false;
        reorderInFlightRef.current = false;
    }, [isAuthenticated]);

    useEffect(() => {
        if (!actionsMenuOpen) return undefined;
        const onDocPointerDown = (e) => {
            if (actionsMenuRef.current && actionsMenuRef.current.contains(e.target)) return;
            setActionsMenuOpen(false);
        };
        document.addEventListener('pointerdown', onDocPointerDown);
        return () => document.removeEventListener('pointerdown', onDocPointerDown);
    }, [actionsMenuOpen]);

    const addVirtualToProfile = useCallback(async () => {
        if (!virtualPlaylist) return;
        const title = String(virtualPlaylist.title || '').trim() || 'Плейлист';
        const description = String(virtualPlaylist.description || '').trim();
        const tracksToAdd = Array.isArray(virtualPlaylist.tracks) ? virtualPlaylist.tracks : [];
        const ids = tracksToAdd
            .map((t) => parsePositiveInt(t?.id))
            .filter((v) => Number.isFinite(v) && v > 0);
        if (ids.length < 1) return;

        setSavingEdit(true);
        setEditError(null);
        try {
            const created = await apiClient.createPlaylist({ name: title, description, is_public: false });
            const newId = parsePositiveInt(created?.id);
            if (!newId) {
                setEditError('Не удалось создать плейлист');
                return;
            }

            const batches = chunkArray(ids, 100);
            for (const batch of batches) {
                await apiClient.addTracksToPlaylist(newId, batch);
            }

            navigate(`/playlist/${encodeURIComponent(String(newId))}`);
        } catch (e) {
            setEditError(e?.message || 'Не удалось добавить');
        } finally {
            setSavingEdit(false);
        }
    }, [navigate, virtualPlaylist]);

    const toggleEditPanel = useCallback(() => {
        setEditError(null);
        setEditName(String(playlist?.name || ''));
        setEditDescription(String(playlist?.description || ''));
        setEditing((prev) => !prev);
        setAddOpen(false);
    }, [playlist]);

    const toggleAddPanel = useCallback(async () => {
        const canOpen = Boolean(effectivePlaylistId) && Boolean(canEdit);
        if (!canOpen) return;
        setEditError(null);
        setEditing(false);
        setAddOpen((prev) => !prev);
        if (librarySongs.length > 0) return;

        setLibraryLoading(true);
        setLibraryError(null);
        try {
            const r = await apiClient.getSongs({ page: 1, limit: 200, search: '' });
            const songs = Array.isArray(r)
                ? r
                : (Array.isArray(r?.songs) ? r.songs : (Array.isArray(r?.items) ? r.items : []));
            setLibrarySongs(Array.isArray(songs) ? songs : []);
        } catch (e) {
            setLibraryError(e?.message || 'Не удалось загрузить библиотеку');
        } finally {
            setLibraryLoading(false);
        }
    }, [effectivePlaylistId, canEdit, librarySongs.length]);

    useEffect(() => {
        loadPlaylist();
    }, [loadPlaylist]);

    const handleBack = useCallback(() => {
        navigate(-1);
    }, [navigate]);

    const handlePlayAll = useCallback(() => {
        if (!Array.isArray(tracks) || tracks.length === 0) return;
        player.playPlaylist(tracks, playlist?.name || 'Плейлист');
    }, [tracks, player, playlist]);

    const handlePlayFrom = useCallback((index) => {
        if (!Array.isArray(tracks) || tracks.length === 0) return;
        const start = Math.max(0, Math.min(tracks.length - 1, index));
        const reordered = [...tracks.slice(start), ...tracks.slice(0, start)];
        player.playPlaylist(reordered, playlist?.name || 'Плейлист');
    }, [tracks, player, playlist]);

    const handleCopyLink = useCallback(async () => {
        let slug = resolvedShareSlug || playlist?.share_slug || null;

        if (!slug && !isPublicView && isOwner && resolvedPlaylistId) {
            try {
                const regenerated = await apiClient.regeneratePlaylistShareLink(resolvedPlaylistId);
                if (regenerated && regenerated.share_slug) {
                    slug = regenerated.share_slug;
                    setPlaylist((prev) => (prev && typeof prev === 'object' ? { ...prev, share_slug: regenerated.share_slug } : prev));
                }
            } catch (e) {
            }
        }

        if (!slug) return;
        const shareUrl = buildPlaylistShareUrlFromSlug(slug);

        try {
            await navigator.clipboard.writeText(shareUrl);
        } catch {
            try {
                window.prompt('Скопируйте ссылку:', shareUrl);
            } catch {
            }
        }
    }, [resolvedPlaylistId, resolvedShareSlug, playlist, isPublicView, isOwner]);

    const closeEdit = useCallback(() => {
        setEditing(false);
        setEditError(null);
    }, []);

    const saveEdit = useCallback(async () => {
        if (!effectivePlaylistId || !canEdit) return;

        const name = (editName || '').trim();
        const description = (editDescription || '').trim();

        if (!name) {
            setEditError('Введите название');
            return;
        }
        if (name.length > 100) {
            setEditError('Название не может превышать 100 символов');
            return;
        }
        if (description.length > 500) {
            setEditError('Описание не может превышать 500 символов');
            return;
        }

        setSavingEdit(true);
        setEditError(null);

        try {
            const updated = await apiClient.updatePlaylist(effectivePlaylistId, { name, description });
            setPlaylist((prev) => ({ ...(prev || {}), ...(updated || {}) }));
            setEditing(false);
        } catch (e) {
            setEditError(e?.message || 'Не удалось сохранить');
        } finally {
            setSavingEdit(false);
        }
    }, [effectivePlaylistId, editName, editDescription, canEdit]);

    const handleDelete = useCallback(async () => {
        if (!effectivePlaylistId || !canEdit) return;
        const ok = window.confirm('Удалить плейлист?');
        if (!ok) return;

        try {
            await apiClient.deletePlaylist(effectivePlaylistId);
            navigate('/profile');
        } catch (e) {
            setError(e?.message || 'Не удалось удалить плейлист');
        }
    }, [effectivePlaylistId, navigate, canEdit]);

    const removeTrack = useCallback(async (songId) => {
        if (!effectivePlaylistId || !canEdit) return;
        const id = parsePositiveInt(songId);
        if (!id) return;

        try {
            await apiClient.removeTrackFromPlaylist(effectivePlaylistId, id);
            setTracks((prev) => {
                const base = Array.isArray(prev) ? prev : [];
                const next = base.filter((t) => String(t.id) !== String(id));
                const first = next[0] || null;
                notifyPlaylistChanged({
                    playlistId: effectivePlaylistId,
                    type: 'remove',
                    delta: -1,
                    cover_path: first?.cover_path || null,
                    trackId: first?.id || null,
                    removedTrackId: id,
                    nextIds: next.map((t) => String(t?.id || '')).filter(Boolean),
                    updated_at: new Date().toISOString(),
                });
                return next;
            });
        } catch (e) {
            setError(e?.message || 'Не удалось удалить трек');
        }
    }, [effectivePlaylistId, canEdit]);

    const findSingleMove = useCallback((prevIds, nextIds) => {
        const prev = Array.isArray(prevIds) ? prevIds.map(String) : [];
        const next = Array.isArray(nextIds) ? nextIds.map(String) : [];

        if (prev.length !== next.length || prev.length === 0) return null;

        let firstDiff = -1;
        for (let i = 0; i < prev.length; i += 1) {
            if (prev[i] !== next[i]) {
                firstDiff = i;
                break;
            }
        }
        if (firstDiff === -1) return null;

        const movedId = next[firstDiff];
        const fromIndex = prev.indexOf(movedId);
        if (fromIndex === -1) return null;

        return { movedId, toIndex: firstDiff, fromIndex };
    }, []);

    const flushPendingReorder = useCallback(() => {
        const t = reorderDebounceTimerRef.current;
        if (t) {
            reorderDebounceTimerRef.current = null;
            try {
                if (typeof window !== 'undefined' && window.clearTimeout) {
                    window.clearTimeout(t);
                } else {
                    clearTimeout(t);
                }
            } catch {
            }
        }

        const pending = reorderPendingRef.current;
        if (!pending) return;

        if (!canEditRef.current) {
            reorderPendingRef.current = null;
            reorderDragStartTracksRef.current = null;
            reorderNeedsFlushRef.current = false;
            reorderInFlightRef.current = false;
            setReorderLocked(false);
            return;
        }

        if (reorderInFlightRef.current) {
            reorderNeedsFlushRef.current = true;
            return;
        }

        reorderInFlightRef.current = true;
        setReorderLocked(true);
        reorderNeedsFlushRef.current = false;

        apiClient
            .reorderPlaylistTrack(pending.playlistId, pending.movedTrackId, pending.newPosition)
            .then(() => {
                lastOrderRef.current = pending.nextIds;
                reorderPendingRef.current = null;
                reorderDragStartTracksRef.current = null;

                notifyPlaylistChanged({
                    playlistId: pending.playlistId,
                    type: 'reorder',
                    nextIds: pending.nextIds,
                    movedTrackId: pending.movedTrackId,
                    newPosition: pending.newPosition,
                    updated_at: new Date().toISOString(),
                });
            })
            .catch((e) => {
                const fallback = reorderDragStartTracksRef.current;
                if (Array.isArray(fallback) && fallback.length > 0) {
                    setTracks(fallback);
                    lastOrderRef.current = fallback.map((t) => String(t?.id || '')).filter(Boolean);
                }
                reorderPendingRef.current = null;
                reorderDragStartTracksRef.current = null;
                setError(e?.message || 'Не удалось изменить порядок');
            })
            .finally(() => {
                reorderInFlightRef.current = false;
                setReorderLocked(false);
                if (reorderNeedsFlushRef.current && reorderPendingRef.current) {
                    reorderNeedsFlushRef.current = false;
                    const setT = (typeof window !== 'undefined' && window.setTimeout) ? window.setTimeout : setTimeout;
                    reorderDebounceTimerRef.current = setT(() => {
                        flushPendingReorder();
                    }, 0);
                }
            });
    }, [setTracks]);

    const reorderTracks = useCallback((nextTracks) => {
        if (!canEdit || !effectivePlaylistId) {
            setTracks(nextTracks);
            return;
        }

        const prevTracks = Array.isArray(tracks) ? tracks : [];
        const prevIds = prevTracks.map((t) => String(t?.id || ''));
        const nextIds = (Array.isArray(nextTracks) ? nextTracks : []).map((t) => String(t?.id || ''));

        const move = findSingleMove(prevIds, nextIds);
        setTracks(nextTracks);

        if (!move) {
            lastOrderRef.current = nextIds;
            return;
        }

        const movedInt = parsePositiveInt(move.movedId);
        if (!movedInt) return;

        if (!reorderDragStartTracksRef.current) {
            reorderDragStartTracksRef.current = prevTracks;
        }

        reorderPendingRef.current = {
            playlistId: effectivePlaylistId,
            movedTrackId: movedInt,
            newPosition: move.toIndex + 1,
            nextIds,
        };

        if (reorderDebounceTimerRef.current) {
            const clearT = (typeof window !== 'undefined' && window.clearTimeout) ? window.clearTimeout : clearTimeout;
            clearT(reorderDebounceTimerRef.current);
        }
        const setT = (typeof window !== 'undefined' && window.setTimeout) ? window.setTimeout : setTimeout;
        reorderDebounceTimerRef.current = setT(() => {
            flushPendingReorder();
        }, 350);
    }, [effectivePlaylistId, findSingleMove, flushPendingReorder, canEdit, tracks]);


    const libraryDataset = useMemo(() => (Array.isArray(librarySongs) ? librarySongs : []), [librarySongs]);
    const searchedLibrary = useSearch(libraryDataset, search, { topN: 200 });
    const filteredLibrary = (search || '').trim() ? searchedLibrary : libraryDataset;

    const addSong = useCallback(async (song) => {
        if (!effectivePlaylistId || !song || !canEdit) return;
        const id = parsePositiveInt(song.id);
        if (!id) return;
        if (tracks.some((t) => String(t.id) === String(id))) return;

        setAddingSongId(id);
        setLibraryError(null);

        try {
            await apiClient.addTrackToPlaylist(effectivePlaylistId, id);
            setTracks((prev) => {
                const base = Array.isArray(prev) ? prev : [];
                return [...base, song];
            });
            setPlaylist((prev) => {
                if (!prev || typeof prev !== 'object') return prev;
                if (!prev.cover_path && song.cover_path) {
                    return { ...prev, cover_path: song.cover_path, updated_at: new Date().toISOString() };
                }
                return prev;
            });
            notifyPlaylistChanged({
                playlistId: effectivePlaylistId,
                delta: 1,
                cover_path: song?.cover_path || null,
                trackId: song?.id || null,
                updated_at: new Date().toISOString(),
            });
        } catch (e) {
            setLibraryError(e?.message || 'Не удалось добавить трек');
        } finally {
            setAddingSongId(null);
        }
    }, [effectivePlaylistId, canEdit, tracks]);

    if (loading) {
        return (
            <Page>
                <TopBarOuter>
                    <TopBarInner>
                        <TopBarLeft>
                            <BackButton onClick={handleBack} type="button" aria-label="Назад"><FaChevronLeft /></BackButton>
                            <TopTitle>Плейлист</TopTitle>
                        </TopBarLeft>
                        <TopBarRight>
                            <BrandLink size="sm" />
                        </TopBarRight>
                    </TopBarInner>
                </TopBarOuter>

                <Hero>
                    <HeroContent>
                        <div style={{ padding: '24px 0', color: 'rgba(255,255,255,0.6)' }}>Загрузка...</div>
                    </HeroContent>
                </Hero>
            </Page>
        );
    }

    if (error) {
        return (
            <Page>
                <TopBarOuter>
                    <TopBarInner>
                        <TopBarLeft>
                            <BackButton onClick={handleBack} type="button" aria-label="Назад"><FaChevronLeft /></BackButton>
                            <TopTitle>Плейлист</TopTitle>
                        </TopBarLeft>
                        <TopBarRight>
                            <BrandLink size="sm" />
                        </TopBarRight>
                    </TopBarInner>
                </TopBarOuter>

                <Hero>
                    <HeroContent>
                        <div style={{ padding: '24px 0', color: 'rgba(255,160,160,0.95)' }}>{String(error)}</div>
                        <SecondaryButton onClick={loadPlaylist} type="button">Обновить</SecondaryButton>
                    </HeroContent>
                </Hero>
            </Page>
        );
    }

    return (
        <Page>
            <TopBarOuter>
                <TopBarInner>
                    <TopBarLeft>
                        <BackButton onClick={handleBack} type="button" aria-label="Назад"><FaChevronLeft /></BackButton>
                        <TopTitle>Плейлист</TopTitle>
                    </TopBarLeft>
                    <TopBarRight>
                        <BrandLink size="sm" />
                    </TopBarRight>
                </TopBarInner>
            </TopBarOuter>

            <Hero>
                {coverUrl ? (
                    <HeroLayer>
                        <HeroImage src={coverUrl} alt="" />
                    </HeroLayer>
                ) : (
                    <HeroLayer>
                    </HeroLayer>
                )}

                <HeroOverlay />

                <HeroContent>
                    <AlbumHeader>
                        <Cover>
                            {coverUrl ? <img src={coverUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
                        </Cover>

                        <Info style={{ minWidth: 0 }}>
                            <Type>Плейлист</Type>
                            <Title>{playlist?.name || 'Плейлист'}</Title>
                            {playlist?.description ? <Description>{playlist.description}</Description> : null}
                            <Meta>{headerMeta}</Meta>

                            <ActionBar>
                                <Actions>
                                    <PlayButton type="button" onClick={handlePlayAll}><FaPlay />Слушать</PlayButton>
                                    {(resolvedShareSlug || playlist?.share_slug || virtualPlaylist || canEdit) ? (
                                        <ActionsOverflow ref={actionsMenuRef}>
                                            <MoreButton
                                                type="button"
                                                aria-haspopup="menu"
                                                aria-expanded={actionsMenuOpen}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActionsMenuOpen((prev) => !prev);
                                                }}
                                                title="Ещё"
                                            >
                                                <FaEllipsisH />
                                            </MoreButton>
                                            {actionsMenuOpen ? (
                                                <ActionsMenu role="menu">
                                                    {resolvedShareSlug || playlist?.share_slug ? (
                                                        <SecondaryButton type="button" role="menuitem" onClick={() => { setActionsMenuOpen(false); handleCopyLink(); }}><FaLink />Ссылка</SecondaryButton>
                                                    ) : null}
                                                    {virtualPlaylist ? (
                                                        <SecondaryButton type="button" role="menuitem" onClick={() => { setActionsMenuOpen(false); addVirtualToProfile(); }}><FaPlus />Добавить</SecondaryButton>
                                                    ) : null}
                                                    {canEdit ? (
                                                        <>
                                                            <SecondaryButton type="button" role="menuitem" onClick={() => { setActionsMenuOpen(false); toggleEditPanel(); }}><FaEdit />Изменить</SecondaryButton>
                                                            <SecondaryButton type="button" role="menuitem" onClick={() => { setActionsMenuOpen(false); toggleAddPanel(); }}><FaPlus />Добавить</SecondaryButton>
                                                            <DangerButton type="button" role="menuitem" onClick={() => { setActionsMenuOpen(false); handleDelete(); }}><FaTrash />Удалить</DangerButton>
                                                        </>
                                                    ) : null}
                                                </ActionsMenu>
                                            ) : null}
                                        </ActionsOverflow>
                                    ) : null}
                                </Actions>
                            </ActionBar>

                            {canEdit && editing ? (
                                <Panel>
                                    <PanelTitle>Редактирование</PanelTitle>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Название" />
                                        <TextArea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Описание" />
                                        {editError ? <ErrorText>{String(editError)}</ErrorText> : null}
                                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                            <SmallPrimaryButton type="button" onClick={saveEdit} disabled={savingEdit} style={{ opacity: savingEdit ? 0.7 : 1 }}>
                                                Сохранить
                                            </SmallPrimaryButton>
                                            <SmallButton type="button" onClick={closeEdit}>
                                                Закрыть
                                            </SmallButton>
                                        </div>
                                    </div>
                                </Panel>
                            ) : null}

                            {canEdit && addOpen ? (
                                <Panel>
                                    <PanelTitle>Добавить трек</PanelTitle>
                                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск" />
                                    {libraryLoading ? <SmallText>Загрузка...</SmallText> : null}
                                    {libraryError ? <ErrorText>{String(libraryError)}</ErrorText> : null}
                                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {filteredLibrary.slice(0, 200).map((s) => {
                                            const sid = parsePositiveInt(s.id);
                                            const exists = sid ? tracks.some((t) => String(t.id) === String(sid)) : false;
                                            const busy = sid && addingSongId === sid;

                                            return (
                                                <div
                                                    key={s.id}
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: '52px 1fr auto',
                                                        gap: 12,
                                                        alignItems: 'center',
                                                        padding: '10px 12px',
                                                        borderRadius: 16,
                                                        border: '1px solid rgba(255,255,255,0.06)',
                                                        background: 'rgba(255,255,255,0.04)'
                                                    }}
                                                >
                                                    <TrackCover>
                                                        <img src={apiClient.getCoverUrl(s)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                                    </TrackCover>
                                                    <div style={{ minWidth: 0 }}>
                                                        <TrackTitle title={s.title || ''}>{s.title || 'Без названия'}</TrackTitle>
                                                        <TrackArtist title={s.artist || ''}>{s.artist || 'Неизвестный'}</TrackArtist>
                                                    </div>
                                                    <SmallButton
                                                        type="button"
                                                        onClick={() => addSong(s)}
                                                        disabled={exists || busy}
                                                        style={{ opacity: exists || busy ? 0.6 : 1 }}
                                                    >
                                                        {exists ? 'Добавлено' : (busy ? '...' : 'Добавить')}
                                                    </SmallButton>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </Panel>
                            ) : null}
                        </Info>
                    </AlbumHeader>
                </HeroContent>
            </Hero>

            <ListSection>
                <SectionTitle>Треки</SectionTitle>

                <TrackList
                    as={Reorder.Group}
                    axis="y"
                    values={tracks}
                    onReorder={reorderTracks}
                >
                    {tracks.map((track, index) => (
                        <PlaylistTrackRow
                            key={track.id}
                            track={track}
                            index={index}
                            isOwner={canEdit}
                            dragEnabled={!reorderLocked}
                            isActive={String(player.currentTrack?.id ?? '') === String(track?.id ?? '')}
                            isPlaying={!!player.isPlaying}
                            onPlayFrom={handlePlayFrom}
                            onRemoveTrack={removeTrack}
                        />
                    ))}
                </TrackList>
            </ListSection>
        </Page>
    );

}
