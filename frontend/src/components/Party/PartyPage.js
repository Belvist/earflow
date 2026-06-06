import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import styled from 'styled-components';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ConnectionState } from '../../hooks/useParty';
import { usePlayer } from '../../context/PlayerContext';
import apiClient from '../../api/client';

// Icons
const PlayIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
    </svg>
);

const PauseIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
);

const UsersIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
);

const ShareIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
    </svg>
);

const CloseIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
);

// Reaction emojis
const REACTIONS = [
    { type: 'like', emoji: '👍' },
    { type: 'fire', emoji: '🔥' },
    { type: 'heart', emoji: '❤️' },
    { type: 'clap', emoji: '👏' },
    { type: 'laugh', emoji: '😂' },
    { type: 'wow', emoji: '😮' }
];

const pageFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const pageDisplay = "'Unbounded', -apple-system, BlinkMacSystemFont, sans-serif";

// Styled Components — компактный «премиум» тёмный слой в духе Apple / Spotify
const Container = styled.div`
  min-height: 100vh;
  min-height: calc(var(--app-vh, 1vh) * 100);
  background: var(--ef-surface-main, #0d0d0d);
  font-family: ${pageFont};
  padding: 16px;
  padding-bottom: 128px;
  
  @media (min-width: 768px) {
    padding: 20px 28px;
    padding-bottom: 140px;
  }
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
`;

const BackButton = styled.button`
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 50%;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.14);
  }
  
  svg {
    width: 20px;
    height: 20px;
  }
`;

const PartyInfo = styled.div`
  text-align: center;
  flex: 1;
`;

const PartyTitle = styled.h1`
  font-size: 17px;
  font-weight: 600;
  font-family: ${pageDisplay};
  color: rgba(255, 255, 255, 0.95);
  margin: 0 0 3px 0;
  letter-spacing: -0.02em;
  line-height: 1.2;
`;

const PartyMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 12px;
  font-weight: 500;
`;

const ConnectionBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: ${props => {
        switch (props.$state) {
            case ConnectionState.CONNECTED: return 'rgba(30, 215, 96, 0.14)';
            case ConnectionState.CONNECTING:
            case ConnectionState.RECONNECTING: return 'rgba(255, 193, 7, 0.12)';
            default: return 'rgba(244, 67, 54, 0.15)';
        }
    }};
  color: ${props => {
        switch (props.$state) {
            case ConnectionState.CONNECTED: return '#1ed760';
            case ConnectionState.CONNECTING:
            case ConnectionState.RECONNECTING: return '#e6b00a';
            default: return '#f87171';
        }
    }};

  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    animation: ${props =>
        props.$state === ConnectionState.CONNECTING || props.$state === ConnectionState.RECONNECTING
            ? 'pulse 1s infinite'
            : 'none'
    };
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`;

// Компактная кнопка ручного переподключения WebSocket для party.
// Показывается только в RECONNECTING / ERROR / DISCONNECTED состояниях.
const ReconnectButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-left: 6px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, transform 0.12s ease, border-color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.28);
  }

  &:active {
    transform: scale(0.94);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.45);
    outline-offset: 2px;
  }
`;

const CoverSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 30px;
`;

const CoverImage = styled.div`
  width: 280px;
  height: 350px;
  border-radius: 16px;
  background: ${props => props.$src ? `url(${props.$src})` : 'linear-gradient(135deg, #333 0%, #1a1a1a 100%)'};
  background-size: cover;
  background-position: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  position: relative;
  overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.4) 100%);
  }
`;

const TrackInfo = styled.div`
  text-align: center;
  margin-top: 20px;
`;

const TrackTitle = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  margin: 0 0 4px 0;
  letter-spacing: -0.02em;
`;

const TrackArtist = styled.p`
  font-size: 14px;
  color: rgba(255, 255, 255, 0.55);
  margin: 0;
`;

const NoTrack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin: 30px 0;
`;

const PlayButton = styled.button`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #fff;
  border: none;
  color: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ${props => props.disabled ? 'default' : 'pointer'};
  opacity: ${props => props.disabled ? 0.45 : 1};
  transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);

  &:hover:not(:disabled) {
    transform: scale(1.04);
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }
  
  svg {
    width: 22px;
    height: 22px;
  }
`;

const ReactionBar = styled.div`
  display: flex;
  justify-content: center;
  gap: 12px;
  margin: 20px 0;
`;

