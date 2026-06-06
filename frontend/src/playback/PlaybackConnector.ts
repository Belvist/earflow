import type {
  ApiClientLike,
  ConnectorState,
  NormalizedTrack,
  PlaybackProtocol,
  PlaybackSession,
  TrackLike,
} from "./types";
import { clamp01, clampPlaybackRate, normalizeTrack } from "./types";
import {
  DEFAULT_PROTOCOL_POLICY,
  type ProtocolPolicy,
  detectCapabilities,
  fallbackOrder,
  selectProtocol,
} from "./ProtocolPolicy";
import { HlsSession } from "./protocols/HlsSession";
import { DirectSession } from "./protocols/DirectSession";
import { isIosSafari } from "../utils/platform";

export type ConnectorEvents = {
  state: (_state: ConnectorState) => void;
  protocol: (_protocol: PlaybackProtocol | null) => void;
  track: (_track: NormalizedTrack | null) => void;
  time: (_seconds: number) => void;
  duration: (_seconds: number) => void;
  error: (_error: Error) => void;
};

export class PlaybackConnector {
  private readonly apiClient: ApiClientLike;
  private readonly audio: HTMLAudioElement;
  private readonly destinationNode?: AudioNode;
  private readonly getDestinationNode?: () => AudioNode | undefined;
  private readonly getQualityPreference?: () => string;
  private readonly caps = detectCapabilities();
  private policy: ProtocolPolicy;

  private readonly loadTimeoutMs: number;
  private readonly startTimeoutMs: number;

  private session: PlaybackSession | null = null;
  private state: ConnectorState = "idle";
  private protocol: PlaybackProtocol | null = null;
  private track: NormalizedTrack | null = null;
  private lastEndedTrackId: string | null = null;

  private volume = 1;
  private rate = 1;

  private controller: AbortController | null = null;

  private operationController: AbortController | null = null;

  private operationNonce = 0;
  private sessionNonce = 0;

  private seekingUntilMs = 0;

  private preloadedSession: PlaybackSession | null = null;
  private preloadController: AbortController | null = null;

  private scheduleBgSeekStartCheck(
    session: PlaybackSession,
    opNonceSnapshot: number,
  ): void {
    if (!this.isBackground()) return;
    if (!isIosSafari()) return;
    if (this.session !== session) return;
    if (!this.isActiveOperation(opNonceSnapshot)) return;
    if (
      typeof window === "undefined" ||
      typeof window.setTimeout !== "function"
    )
      return;

    const startedAt = Date.now();
    const poll = () => {
      if (!this.isActiveOperation(opNonceSnapshot)) return;
      if (this.session !== session) return;
      if (!this.isBackground()) return;

      if (session.isPlaying()) {
        if (
          this.state === "buffering" ||
          this.state === "seeking" ||
          this.state === "paused"
        ) {
          this.setState("playing");
        }
        return;
      }

      if (Date.now() - startedAt > 25_000) return;
      window.setTimeout(poll, 900);
    };

    window.setTimeout(poll, 650);
  }

  private readonly listeners = {
    state: [] as Array<ConnectorEvents["state"]>,
    protocol: [] as Array<ConnectorEvents["protocol"]>,
    track: [] as Array<ConnectorEvents["track"]>,
    time: [] as Array<ConnectorEvents["time"]>,
    duration: [] as Array<ConnectorEvents["duration"]>,
    error: [] as Array<ConnectorEvents["error"]>,
  };

  constructor(params: {
    apiClient: ApiClientLike;
    audio: HTMLAudioElement;
    destinationNode?: AudioNode;
    getDestinationNode?: () => AudioNode | undefined;
    getQualityPreference?: () => string;
    policy?: ProtocolPolicy;
    loadTimeoutMs?: number;
    startTimeoutMs?: number;
  }) {
    this.apiClient = params.apiClient;
    this.audio = params.audio;
    this.destinationNode = params.destinationNode;
    this.getDestinationNode = params.getDestinationNode;
    this.getQualityPreference = params.getQualityPreference;
    this.policy = params.policy || DEFAULT_PROTOCOL_POLICY;

    this.loadTimeoutMs =
      typeof params.loadTimeoutMs === "number" &&
        Number.isFinite(params.loadTimeoutMs)
        ? Math.max(1000, params.loadTimeoutMs)
        : 15_000;
    this.startTimeoutMs =
      typeof params.startTimeoutMs === "number" &&
        Number.isFinite(params.startTimeoutMs)
        ? Math.max(1000, params.startTimeoutMs)
        : 8_000;
  }

