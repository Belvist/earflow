import { PlayerEventEmitter } from './PlayerEventEmitter';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface PartyPlaybackState {
  readonly trackId: string | null;
  readonly trackTitle: string | null;
  readonly trackArtist: string | null;
  readonly trackCover: string | null;
  readonly trackDuration: number;
  readonly isPlaying: boolean;
  readonly position: number;
  readonly serverTimestamp: number;
  readonly stateRevision: number;
}

export interface PartyParticipant {
  readonly id: string;
  readonly username: string;
  readonly isHost: boolean;
  readonly joinedAt?: number;
}

export interface PartyPermissions {
  readonly guestsCanChangePlayback: boolean;
  readonly guestsCanAddToQueue: boolean;
  readonly guestsCanSkip: boolean;
  readonly guestsCanRemoveFromQueue: boolean;
}

export interface QueueItem {
  readonly queueId?: string;
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly cover: string | null;
  readonly duration: number;
  readonly addedBy: string;
  readonly addedByName: string;
}

export interface PartyMeta {
  readonly id: string;
  readonly title: string;
  readonly hostId: string;
  readonly hostName: string;
}

export interface PartySyncSnapshot {
  readonly connectionState: ConnectionState;
  readonly party: PartyMeta | null;
  readonly isHost: boolean;
  readonly userId: string | null;
  readonly playback: PartyPlaybackState;
  readonly participants: readonly PartyParticipant[];
  readonly participantCount: number;
  readonly queue: readonly QueueItem[];
  readonly permissions: PartyPermissions;
  readonly error: { message: string; code?: string } | null;
}

export type PartySyncEvents = {
  [key: string]: unknown;
  trackChange: { trackId: string; trackInfo: { title: string | null; artist: string | null; cover: string | null } };
  playPause: { isPlaying: boolean };
  seek: { position: number; serverTimestamp: number };
  playbackSync: { state: PartyPlaybackState; isHost: boolean };
  partyEnded: { reason: string };
  participantsUpdated: readonly PartyParticipant[];
  queueUpdated: readonly QueueItem[];
  reaction: { userId: string; username: string; type: string; timestamp: number };
  chat: { userId: string; username: string; message: string; timestamp: number };
  error: { message: string; code?: string };
};

const DEFAULT_PLAYBACK: PartyPlaybackState = {
  trackId: null,
  trackTitle: null,
  trackArtist: null,
  trackCover: null,
  trackDuration: 0,
  isPlaying: false,
  position: 0,
  serverTimestamp: 0,
  stateRevision: 0,
};

const DEFAULT_PERMISSIONS: PartyPermissions = {
  guestsCanChangePlayback: false,
  guestsCanAddToQueue: true,
  guestsCanSkip: false,
  guestsCanRemoveFromQueue: false,
};

const DEFAULTS: PartySyncSnapshot = {
  connectionState: 'disconnected',
  party: null,
  isHost: false,
  userId: null,
  playback: DEFAULT_PLAYBACK,
  participants: [],
  participantCount: 0,
  queue: [],
  permissions: DEFAULT_PERMISSIONS,
  error: null,
};

/**
 * @description Vanilla (non-React) store for party state.
 * Follows the same subscribe/getSnapshot pattern as PlayerStore.
 * Provides server-timestamp–based position interpolation.
 */
export class PartySync {
  private data: { -readonly [K in keyof PartySyncSnapshot]: PartySyncSnapshot[K] };
  private snapshot: PartySyncSnapshot;
  private readonly listeners = new Set<() => void>();
  readonly events = new PlayerEventEmitter<PartySyncEvents>();

  private serverClockOffset = 0;

  constructor() {
    this.data = { ...DEFAULTS, playback: { ...DEFAULT_PLAYBACK }, permissions: { ...DEFAULT_PERMISSIONS }, participants: [], queue: [] };
    this.snapshot = { ...this.data };
  }

  getSnapshot(): PartySyncSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * @description Interpolate current playback position using server-timestamp model.
   * Formula: position + (now - serverTimestamp) / 1000 * (isPlaying ? 1 : 0)
   */
  getInterpolatedPositionSec(): number {
    const pb = this.data.playback;
    if (!pb.isPlaying || pb.serverTimestamp === 0) {
      return pb.position;
    }
    const nowServer = Date.now() - this.serverClockOffset;
    const elapsed = Math.max(0, (nowServer - pb.serverTimestamp) / 1000);
    const pos = pb.position + elapsed;
    return pb.trackDuration > 0 ? Math.min(pos, pb.trackDuration) : pos;
  }

