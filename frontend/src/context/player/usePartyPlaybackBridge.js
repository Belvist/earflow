import { useCallback, useEffect, useMemo, useRef } from 'react';
import useParty from '../../hooks/useParty';

const HOST_POSITION_HEARTBEAT_MS = 5000;
const GUEST_DRIFT_THRESHOLD_SEC = 2.0;

/**
 * @description Single sync engine between party WS and player.
 *
 * Guest path: PartySync events → apply to player (track, play/pause, seek).
 * Host path:  player state changes → sendMessage(playback_update) to server.
 *
 * Uses server-timestamp position model: host sends position+isPlaying on
 * state transitions; periodic heartbeat every 5s while playing.
 * Guests interpolate via PartySync.getInterpolatedPositionSec().
 */
export const usePartyPlaybackBridge = ({
    activePartyId,
    player,
    partyMode,
    partyInfo,
    enterPartyMode,
    exitPartyMode,
    currentTrack,
    playTrackById,
    playTrackFromParty,
    onEnterParty,
    onPartyEnded,
    onError,
    onHostNeedsInviteCode,
}) => {
    const lastSyncedTrackRef = useRef(null);
    const pendingSeekRef = useRef({ trackId: null, positionSec: null, attemptsLeft: 0 });
    const partyOptOutRef = useRef(false);
    const partyOptOutTimerRef = useRef(null);
    const remotePauseUntilRef = useRef(0);

    const cbRef = useRef({ onEnterParty, onPartyEnded, onError, onHostNeedsInviteCode, enterPartyMode, exitPartyMode });
    cbRef.current = { onEnterParty, onPartyEnded, onError, onHostNeedsInviteCode, enterPartyMode, exitPartyMode };

    const playerRef = useRef(player);
    playerRef.current = player;

    const currentTrackRef = useRef(currentTrack);
    currentTrackRef.current = currentTrack;

    const getPosSec = useCallback(() => {
        const p = playerRef.current;
        if (typeof p?.getCurrentPositionMs === 'function') {
            const ms = Number(p.getCurrentPositionMs());
            return Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
        }
        const sec = Number(p?.currentTimeRaw);
        return Number.isFinite(sec) && sec > 0 ? sec : 0;
    }, []);

    // ── Guest: apply synced playback state ──
    const applySyncedState = useCallback(async (st) => {
        const s = st && typeof st === 'object' ? st : null;
        if (!s) return;
        const p = playerRef.current;
        if (!p) return;

        const trackIdRaw = s.trackId;
        const hasTrackId = trackIdRaw !== null && trackIdRaw !== undefined && String(trackIdRaw).trim() !== '';
        const trackId = hasTrackId ? String(trackIdRaw) : '';
        const wantsPlaying = s.isPlaying === true;

        const localWantsPlayback =
            (typeof p?.intent?.getWanted === 'function' ? !!p.intent.getWanted() : true) &&
            !partyOptOutRef.current;

        const positionSec = Number.isFinite(Number(s.position)) ? Number(s.position) : null;

        if (trackId) {
            const prev = lastSyncedTrackRef.current ? String(lastSyncedTrackRef.current) : '';
            if (prev !== trackId) {
                lastSyncedTrackRef.current = trackId;
                pendingSeekRef.current = {
                    trackId,
                    positionSec,
                    attemptsLeft: positionSec !== null ? 8 : 0,
                };
                const autoPlay = wantsPlaying && localWantsPlayback;

                const hasWsMetadata = s.trackTitle || s.trackArtist;
                if (hasWsMetadata && typeof playTrackFromParty === 'function') {
                    const wsTrack = {
                        id: trackId,
                        title: s.trackTitle || '',
                        artist: s.trackArtist || '',
                        album: '',
                        cover_path: s.trackCover || '',
                        cover: s.trackCover || '',
                        duration: Number(s.trackDuration) || 0,
                        durationSeconds: Number(s.trackDuration) || 0,
                    };
                    await Promise.resolve(playTrackFromParty(wsTrack, autoPlay));
                } else {
                    await Promise.resolve(playTrackById(trackId, autoPlay));
                }
            }
        }

        if (
            positionSec !== null &&
            Number(p.durationRaw) > 0 &&
            typeof p.seekToPercent === 'function'
        ) {
            const curMs = typeof p.getCurrentPositionMs === 'function' ? Number(p.getCurrentPositionMs()) : 0;
            const cur = Number.isFinite(curMs) && curMs > 0 ? curMs / 1000 : 0;
            const diff = Math.abs(cur - positionSec);
            if (diff >= GUEST_DRIFT_THRESHOLD_SEC) {
                const dur = Number(p.durationRaw);
                const pct = Math.max(0, Math.min(100, (Math.max(0, positionSec) / dur) * 100));
                p.seekToPercent(pct);
            }
            pendingSeekRef.current = { trackId: null, positionSec: null, attemptsLeft: 0 };
        }

        if (!wantsPlaying) {
            remotePauseUntilRef.current = Date.now() + 1200;
            if (p.isPlaying && typeof p.pausePlayback === 'function') {
                await Promise.resolve(p.pausePlayback());
            }
            return;
        }

        remotePauseUntilRef.current = 0;

        if (!localWantsPlayback) return;

        if (!p.isPlaying && typeof p.resumePlayback === 'function') {
            await Promise.resolve(p.resumePlayback());
        }
    }, [playTrackById, playTrackFromParty]);

    // ── Party hook (single WS connection) ──
    const party = useParty(activePartyId, {
        autoConnect: !!activePartyId,

        onPlaybackSync: useCallback((state, isHostUser) => {
            if (isHostUser) return;
            void applySyncedState(state);
        }, [applySyncedState]),

        onPartyEnded: useCallback(() => {
            cbRef.current.onPartyEnded?.();
            cbRef.current.exitPartyMode?.();
        }, []),

        onError: useCallback((err) => {
            cbRef.current.onError?.(err);
        }, []),
    });

    const partyRef = useRef(party);
    partyRef.current = party;
    const partyHostCanPublish = Boolean(party?.isHost && party?.isConnected);
    const partyUpdatePlayback = party?.updatePlayback;
    const currentTrackCover = currentTrack?.cover_path || currentTrack?.coverUrl || currentTrack?.cover || null;

    // ── Guest: handle pending seek after track loads ──
    useEffect(() => {
        const p = pendingSeekRef.current;
        if (!p || !p.trackId || p.positionSec === null) return;
        const pl = playerRef.current;
        if (!Number.isFinite(Number(pl?.durationRaw)) || Number(pl?.durationRaw) <= 0) return;
        if (String(currentTrack?.id || '') !== String(p.trackId)) return;
        if (p.attemptsLeft <= 0) {
            pendingSeekRef.current = { trackId: null, positionSec: null, attemptsLeft: 0 };
            return;
        }

        const dur = Number(pl.durationRaw);
        const pct = Math.max(0, Math.min(100, (Math.max(0, Number(p.positionSec)) / dur) * 100));
        if (typeof pl.seekToPercent === 'function') {
            pl.seekToPercent(pct);
        }
        pendingSeekRef.current = { ...p, attemptsLeft: p.attemptsLeft - 1 };
    }, [currentTrack?.id, player.durationRaw]);

    // ── Guest: opt-out detection (user paused locally) ──
    useEffect(() => {
        if (!party?.isConnected || party?.isHost) return;

        const wanted = typeof player?.intent?.getWanted === 'function' ? !!player.intent.getWanted() : true;
        if (!wanted) {
            partyOptOutRef.current = true;
            if (partyOptOutTimerRef.current) { window.clearTimeout(partyOptOutTimerRef.current); partyOptOutTimerRef.current = null; }
            return;
        }

        if (Date.now() < remotePauseUntilRef.current) {
            return;
        }

        if (player.isPlaying) {
            partyOptOutRef.current = false;
            if (partyOptOutTimerRef.current) { window.clearTimeout(partyOptOutTimerRef.current); partyOptOutTimerRef.current = null; }
            return;
        }

        if (player.isBuffering || partyOptOutTimerRef.current) return;

        partyOptOutTimerRef.current = window.setTimeout(() => {
            partyOptOutTimerRef.current = null;
            const wantedNow = typeof playerRef.current?.intent?.getWanted === 'function' ? !!playerRef.current.intent.getWanted() : true;
            if (!wantedNow || (!playerRef.current?.isPlaying && !playerRef.current?.isBuffering)) {
                partyOptOutRef.current = true;
            }
        }, 450);

        return () => {
            if (partyOptOutTimerRef.current) { window.clearTimeout(partyOptOutTimerRef.current); partyOptOutTimerRef.current = null; }
        };
    }, [party?.isConnected, party?.isHost, player.isPlaying, player.isBuffering, player.intent]);

    // ── Guest: subscribe to PartySync events for seek ──
    useEffect(() => {
        const sync = party?.sync;
        if (!sync || party?.isHost) return;

        const unsubSeek = sync.events.on('seek', (payload) => {
            const positionSec = payload.position;
            if (!Number.isFinite(positionSec)) return;
            const p = playerRef.current;
            if (!p) return;

            const curMs = typeof p.getCurrentPositionMs === 'function' ? Number(p.getCurrentPositionMs()) : 0;
            const cur = Number.isFinite(curMs) && curMs > 0 ? curMs / 1000 : 0;
            if (Math.abs(cur - positionSec) < 1.2) return;

            const dur = Number(p.durationRaw);
            if (!Number.isFinite(dur) || dur <= 0) return;
            if (typeof p.seekToPercent !== 'function') return;

            const pct = Math.max(0, Math.min(100, (Math.max(0, positionSec) / dur) * 100));
            p.seekToPercent(pct);
        });

        const unsubPlayPause = sync.events.on('playPause', (payload) => {
            const p = playerRef.current;
            if (!p) return;
            const localWantsPlayback =
                (typeof p?.intent?.getWanted === 'function' ? !!p.intent.getWanted() : true) &&
                !partyOptOutRef.current;

            if (!payload.isPlaying) {
                remotePauseUntilRef.current = Date.now() + 1200;
                if (p.isPlaying && typeof p.pausePlayback === 'function') void p.pausePlayback();
                return;
            }
            remotePauseUntilRef.current = 0;
            if (!localWantsPlayback) return;
            if (!p.isPlaying && typeof p.resumePlayback === 'function') void p.resumePlayback();
        });

        return () => { unsubSeek(); unsubPlayPause(); };
    }, [party?.sync, party?.isHost]);

    // ── Host: send state on track/isPlaying change ──
    const lastSentTrackIdRef = useRef(null);
    const lastSentIsPlayingRef = useRef(null);

    useEffect(() => {
        if (!partyHostCanPublish) return;
        if (!currentTrack?.id) return;

        const trackId = String(currentTrack.id);
        const isPlaying = Boolean(player.isPlaying);
        const trackChanged = lastSentTrackIdRef.current !== trackId;
        const playStateChanged = lastSentIsPlayingRef.current !== isPlaying;

        if (!trackChanged && !playStateChanged) return;

        lastSentTrackIdRef.current = trackId;
        lastSentIsPlayingRef.current = isPlaying;

        const payload = {
            trackId: currentTrack.id,
            trackTitle: currentTrack.title,
            trackArtist: currentTrack.artist,
            trackCover: currentTrackCover,
            isPlaying,
            position: getPosSec(),
        };

        if (partyUpdatePlayback) partyUpdatePlayback(payload);
    }, [partyHostCanPublish, partyUpdatePlayback, currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrackCover, player.isPlaying, getPosSec]);

    // ── Host: periodic position heartbeat ──
    useEffect(() => {
        if (!partyHostCanPublish) return;
        if (!currentTrack?.id || !player.isPlaying) return;

        const tId = window.setInterval(() => {
            const pr = partyRef.current;
            if (!pr?.updatePlayback) return;
            pr.updatePlayback({ position: getPosSec(), isPlaying: true });
        }, HOST_POSITION_HEARTBEAT_MS);

        return () => window.clearInterval(tId);
    }, [partyHostCanPublish, currentTrack?.id, player.isPlaying, getPosSec]);

    // ── Enter party mode when WS connects ──
    useEffect(() => {
        if (!party?.isConnected || !activePartyId) return;

        const pid = String(activePartyId);
        const needsInit = !partyMode || String(partyInfo?.partyId || '') !== pid;
        if (!needsInit) return;

        cbRef.current.enterPartyMode(pid, party.isHost);

        if (typeof cbRef.current.onEnterParty === 'function') {
            cbRef.current.onEnterParty({ partyId: pid, isHost: !!party.isHost });
        }
        if (party.isHost && typeof cbRef.current.onHostNeedsInviteCode === 'function') {
            cbRef.current.onHostNeedsInviteCode(pid);
        }
    }, [party?.isConnected, party?.isHost, activePartyId, partyMode, partyInfo?.partyId]);

    const effectivePartyId = useMemo(() => {
        return activePartyId || partyInfo?.partyId || party?.party?.id || null;
    }, [activePartyId, partyInfo?.partyId, party?.party?.id]);

    return { party, effectivePartyId };
};