  setPolicy(policy: ProtocolPolicy): void {
    this.policy = policy;
  }

  on(_event: "state", _listener: ConnectorEvents["state"]): () => void;
  on(_event: "protocol", _listener: ConnectorEvents["protocol"]): () => void;
  on(_event: "track", _listener: ConnectorEvents["track"]): () => void;
  on(_event: "time", _listener: ConnectorEvents["time"]): () => void;
  on(_event: "duration", _listener: ConnectorEvents["duration"]): () => void;
  on(_event: "error", _listener: ConnectorEvents["error"]): () => void;
  on(
    event: keyof ConnectorEvents,
    listener: ConnectorEvents[keyof ConnectorEvents],
  ): () => void {
    const bucket = this.listeners[event] as Array<
      ConnectorEvents[keyof ConnectorEvents]
    >;
    bucket.push(listener);
    return () => {
      const idx = bucket.indexOf(listener);
      if (idx >= 0) bucket.splice(idx, 1);
    };
  }

  private emitState(value: ConnectorState): void {
    for (const fn of this.listeners.state.slice()) fn(value);
  }

  private emitProtocol(value: PlaybackProtocol | null): void {
    for (const fn of this.listeners.protocol.slice()) fn(value);
  }

  private emitTrack(value: NormalizedTrack | null): void {
    for (const fn of this.listeners.track.slice()) fn(value);
  }

  private emitTime(value: number): void {
    for (const fn of this.listeners.time.slice()) fn(value);
  }

  private emitDuration(value: number): void {
    for (const fn of this.listeners.duration.slice()) fn(value);
  }

  private emitError(value: Error): void {
    for (const fn of this.listeners.error.slice()) fn(value);
  }

  private asHttpStatus(e: unknown): number | null {
    if (!e || typeof e !== "object") return null;
    const st = (e as any).status;
    if (typeof st === "number" && Number.isFinite(st)) return st;
    const rs = (e as any).responseStatus;
    if (typeof rs === "number" && Number.isFinite(rs)) return rs;
    return null;
  }

  private setState(next: ConnectorState): void {
    if (this.state === next) return;
    this.state = next;
    this.emitState(next);
  }

  private setProtocol(next: PlaybackProtocol | null): void {
    if (this.protocol === next) return;
    this.protocol = next;
    this.emitProtocol(next);
  }

  private setTrack(next: NormalizedTrack | null): void {
    const same = this.track?.id && next?.id && this.track.id === next.id;
    if (same) return;
    this.track = next;
    this.lastEndedTrackId = null;
    this.emitTrack(next);
  }

  getState(): ConnectorState {
    return this.state;
  }

  getProtocol(): PlaybackProtocol | null {
    return this.protocol;
  }

  getTrack(): NormalizedTrack | null {
    return this.track;
  }

  getActiveTrackId(): string | null {
    const sid = this.session?.trackId;
    return sid ? String(sid) : null;
  }

  getLoudness(): { inputLufs: number | null; targetLufs: number } | null {
    return this.session?.getLoudness() ?? null;
  }

  getLastEndedTrackId(): string | null {
    const v = this.lastEndedTrackId;
    return v ? String(v) : null;
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    this.session?.setVolume(this.volume);
  }

  setPlaybackRate(rate: number): void {
    this.rate = clampPlaybackRate(rate);
    this.session?.setPlaybackRate(this.rate);
  }

  private startOperation(): { nonce: number; signal: AbortSignal } {
    const prev = this.operationController;
    this.operationController = new AbortController();
    const nonce = ++this.operationNonce;
    if (prev) {
      try {
        prev.abort();
      } catch { }
    }
    return { nonce, signal: this.operationController.signal };
  }

  private isActiveOperation(nonce: number): boolean {
    return this.operationNonce === nonce;
  }