  /**
   * @description Calibrate server clock offset from a message containing serverTimestamp.
   * offset = localNow - serverTimestamp. Positive means local clock is ahead.
   */
  calibrateClock(serverTimestamp: number): void {
    if (serverTimestamp > 0) {
      this.serverClockOffset = Date.now() - serverTimestamp;
    }
  }

  patch(changes: Partial<PartySyncSnapshot>): void {
    let dirty = false;
    const keys = Object.keys(changes) as Array<keyof PartySyncSnapshot>;
    for (const k of keys) {
      const next = changes[k];
      if (this.data[k] !== next) {
        (this.data as Record<string, unknown>)[k] = next;
        dirty = true;
      }
    }
    if (!dirty) return;
    this.snapshot = { ...this.data };
    this.notify();
  }

  patchPlayback(changes: Partial<PartyPlaybackState>): void {
    let dirty = false;
    const prev = this.data.playback;
    const next = { ...prev };
    const keys = Object.keys(changes) as Array<keyof PartyPlaybackState>;
    for (const k of keys) {
      const v = changes[k];
      if ((prev as unknown as Record<string, unknown>)[k] !== v) {
        (next as unknown as Record<string, unknown>)[k] = v;
        dirty = true;
      }
    }
    if (!dirty) return;
    this.data.playback = next;
    this.snapshot = { ...this.data };
    this.notify();
  }

  /**
   * @description Apply a full playback state update from server.
   * Detects track changes, play/pause transitions, seeks, and emits typed events.
   */
  applyServerPlayback(incoming: Partial<PartyPlaybackState> & { serverTimestamp?: number }): void {
    const prev = this.data.playback;
    const ts = incoming.serverTimestamp ?? Date.now();

    if (ts > 0) {
      this.calibrateClock(ts);
    }

    const trackChanged = incoming.trackId !== undefined && incoming.trackId !== prev.trackId;
    const playPauseChanged = incoming.isPlaying !== undefined && incoming.isPlaying !== prev.isPlaying;

    const merged: PartyPlaybackState = {
      trackId: incoming.trackId ?? prev.trackId,
      trackTitle: incoming.trackTitle ?? prev.trackTitle,
      trackArtist: incoming.trackArtist ?? prev.trackArtist,
      trackCover: incoming.trackCover ?? prev.trackCover,
      trackDuration: incoming.trackDuration ?? prev.trackDuration,
      isPlaying: incoming.isPlaying ?? prev.isPlaying,
      position: incoming.position ?? prev.position,
      serverTimestamp: ts,
      stateRevision: incoming.stateRevision ?? prev.stateRevision,
    };

    this.data.playback = merged;
    this.snapshot = { ...this.data };
    this.notify();

    if (trackChanged && merged.trackId) {
      this.events.emit('trackChange', {
        trackId: merged.trackId,
        trackInfo: { title: merged.trackTitle, artist: merged.trackArtist, cover: merged.trackCover },
      });
    }

    if (playPauseChanged) {
      this.events.emit('playPause', { isPlaying: merged.isPlaying });
    }

    this.events.emit('playbackSync', { state: merged, isHost: this.data.isHost });
  }

  applySeek(position: number, serverTimestamp: number): void {
    this.calibrateClock(serverTimestamp);
    this.patchPlayback({ position, serverTimestamp });
    this.events.emit('seek', { position, serverTimestamp });
  }

  reset(): void {
    this.data = { ...DEFAULTS, playback: { ...DEFAULT_PLAYBACK }, permissions: { ...DEFAULT_PERMISSIONS }, participants: [], queue: [] };
    this.snapshot = { ...this.data };
    this.serverClockOffset = 0;
    this.notify();
  }

  destroy(): void {
    this.listeners.clear();
    this.events.destroy();
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch (e) {
        if (typeof queueMicrotask === 'function') { queueMicrotask(() => { throw e; }); }
      }
    }
  }
}