const ReactionButton = styled(motion.button)`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 19px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.14);
  }
`;

const ReactionsOverlay = styled.div`
  position: fixed;
  bottom: 150px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  z-index: 100;
`;

const FloatingReaction = styled(motion.div)`
  font-size: 32px;
  position: absolute;
`;

const ShareSection = styled.div`
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 16px;
  margin-top: 24px;
`;

const ShareTitle = styled.h3`
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin: 0 0 10px 0;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const InviteCode = styled.div`
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 12px 14px;
  text-align: center;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 3px;
  color: rgba(255, 255, 255, 0.95);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
`;

const CopyHint = styled.p`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  margin: 8px 0 0 0;
`;

const ActionButtons = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 16px;
`;

const ActionButton = styled.button`
  flex: 1;
  padding: 9px 10px;
  border-radius: 999px;
  border: none;
  font-size: 12px;
  font-weight: 600;
  font-family: ${pageFont};
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  ${props => props.$variant === 'danger' ? `
    background: rgba(244, 67, 54, 0.2);
    color: #f44336;
    
    &:hover {
      background: rgba(244, 67, 54, 0.3);
    }
  ` : `
    background: rgba(255, 255, 255, 0.1);
    color: white;
    
    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  `}
`;

const LoadingOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 200;
  color: white;
  gap: 16px;
`;

const Spinner = styled.div`
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

const ErrorMessage = styled.div`
  background: rgba(244, 67, 54, 0.1);
  border: 1px solid rgba(244, 67, 54, 0.3);
  border-radius: 12px;
  padding: 16px;
  color: #f44336;
  text-align: center;
  margin: 20px 0;
`;

// Track Selection Components
const TrackListSection = styled.div`
  background: rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  margin-top: 20px;
  max-height: 400px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const TrackListHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const TrackListTitle = styled.h3`
  font-size: 16px;
  font-weight: 600;
  color: white;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const TrackSearchInput = styled.input`
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  color: white;
  font-size: 14px;
  width: 100%;
  margin: 0 16px 12px;
  
  &::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }
  
  &:focus {
    outline: none;
    background: rgba(255, 255, 255, 0.15);
  }
`;

const TrackListScroll = styled.div`
  overflow-y: auto;
  flex: 1;
  padding: 0 8px 8px;
  
  &::-webkit-scrollbar {
    width: 4px;
  }
  
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
`;

const TrackItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s;
  background: ${props => props.$isPlaying ? 'rgba(255, 255, 255, 0.15)' : 'transparent'};
  
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
`;

const TrackItemCover = styled.div`
  width: 44px;
  height: 55px;
  border-radius: 6px;
  background: ${props => props.$src ? `url(${props.$src})` : 'linear-gradient(135deg, #333 0%, #1a1a1a 100%)'};
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
`;

const TrackItemInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const TrackItemTitle = styled.p`
  font-size: 14px;
  font-weight: 500;
  color: white;
  margin: 0 0 2px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TrackItemArtist = styled.p`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TrackItemDuration = styled.span`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