  private isBackground(): boolean {
    try {
      return (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      );
    } catch {
      return false;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    if (!(typeof ms === "number" && Number.isFinite(ms) && ms > 0))
      return promise;

    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error("PLAYBACK_TIMEOUT")),
        ms,
      );
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId != null) {
        try {
          clearTimeout(timeoutId);
        } catch { }
      }
    }
  }

  private async waitForStart(
    session: PlaybackSession,
    opNonce: number,
    opSignal: AbortSignal,
    timeoutMs: number,
  ): Promise<void> {
    if (!this.isActiveOperation(opNonce)) return;
    if (this.session !== session) return;
    if (session.isPlaying()) return;
    if (opSignal.aborted) return;

    if (this.isBackground() && isIosSafari()) return;

    let timeoutId: number | null = null;
    let pollId: number | null = null;
    let done = false;

    await new Promise<void>((resolve, reject) => {
      const cleanup = (unsubs: Array<() => void>) => {
        if (done) return;
        done = true;
        for (const fn of unsubs) {
          try {
            fn();
          } catch { }
        }
        if (timeoutId != null) {
          try {
            clearTimeout(timeoutId);
          } catch { }
        }
        if (pollId != null) {
          try {
            clearInterval(pollId);
          } catch { }
        }
      };

      const unsubs: Array<() => void> = [];

      const abortHandler = () => {
        cleanup(unsubs);
        resolve();
      };

      try {
        opSignal.addEventListener("abort", abortHandler, { once: true });
        unsubs.push(() => {
          try {
            opSignal.removeEventListener("abort", abortHandler);
          } catch { }
        });
      } catch { }

      const finishOk = () => {
        cleanup(unsubs);
        resolve();
      };

      const finishErr = (e: unknown) => {
        cleanup(unsubs);
        reject(e instanceof Error ? e : new Error("PLAYBACK_FAILED"));
      };

      const isStillRelevant = () =>
        this.isActiveOperation(opNonce) &&
        this.session === session &&
        !opSignal.aborted;

      const startTime = Number(session.getCurrentTime());
      const hasStartTime = Number.isFinite(startTime) && startTime >= 0;
      const tryResolveByPolling = () => {
        if (!isStillRelevant()) return;
        if (!session.isPlaying()) return;
        const nowTime = Number(session.getCurrentTime());
        if (!Number.isFinite(nowTime) || nowTime < 0) return;
        if (!hasStartTime) {
          finishOk();
          return;
        }
        if (nowTime > startTime + 0.01) {
          finishOk();
        }
      };

      unsubs.push(
        session.on("time", () => {
          if (!isStillRelevant()) return;
          if (session.isPlaying()) finishOk();
        }),
        session.on("buffering", (b) => {
          if (!isStillRelevant()) return;
          if (!b && session.isPlaying()) finishOk();
        }),
        session.on("ended", () => {
          if (!isStillRelevant()) return;
          finishErr(new Error("ENDED"));
        }),
        session.on("error", (e) => {
          if (!isStillRelevant()) return;
          finishErr(e);
        }),
      );

      pollId = window.setInterval(tryResolveByPolling, 200);
      tryResolveByPolling();

      timeoutId = window.setTimeout(() => {
        if (!isStillRelevant()) return;
        finishErr(new Error("PLAYBACK_START_TIMEOUT"));
      }, timeoutMs);
    });
  }

  async play(
    input: TrackLike,
    options?: {
      startAtSeconds?: number;
      forceProtocol?: PlaybackProtocol;
      allowFallback?: boolean;
    },
  ): Promise<void> {
    const op = this.startOperation();
    const opNonce = op.nonce;
    const opSignal = op.signal;
    const track = normalizeTrack(input);
    if (!track.id) {
      this.fail(new Error("TRACK_ID_REQUIRED"));
      return;
    }

    const startAtSecondsRaw =
      options && typeof options === "object"
        ? (options as any).startAtSeconds
        : undefined;
    const startAtSecondsNum = Number(startAtSecondsRaw);
    const startAtSeconds =
      Number.isFinite(startAtSecondsNum) && startAtSecondsNum > 0
        ? startAtSecondsNum
        : null;

    this.abortActive();
    this.controller = new AbortController();
    const signal = this.controller.signal;

    await this.destroySession();
    if (!this.isActiveOperation(opNonce)) return;

    this.setTrack(track);
    this.setState("loading");

    this.setProtocol(null);

    const forceProtocol =
      options && typeof options === "object"
        ? (options as any).forceProtocol
        : null;
    const allowFallback =
      options &&
        typeof options === "object" &&
        typeof (options as any).allowFallback === "boolean"
        ? (options as any).allowFallback
        : true;

    const primary =
      forceProtocol === "hls" || forceProtocol === "direct"
        ? forceProtocol
        : selectProtocol(track, this.caps, this.policy);

    const rawPlan = allowFallback
      ? [primary, ...fallbackOrder(primary, track, this.caps, this.policy)]
      : [primary];

    const plan = rawPlan.length > 0 ? rawPlan : (["hls"] as PlaybackProtocol[]);

    for (const protocol of plan) {
      if (!this.isActiveOperation(opNonce)) return;
      if (signal.aborted) return;
      try {
        const preloaded = this.tryConsumePreloaded(track.id, protocol);
        const s = preloaded ?? this.createSession(protocol, track);
        this.session = s;
        const sessionNonce = ++this.sessionNonce;
        this.bindSession(s, sessionNonce);
        s.setVolume(this.volume);
        s.setPlaybackRate(this.rate);

        const bgLoadTimeoutMs =
          this.isBackground() && isIosSafari()
            ? Math.min(this.loadTimeoutMs, 12_000)
            : this.loadTimeoutMs;

        await this.withTimeout(s.load(signal), bgLoadTimeoutMs);
        if (!this.isActiveOperation(opNonce)) return;
        if (signal.aborted) return;

        if (startAtSeconds == null) {
          const t0 = Number(s.getCurrentTime());
          if (Number.isFinite(t0) && t0 > 0.01) {
            try {
              await s.seek(0);
            } catch { }
            if (!this.isActiveOperation(opNonce)) return;
            if (signal.aborted) return;
          }
        }

        if (startAtSeconds != null) {
          const dur = Number(s.getDuration());
          const safeStart =
            Number.isFinite(dur) && dur > 0
              ? Math.max(0, Math.min(startAtSeconds, Math.max(0, dur - 0.25)))
              : Math.max(0, startAtSeconds);
          try {
            await s.seek(safeStart);
          } catch { }
          if (!this.isActiveOperation(opNonce)) return;
          if (signal.aborted) return;
        }

        await this.withTimeout(s.play(), this.startTimeoutMs);
        if (!this.isActiveOperation(opNonce)) return;
        if (signal.aborted) return;

        const shouldBgResume = this.isBackground() && isIosSafari();
        if (shouldBgResume && !s.isPlaying()) {
          await s.play().catch(() => undefined);
        }

        this.setState(s.isPlaying() ? "playing" : "buffering");
        const startTimeoutMsBase = this.isBackground()
          ? Math.max(this.startTimeoutMs, 25_000)
          : this.startTimeoutMs;
        const startTimeoutMs =
          protocol === "direct"
            ? Math.max(startTimeoutMsBase, 20_000)
            : startTimeoutMsBase;
        await this.waitForStart(s, opNonce, opSignal, startTimeoutMs);
        if (!this.isActiveOperation(opNonce)) return;

        this.setProtocol(protocol);
        return;
      } catch (e) {
        if (!this.isActiveOperation(opNonce)) return;
        if (signal.aborted) return;
        const err = e instanceof Error ? e : new Error("PLAYBACK_FAILED");
        const st = this.asHttpStatus(e);
        const isLastProtocol = protocol === plan[plan.length - 1];
        if (st === 401 || st === 403) {
          await this.destroySession();
          if (protocol === "direct" && !isLastProtocol) {
            continue;
          }
          this.fail(err);
          return;
        }
        await this.destroySession();
        if (isLastProtocol) {
          this.fail(err);
          return;
        }
      }
    }
  }

  async pause(): Promise<void> {
    const s = this.session;
    if (!s) return;
    if (
      this.state === "paused" ||
      this.state === "idle" ||
      this.state === "ended"
    )
      return;
    await s.pause();
    if (this.session !== s) return;
    this.setState("paused");
  }

  async suspendOutput(): Promise<void> {
    const op = this.operationController;
    this.operationController = null;
    if (op) {
      try {
        op.abort();
      } catch { }
    }
    this.abortActive();
    const s = this.session;
    if (!s) {
      try {
        this.audio.pause();
      } catch { }
      return;
    }
    await s.pause().catch(() => undefined);
  }

  async resume(): Promise<void> {
    const op = this.startOperation();
    const opNonce = op.nonce;
    const opSignal = op.signal;
    const s = this.session;
    if (!s) {
      const t = this.track;
      if (t) {
        await this.play({
          id: t.id,
          durationSeconds: t.durationSeconds ?? undefined,
        });
      }
      return;
    }

    try {
      await this.withTimeout(s.play(), this.startTimeoutMs);
      if (!this.isActiveOperation(opNonce)) return;
      if (this.session === s) {
        this.setState(s.isPlaying() ? "playing" : "buffering");
        const startTimeoutMsBase = this.isBackground()
          ? Math.max(this.startTimeoutMs, 25_000)
          : this.startTimeoutMs;
        const startTimeoutMs =
          s.protocol === "direct"
            ? Math.max(startTimeoutMsBase, 20_000)
            : startTimeoutMsBase;
        await this.waitForStart(s, opNonce, opSignal, startTimeoutMs);
      }
    } catch (e) {
      if (!this.isActiveOperation(opNonce)) return;
      if (this.session !== s) return;
      const t = this.track;
      if (!t) {
        this.fail(e instanceof Error ? e : new Error("RESUME_FAILED"));
        return;
      }
      try {
        await this.play({
          id: t.id,
          durationSeconds: t.durationSeconds ?? undefined,
        });
      } catch (playErr) {
        if (!this.isActiveOperation(opNonce)) return;
        this.fail(
          playErr instanceof Error
            ? playErr
            : new Error("RESUME_REPLAY_FAILED"),
        );
      }
    }
  }

  async seek(seconds: number): Promise<void> {
    const s = this.session;
    if (!s) return;
    const prevState = this.state;
    const wasPlayingLike = prevState === "playing" || prevState === "buffering";
    const opNonceSnapshot = this.operationNonce;
    this.seekingUntilMs = Date.now() + 1500;
    this.setState("seeking");
    try {
      await s.seek(seconds);
      if (this.session !== s) return;
      const shouldBgResume =
        wasPlayingLike && this.isBackground() && isIosSafari();
      if (shouldBgResume && !s.isPlaying()) {
        await s.play().catch(() => undefined);
        if (this.session !== s) return;
        this.setState(s.isPlaying() ? "playing" : "buffering");
        this.scheduleBgSeekStartCheck(s, opNonceSnapshot);
        return;
      }
      this.setState(s.isPlaying() ? "playing" : "paused");
    } catch (e) {
      if (this.session !== s) return;
      const restored = wasPlayingLike && s.isPlaying();
      if (restored) {
        this.setState("playing");
      } else {
        this.setState(
          prevState === "seeking" ? "paused" : prevState || "paused",
        );
      }
    }
  }

  async stop(options?: { clearTrack?: boolean }): Promise<void> {
    const c = this.operationController;
    this.operationController = null;
    if (c) {
      try {
        c.abort();
      } catch { }
    }
    this.abortActive();
    await this.destroySession();
    this.setProtocol(null);
    if (options?.clearTrack === true) {
      this.setTrack(null);
    }
    this.lastEndedTrackId = null;
    this.setState("idle");
  }

  async hardReset(_reason?: string): Promise<void> {
    this.abortActive();
    await this.destroySession();
    this.setProtocol(null);
    this.setState("idle");
  }

  private createSession(
    protocol: PlaybackProtocol,
    track: NormalizedTrack,
  ): PlaybackSession {
    if (protocol === "hls") {
      return new HlsSession({
        trackId: track.id,
        apiClient: this.apiClient,
        audio: this.audio,
      });
    }

    if (protocol === "direct") {
      return new DirectSession({
        trackId: track.id,
        apiClient: this.apiClient,
        audio: this.audio,
        qualityPreference: (this.getQualityPreference?.() || "auto") as "auto",
      });
    }

    throw new Error("PROTOCOL_UNSUPPORTED");
  }

  private bindSession(session: PlaybackSession, sessionNonce: number): void {
    const isStillBound = () =>
      this.session === session && this.sessionNonce === sessionNonce;

    session.on("time", (t) => {
      if (!isStillBound()) return;
      this.emitTime(t);
    });
    session.on("duration", (d) => {
      if (!isStillBound()) return;
      this.emitDuration(d);
    });
    session.on("ended", () => {
      if (!isStillBound()) return;
      this.lastEndedTrackId = session.trackId ? String(session.trackId) : null;
      const now = Date.now();
      if (now < this.seekingUntilMs) {
        const d = Number(session.getDuration());
        const t = Number(session.getCurrentTime());
        const hasDuration =
          Number.isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY;
        const hasTime = Number.isFinite(t) && t >= 0;
        if (hasDuration && hasTime) {
          const nearEnd = t >= Math.max(0, d - 1);
          if (!nearEnd) {
            return;
          }
        } else {
          return;
        }
      }
      this.setState("ended");
    });
    session.on("buffering", (b) => {
      if (!isStillBound()) return;
      if (this.state === "playing" || this.state === "buffering") {
        this.setState(b ? "buffering" : "playing");
      }
    });
    session.on("error", (e) => {
      if (!isStillBound()) return;

      const isDirect = session.protocol === "direct";
      const track = this.track;
      const hasTrack = !!(track && typeof track.id === "string" && track.id);
      const msg =
        e && typeof (e as any).message === "string"
          ? String((e as any).message)
          : "";
      const st = this.asHttpStatus(e);
      const isFatalDirectError =
        msg.startsWith("DIRECT_") || st === 401 || st === 403;

      if (isDirect && hasTrack && isFatalDirectError) {
        const startAtSeconds = (() => {
          try {
            const t = Number(session.getCurrentTime());
            return Number.isFinite(t) && t > 0 ? t : 0;
          } catch {
            return 0;
          }
        })();

        this.setState("loading");
        this.setProtocol(null);

        const trackLike: TrackLike = {
          id: track.id,
          durationSeconds: track.durationSeconds ?? undefined,
        };

        void (async () => {
          await this.destroySession();
          await this.play(trackLike, {
            startAtSeconds,
            forceProtocol: "hls",
            allowFallback: false,
          }).catch((err) => {
            this.fail(
              err instanceof Error ? err : new Error("PLAYBACK_FAILED"),
            );
            this.destroySession().catch(() => undefined);
          });
        })();
        return;
      }

      this.fail(e);
      this.destroySession().catch(() => undefined);
    });
  }

  private fail(error: Error): void {
    this.setState("error");
    this.emitError(error);
  }

  private abortActive(): void {
    const c = this.controller;
    this.controller = null;
    if (!c) return;
    try {
      c.abort();
    } catch { }
  }

  private async destroySession(): Promise<void> {
    const s = this.session;
    this.session = null;
    if (!s) return;
    try {
      await s.destroy();
    } catch { }
  }

  preloadNextTrack(trackId: string, protocol: PlaybackProtocol): void {
    void trackId;
    void protocol;
    if (this.preloadController) {
      try {
        this.preloadController.abort();
      } catch { }
      this.preloadController = null;
    }
    if (this.preloadedSession) {
      void this.preloadedSession.destroy().catch(() => { });
      this.preloadedSession = null;
    }
    // Detached protocol preloading is intentionally disabled here. DirectSession
    // and HlsSession both own the live <audio> element, so preloading them can
    // replace the currently playing src and make UI/audio drift. Safe network
    // warming still happens via signed-session and byte-range prefetch callers.
  }

  private tryConsumePreloaded(
    trackId: string,
    protocol: PlaybackProtocol,
  ): PlaybackSession | null {
    const ps = this.preloadedSession;
    if (!ps) return null;
    if (ps.trackId !== trackId || ps.protocol !== protocol) {
      void ps.destroy().catch(() => { });
      this.preloadedSession = null;
      this.preloadController = null;
      return null;
    }
    this.preloadedSession = null;
    this.preloadController = null;
    return ps;
  }
}
