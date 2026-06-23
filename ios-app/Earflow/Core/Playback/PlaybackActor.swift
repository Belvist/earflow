import Foundation

/// Single owner of playback commands and AVPlayer lifecycle.
actor PlaybackActor {
    private let gateway: GatewayClient
    private let auth: AuthActor
    private let streamSessions: StreamSessionService
    private var state: PlaybackState = .idle
    private var stateContinuations: [UUID: AsyncStream<PlaybackState>.Continuation] = [:]
    private var currentSession: PlaybackSessionRef?
    private var playTask: Task<Void, Never>?
    private let engine = AVPlayerEngineBox()

    init(gateway: GatewayClient, auth: AuthActor) {
        self.gateway = gateway
        self.auth = auth
        streamSessions = StreamSessionService(gateway: gateway)
    }

    func stateStream() -> AsyncStream<PlaybackState> {
        AsyncStream { continuation in
            let id = UUID()
            continuation.yield(state)
            stateContinuations[id] = continuation
            continuation.onTermination = { _ in
                Task { await self.removeContinuation(id) }
            }
        }
    }

    func currentState() -> PlaybackState { state }
    func currentSessionRef() -> PlaybackSessionRef? { currentSession }

    /// Serialized play — one session per user action, coalesced if already loading.
    func play(trackId: Int) async {
        playTask?.cancel()
        let task = Task {
            await performPlay(trackId: trackId)
        }
        playTask = task
        await task.value
    }

    func pause() async {
        await engine.pause()
        await transition(to: .paused)
    }

    func resume() async {
        await engine.play()
        await transition(to: .playing)
    }

    func stop() async {
        playTask?.cancel()
        await engine.stop()
        currentSession = nil
        await transition(to: .idle)
    }

    func handleRevoked() async {
        playTask?.cancel()
        await engine.stop()
        currentSession = nil
        await transition(to: .revoked)
    }

    // MARK: - Private

    private func removeContinuation(_ id: UUID) {
        stateContinuations.removeValue(forKey: id)
    }

    private func transition(to newState: PlaybackState) async {
        state = newState
        for c in stateContinuations.values { c.yield(newState) }
    }

    private func performPlay(trackId: Int) async {
        guard !Task.isCancelled else { return }
        await transition(to: .loadingSession)
        do {
            let session = try await streamSessions.createSession(trackId: trackId)
            guard !Task.isCancelled else { return }
            currentSession = session
            await transition(to: .loadingMedia)
            try await engine.load(url: session.masterURL) { engineState in
                Task { await self.onEngineState(engineState) }
            }
            guard !Task.isCancelled else { return }
            await engine.play()
            await transition(to: .playing)
        } catch let error as GatewayError {
            if case .unauthorized = error {
                await handleRevoked()
            } else if case .forbidden = error {
                await handleRevoked()
            } else {
                await transition(to: .failed)
            }
        } catch {
            await transition(to: .failed)
        }
    }

    private func onEngineState(_ engineState: PlaybackState) async {
        switch engineState {
        case .buffering:
            await transition(to: .buffering)
        case .paused:
            await transition(to: .paused)
        case .failed:
            await transition(to: .failed)
        case .seeking:
            await transition(to: .seeking)
        default:
            break
        }
    }
}

/// Bridges MainActor AVPlayerEngine to PlaybackActor.
private actor AVPlayerEngineBox {
    private let engine = AVPlayerEngine()

    func load(url: URL, onState: @escaping @Sendable (PlaybackState) -> Void) async throws {
        try await MainActor.run {
            engine.onStatusChange = onState
            engine.load(url: url)
        }
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
}