`;

const MusicNoteIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
);

// Format duration helper
const formatDuration = (seconds) => {
    if (!seconds || isNaN(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Build cover URL helper - handles different path formats
const getCoverUrl = (apiClient, song) => {
    if (!apiClient || typeof apiClient.getCoverUrl !== 'function') return null;
    return apiClient.getCoverUrl(song);
};

export default function PartyPage() {
    const { partyId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const [inviteCode, setInviteCode] = useState(null);
    const [copySuccess, setCopySuccess] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [joinError, setJoinError] = useState(null);

    const player = usePlayer();

    const {
        playTrackById,
        pausePlayback,
        resumePlayback,
        exitPartyMode,
        partyMode,
        isPlaying: localIsPlaying,
        setActivePartyId,
        party: partyHook,
    } = player || {};

    // Pool of tracks host can pick from. Prefer the full library over the
    // currently-active queue source (which may be empty or limited, e.g. if
    // user hasn't started playback yet). Fall back to whatever is available.
    const allTracks = useMemo(() => {
        const fromLibrary = Array.isArray(player?.libraryTracks) ? player.libraryTracks : [];
        if (fromLibrary.length > 0) return fromLibrary;

        const fromQueue = Array.isArray(player?.tracks) ? player.tracks : [];
        if (fromQueue.length > 0) return fromQueue;

        const fromLiked = Array.isArray(player?.likedTracks) ? player.likedTracks : [];
        return fromLiked;
    }, [player?.libraryTracks, player?.tracks, player?.likedTracks]);

    // Destructure party hook for backward-compatible variable names
    const connectionState = partyHook?.connectionState || 'disconnected';
    const isConnected = partyHook?.isConnected || false;
    const party = partyHook?.party;
    const playbackState = partyHook?.playbackState || {};
    const isHost = partyHook?.isHost || false;
    const participantCount = partyHook?.participantCount || 0;
    const reactions = partyHook?.reactions || [];
    const error = partyHook?.error;
    const play = partyHook?.play;
    const pause = partyHook?.pause;
    const setTrack = partyHook?.setTrack;
    const sendReaction = partyHook?.sendReaction;
    const forceReconnect = partyHook?.forceReconnect;
    // Show manual reconnect affordance only when we're clearly stuck.
    const canManualReconnect =
        connectionState === ConnectionState.RECONNECTING ||
        connectionState === ConnectionState.ERROR ||
        connectionState === ConnectionState.DISCONNECTED;

    const [trackSearch, setTrackSearch] = useState('');

    // Ref to prevent multiple join attempts
    const joinAttemptedRef = useRef(false);

    // Join party on mount — sets activePartyId which triggers bridge WS connection
    useEffect(() => {
        if (joinAttemptedRef.current) return;
        if (!partyId) return;

        let mounted = true;
        const controller = new AbortController();

        const joinAndConnect = async () => {
            joinAttemptedRef.current = true;
            setIsLoading(true);
            setJoinError(null);

            try {
                const invitePayload = searchParams.get('invite');

                if (invitePayload) {
                    await apiClient.joinPartyByLink(invitePayload, { signal: controller.signal });
                } else {
                    await apiClient.joinParty(partyId, { signal: controller.signal });
                }

                if (!mounted || controller.signal.aborted) return;

                setActivePartyId(partyId);
            } catch (err) {
                if (!mounted || (err && err.name === 'AbortError') || controller.signal.aborted) {
                    return;
                }
                setJoinError(err.message);
                joinAttemptedRef.current = false;
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        };

        joinAndConnect();

        return () => {
            joinAttemptedRef.current = false;
            mounted = false;
            controller.abort();
        };
    }, [partyId, searchParams, setActivePartyId]);

    // Generate invite code
    const generateInvite = useCallback(async () => {
        try {
            const response = await apiClient.createPartyInvite(partyId);
            setInviteCode(response.invite.code);
        } catch (err) {
            void err;
        }
    }, [partyId]);

    // Generate invite on connect (host only)
    useEffect(() => {
        if (isConnected && isHost && !inviteCode) {
            generateInvite();
        }
    }, [isConnected, isHost, inviteCode, generateInvite]);

    // Navigate home when party ends
    useEffect(() => {
        if (!partyMode && joinAttemptedRef.current && !isLoading && !joinError) {
            navigate('/');
        }
    }, [partyMode, isLoading, joinError, navigate]);

    // Copy invite code
    const copyInviteCode = useCallback(async () => {
        if (!inviteCode) return;

        try {
            await navigator.clipboard.writeText(inviteCode);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (err) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = inviteCode;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        }
    }, [inviteCode]);

    // Leave party
    const handleLeave = useCallback(async () => {
        try {
            if (isHost) {
                if (!window.confirm('Вы хост. Завершить party для всех?')) {
                    return;
                }
                await apiClient.endParty(partyId);
            } else {
                await apiClient.leaveParty(partyId);
            }
        } catch (err) {
            void err;
        }

        partyHook?.disconnect?.();
        exitPartyMode?.();
        setActivePartyId?.(null);
        navigate('/');
    }, [partyId, isHost, navigate, exitPartyMode, setActivePartyId, partyHook]);

    // Filter tracks by search
    const filteredTracks = useMemo(() => {
        if (!trackSearch.trim()) return allTracks;
        const searchLower = trackSearch.toLowerCase();
        return allTracks.filter(track =>
            track.title?.toLowerCase().includes(searchLower) ||
            track.artist?.toLowerCase().includes(searchLower) ||
            track.album?.toLowerCase().includes(searchLower)
        );
    }, [allTracks, trackSearch]);

    // Select track handler (host only)
    const handleSelectTrack = useCallback((track) => {
        if (!isHost) return;
        if (!track || !track.id) return;

        if (setTrack) {
            const coverCandidate = typeof track.cover_path === 'string'
                ? track.cover_path
                : (typeof track.coverPath === 'string' ? track.coverPath : (typeof track.cover === 'string' ? track.cover : ''));
            setTrack({
                trackId: track.id,
                trackTitle: track.title || 'Без названия',
                trackArtist: track.artist || 'Неизвестный исполнитель',
                trackCover: coverCandidate || null,
            });
        }

        if (playTrackById) {
            playTrackById(track.id, true);
        }

        setTimeout(() => {
            if (play) play();
        }, 100);
    }, [isHost, setTrack, play, playTrackById]);

    // Toggle play/pause (host only)
    const togglePlayback = useCallback(() => {
        if (!isHost) return;

        const currentlyPlaying = localIsPlaying;
        const newPlayingState = !currentlyPlaying;

        if (newPlayingState) {
            if (play) play();
            if (resumePlayback) resumePlayback();
        } else {
            if (pause) pause();
            if (pausePlayback) pausePlayback();
        }
    }, [isHost, localIsPlaying, play, pause, pausePlayback, resumePlayback]);

    if (isLoading) {
        return (
            <LoadingOverlay>
                <Spinner />
                <p style={{ fontSize: 13 }}>Подключаемся к сессии…</p>
            </LoadingOverlay>
        );
    }

    if (joinError) {
        return (
            <Container>
                <Header>
                    <BackButton onClick={() => navigate('/')}>
                        <CloseIcon />
                    </BackButton>
                </Header>
                <ErrorMessage>
                    <p>Не удалось присоединиться к сессии</p>
                    <p style={{ fontSize: 13, marginTop: 8, opacity: 0.7 }}>{joinError}</p>
                </ErrorMessage>
                <ActionButton onClick={() => navigate('/')}>
                    Вернуться на главную
                </ActionButton>
            </Container>
        );
    }

    return (
        <Container>
            <Header>
                <BackButton onClick={() => navigate('/')}>
                    <CloseIcon />
                </BackButton>

                <PartyInfo>
                    <PartyTitle>{party?.title || 'Совместное прослушивание'}</PartyTitle>
                    <PartyMeta>
                        <UsersIcon />
                        {participantCount} {participantCount === 1 ? 'слушатель' : 'слушателей'}
                        <ConnectionBadge $state={connectionState}>
                            {connectionState === ConnectionState.CONNECTED && 'Live'}
                            {connectionState === ConnectionState.CONNECTING && 'Подключение...'}
                            {connectionState === ConnectionState.RECONNECTING && 'Переподключение...'}
                            {connectionState === ConnectionState.DISCONNECTED && 'Отключено'}
                            {connectionState === ConnectionState.ERROR && 'Ошибка'}
                        </ConnectionBadge>
                        {canManualReconnect && typeof forceReconnect === 'function' && (
                            <ReconnectButton
                                type="button"
                                onClick={forceReconnect}
                                aria-label="Переподключиться"
                                title="Переподключиться"
                            >
                                ↻
                            </ReconnectButton>
                        )}
                    </PartyMeta>
                </PartyInfo>

                <div style={{ width: 38 }} />
            </Header>

            {error && (
                <ErrorMessage>
                    {error.message || 'Произошла ошибка'}
                </ErrorMessage>
            )}

            <CoverSection>
                {playbackState.trackId ? (
                    <>
                        <CoverImage $src={apiClient.getCoverUrl({ cover: playbackState.trackCover }) || playbackState.trackCover} />
                        <TrackInfo>
                            <TrackTitle>{playbackState.trackTitle || 'Без названия'}</TrackTitle>
                            <TrackArtist>{playbackState.trackArtist || 'Неизвестный исполнитель'}</TrackArtist>
                        </TrackInfo>
                    </>
                ) : (
                    <NoTrack>
                        <p style={{ fontSize: 40, marginBottom: 12 }}>🎵</p>
                        <p style={{ fontSize: 13 }}>{isHost ? 'Выберите трек' : 'Ожидаем трек от ведущего'}</p>
                    </NoTrack>
                )}
            </CoverSection>

            <Controls>
                <PlayButton
                    onClick={togglePlayback}
                    disabled={!isHost || !playbackState.trackId}
                >
                    {playbackState.isPlaying ? <PauseIcon /> : <PlayIcon />}
                </PlayButton>
            </Controls>

            {!isHost && (
                <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                    Воспроизведение управляет ведущий
                </p>
            )}

            <ReactionBar>
                {REACTIONS.map(reaction => (
                    <ReactionButton
                        key={reaction.type}
                        onClick={() => sendReaction?.(reaction.type)}
                        whileTap={{ scale: 0.9 }}
                    >
                        {reaction.emoji}
                    </ReactionButton>
                ))}
            </ReactionBar>

            {/* Track selection for host */}
            {isHost && (
                <TrackListSection>
                    <TrackListHeader>
                        <TrackListTitle>
                            <MusicNoteIcon /> Выберите трек
                        </TrackListTitle>
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
                            {allTracks.length} треков
                        </span>
                    </TrackListHeader>

                    <TrackSearchInput
                        type="text"
                        placeholder="Поиск по названию или исполнителю..."
                        value={trackSearch}
                        onChange={(e) => setTrackSearch(e.target.value)}
                    />

                    <TrackListScroll>
                        {filteredTracks.length === 0 ? (
                            <p style={{
                                textAlign: 'center',
                                color: 'rgba(255,255,255,0.5)',
                                padding: '20px',
                                fontSize: '14px'
                            }}>
                                {trackSearch
                                    ? 'Треки не найдены'
                                    : (allTracks.length === 0
                                        ? 'Библиотека пуста — загрузите музыку, чтобы делиться ей с друзьями'
                                        : 'Загрузка треков...')}
                            </p>
                        ) : (
                            filteredTracks.slice(0, 50).map(track => (
                                <TrackItem
                                    key={track.id}
                                    onClick={() => handleSelectTrack(track)}
                                    $isPlaying={playbackState.trackId === track.id}
                                >
                                    <TrackItemCover $src={getCoverUrl(apiClient, track)} />
                                    <TrackItemInfo>
                                        <TrackItemTitle>{track.title || 'Без названия'}</TrackItemTitle>
                                        <TrackItemArtist>{track.artist || 'Неизвестный'}</TrackItemArtist>
                                    </TrackItemInfo>
                                    <TrackItemDuration>
                                        {formatDuration(track.duration)}
                                    </TrackItemDuration>
                                </TrackItem>
                            ))
                        )}
                        {filteredTracks.length > 50 && (
                            <p style={{
                                textAlign: 'center',
                                color: 'rgba(255,255,255,0.4)',
                                padding: '10px',
                                fontSize: '12px'
                            }}>
                                Показано 50 из {filteredTracks.length} треков
                            </p>
                        )}
                    </TrackListScroll>
                </TrackListSection>
            )}

            {/* Floating reactions */}
            <ReactionsOverlay>
                <AnimatePresence>
                    {reactions.map((reaction, i) => (
                        <FloatingReaction
                            key={reaction.timestamp}
                            initial={{ y: 0, opacity: 1, x: (Math.random() - 0.5) * 100 }}
                            animate={{ y: -150, opacity: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 2 }}
                        >
                            {REACTIONS.find(r => r.type === reaction.type)?.emoji || '👍'}
                        </FloatingReaction>
                    ))}
                </AnimatePresence>
            </ReactionsOverlay>

            <ShareSection>
                {isHost ? (
                    <>
                        <ShareTitle>
                            <ShareIcon /> Пригласить друзей
                        </ShareTitle>

                        {inviteCode ? (
                            <>
                                <InviteCode onClick={copyInviteCode}>
                                    {inviteCode}
                                </InviteCode>
                                <CopyHint>
                                    {copySuccess ? 'Скопировано' : 'Нажмите, чтобы скопировать'}
                                </CopyHint>
                            </>
                        ) : (
                            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
                                Генерация кода...
                            </p>
                        )}

                        <ActionButtons>
                            <ActionButton onClick={generateInvite}>
                                Новый код
                            </ActionButton>
                            <ActionButton $variant="danger" onClick={handleLeave}>
                                Завершить сессию
                            </ActionButton>
                        </ActionButtons>
                    </>
                ) : (
                    <ActionButtons>
                        <ActionButton $variant="danger" onClick={handleLeave}>
                            Выйти из сессии
                        </ActionButton>
                    </ActionButtons>
                )}
            </ShareSection>
        </Container>
    );
}
