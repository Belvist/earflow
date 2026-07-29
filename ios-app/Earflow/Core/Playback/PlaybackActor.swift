import Foundation

/// Single owner of playback commands and AVPlayer lifecycle.
actor PlaybackActor {
    private let gateway: GatewayClient
    private let auth: AuthActor
    private let streamSessions: StreamSessionService
    private var state: PlaybackState = .idle
    private var progress: PlaybackProgress = .zero
    private var stateContinuations: [UUID: AsyncStream<PlaybackState>.Continuation] = [:]
    private var progressContinuations: [UUID: AsyncStream<PlaybackProgress>.Continuation] = [:]
    private var currentSession: PlaybackSessionRef?
    private var playTask: Task<Void, Never>?
    private var playGeneration: UInt64 = 0
    private var prefetchGeneration: UInt64 = 0
    private var storedPlaybackError: String?
    private var audioSessionPrepare: (@Sendable () async -> Bool)?
    private let engine = AVPlayerEngineBox()

    init(gateway: GatewayClient, auth: AuthActor, streamTickets: StreamTicketService) {
        self.gateway = gateway
        self.auth = auth
        streamSessions = StreamSessionService(gateway: gateway, streamTickets: streamTickets)
    }

    func stateStream() -> AsyncStream<PlaybackState> {
        AsyncStream { continuation in
            let id = UUID()
            continuation.yield(state)
            stateContinuations[id] = continuation
            continuation.onTermination = { _ in
                Task { await self.removeStateContinuation(id) }
            }
        }
    }

    /// Progress is latest-value semantics at ~2 Hz; `.bufferingNewest(1)` prevents unbounded buffer
    /// accumulation if the MainActor consumer ever lags, while always delivering the freshest tick.
    func progressStream() -> AsyncStream<PlaybackProgress> {
        AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let id = UUID()
            continuation.yield(progress)
            progressContinuations[id] = continuation
            continuation.onTermination = { _ in
                Task { await self.removeProgressContinuation(id) }
            }
        }
    }

    func currentProgress() -> PlaybackProgress { progress }

    func currentState() -> PlaybackState { state }
    func currentSessionRef() -> PlaybackSessionRef? { currentSession }
    func lastErrorMessage() -> String? { storedPlaybackError }

    /// Serialized play — generation guard; stop engine immediately on switch (no 40s wait).
    /// `startAt` (> 0 only on cold-start auto-resume) seeks to the saved position before audio
    /// begins, so playback continues from where it stopped without an audible jump from 0.
    func play(trackId: Int, startAt: Double = 0) async {
        if currentSession?.trackId == trackId,
           state == .playing || state == .buffering {
            return
        }
        playGeneration += 1
        prefetchGeneration += 1
        let generation = playGeneration
        playTask?.cancel()
        await engine.stop()
        let task = Task {
            await performPlay(trackId: trackId, generation: generation, allowSessionRetry: true, startAt: startAt)
        }
        playTask = task
        await task.value
    }

    func pause() async {
        await engine.pause()
        await transition(to: .paused)
    }

    func resume() async {
        await ensureAudioSessionForPlayback()
        await engine.play()
    }

    func stop() async {
        playTask?.cancel()
        prefetchGeneration += 1
        await engine.stop()
        currentSession = nil
        await setProgress(.zero)
        await transition(to: .idle)
    }

    func seek(to seconds: Double) async {
        let wasPlaying = state == .playing || state == .buffering
        await engine.seek(to: seconds)
        let tick = await engine.currentProgress()
        await setProgress(tick)
        if wasPlaying {
            await transition(to: .playing)
        } else if state != .idle && state != .failed && state != .revoked {
            await transition(to: .paused)
        }
    }

    func handleRevoked() async {
        playTask?.cancel()
        prefetchGeneration += 1
        await engine.stop()
        currentSession = nil
        await streamSessions.clearCache()
        await setProgress(.zero)
        await transition(to: .revoked)
    }

    func clearPlaybackCaches() async {
        await streamSessions.clearCache()
    }

    /// Prefetch next-track HLS session without rotating playback cookies.
    func prefetchSession(trackId: Int) async {
        let generation = prefetchGeneration
        await streamSessions.prefetchSession(trackId: trackId, generation: generation) { [self] gen in
            await self.isPrefetchGenerationCurrent(gen)
        }
    }

    private func isPrefetchGenerationCurrent(_ generation: UInt64) -> Bool {
        generation == prefetchGeneration
    }

    /// Injected by `AppDependencies` — `NowPlayingController.prepareAudioSessionForPlayback()`.
    func bindAudioSessionPrepare(_ prepare: @escaping @Sendable () async -> Bool) {
        audioSessionPrepare = prepare
    }

    // MARK: - Private

    private func removeStateContinuation(_ id: UUID) {
        stateContinuations.removeValue(forKey: id)
    }

    private func removeProgressContinuation(_ id: UUID) {
        progressContinuations.removeValue(forKey: id)
    }

    private func setProgress(_ next: PlaybackProgress) async {
        progress = next
        for c in progressContinuations.values { c.yield(next) }
    }

    private func transition(to newState: PlaybackState) async {
        state = newState
        for c in stateContinuations.values { c.yield(newState) }
    }

    private func performPlay(trackId: Int, generation: UInt64, allowSessionRetry: Bool, startAt: Double) async {
        guard isCurrentGeneration(generation) else { return }
        storedPlaybackError = nil
        await setProgress(.zero)
        await transition(to: .loadingSession)
        do {
            let session = try await streamSessions.createSession(trackId: trackId)
            guard isCurrentGeneration(generation) else { return }
            currentSession = session
            let cookies = SessionCookieStore.playbackCookieDiagnostic()
            let hasToken = URLComponents(url: session.masterURL, resolvingAgainstBaseURL: false)?
                .queryItems?
                .contains { $0.name == "token" && !($0.value ?? "").isEmpty } ?? false
            await EarflowLog.shared.info(
                "playback",
                "session ready track=\(trackId) mp_hls=\(cookies.mpHls.present) token=\(hasToken) path=\(session.masterURL.path)"
            )
            await transition(to: .loadingMedia)
            // Session POST already validated auth — skip the redundant HLS preflight GET to cut
            // one network round-trip per track switch (~hundreds of ms on mobile).
            try await engine.load(
                url: session.masterURL,
                skipPreflight: true,
                onState: { engineState in
                    Task { await self.onEngineState(engineState, generation: generation) }
                },
                onProgress: { tick in
                    Task { await self.applyProgress(tick, generation: generation) }
                }
            )
            guard isCurrentGeneration(generation) else { return }
            if startAt > 0 {
                await engine.seek(to: startAt) // resume from the persisted position before audio starts
            }
            await ensureAudioSessionForPlayback()
            await engine.play()
        } catch let error as GatewayError {
            guard isCurrentGeneration(generation) else { return }
            await EarflowLog.shared.error("playback", "track \(trackId): \(error)")
            storedPlaybackError = Self.message(for: error)
            if case .unauthorized = error {
                await handleRevoked()
            } else if case .forbidden = error {
                await handleRevoked()
            } else {
                await transition(to: .failed)
            }
        } catch is CancellationError {
            return
        } catch let error as AVPlayerEngineError {
            guard isCurrentGeneration(generation) else { return }
            if allowSessionRetry, Self.shouldRetryHLSSession(after: error) {
                await EarflowLog.shared.info("playback", "hls auth retry track=\(trackId)")
                await streamSessions.clearCache(for: trackId)
                await performPlay(trackId: trackId, generation: generation, allowSessionRetry: false, startAt: startAt)
                return
            }
            storedPlaybackError = Self.message(for: error)
            await EarflowLog.shared.error("playback", "track \(trackId): \(error.localizedDescription)")
            await transition(to: .failed)
        } catch {
            guard isCurrentGeneration(generation) else { return }
            storedPlaybackError = "Не удалось воспроизвести. Повторите через несколько секунд."
            await EarflowLog.shared.error("playback", "track \(trackId): \(error.localizedDescription)")
            await transition(to: .failed)
        }
    }

    private static func shouldRetryHLSSession(after error: AVPlayerEngineError) -> Bool {
        guard case .preflightFailed(let detail) = error else { return false }
        let lower = detail.lowercased()
        return lower.contains("401")
            || lower.contains("403")
            || lower.contains("unauthorized")
            || lower.contains("forbidden")
    }

    private func isCurrentGeneration(_ generation: UInt64) -> Bool {
        generation == playGeneration && !Task.isCancelled
    }

    private func ensureAudioSessionForPlayback() async {
        guard let prepare = audioSessionPrepare else { return }
        let active = await prepare()
        if !active {
            await EarflowLog.shared.warning("playback", "intent=session_activate result=inactive_before_play")
        }
    }

    private func applyProgress(_ tick: PlaybackProgress, generation: UInt64) async {
        guard isCurrentGeneration(generation) else { return }
        await setProgress(tick)
    }

    private static func message(for error: GatewayError) -> String {
        switch error {
        case .network, .maxRetriesExceeded:
            return "Нет связи с сервером. Проверьте интернет."
        case .unauthorized, .forbidden:
            return "Сессия истекла. Войдите снова."
        default:
            return "Не удалось воспроизвести. Повторите через несколько секунд."
        }
    }

    private static func message(for error: AVPlayerEngineError) -> String {
        switch error {
        case .loadTimeout:
            return "Таймаут загрузки. Повторите play."
        case .preflightFailed(let detail):
            if detail.contains("403") || detail.contains("forbidden") {
                return "Сервер отклонил поток. Нажмите play ещё раз."
            }
            if detail.contains("401") || detail.contains("unauthorized") {
                return "Сессия стрима истекла. Нажмите play ещё раз."
            }
            return "Не удалось открыть HLS: \(detail)"
        case .itemFailed:
            return "Плеер не смог загрузить поток. Нажмите play ещё раз."
        }
    }

    private func onEngineState(_ engineState: PlaybackState, generation: UInt64) async {
        guard isCurrentGeneration(generation) else { return }
        switch engineState {
        case .buffering:
            await transition(to: .buffering)
        case .paused:
            await transition(to: .paused)
        case .failed:
            await transition(to: .failed)
        case .seeking:
            await transition(to: .seeking)
        case .ended:
            await transition(to: .ended)
        case .ready:
            break
        case .playing:
            await transition(to: .playing)
        default:
            break
        }
    }
}

/// Bridges MainActor AVPlayerEngine to PlaybackActor.
private actor AVPlayerEngineBox {
    private let engine = AVPlayerEngine()

    func load(
        url: URL,
        skipPreflight: Bool = false,
        onState: @escaping @Sendable (PlaybackState) -> Void,
        onProgress: @escaping @Sendable (PlaybackProgress) -> Void
    ) async throws {
        try await MainActor.run {
            engine.onStatusChange = onState
            engine.onProgress = onProgress
        }
        try await engine.load(url: url, skipPreflight: skipPreflight)
    }

    func play() async {
        await MainActor.run { engine.play() }
    }

    func pause() async {
        await MainActor.run { engine.pause() }
    }

    func stop() async {
        await MainActor.run { engine.stop() }
    }

    func seek(to seconds: Double) async {
        await MainActor.run { engine.seek(to: seconds) }
    }

    func currentProgress() async -> PlaybackProgress {
        await MainActor.run { engine.currentProgress() }
    }
}
