import AVFoundation
import Foundation

enum AVPlayerEngineError: Error, LocalizedError {
    case loadTimeout
    case itemFailed(String)
    case preflightFailed(String)

    var errorDescription: String? {
        switch self {
        case .loadTimeout:
            return "playback_load_timeout"
        case .itemFailed(let message):
            return message
        case .preflightFailed(let message):
            return message
        }
    }
}

/// Thin AVPlayer wrapper — single instance per `PlaybackActor`.
@MainActor
final class AVPlayerEngine: NSObject {
    private(set) var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var itemStatusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var loadContinuation: CheckedContinuation<Void, Error>?
    private var loadTimeoutTask: Task<Void, Never>?

    var onStatusChange: ((PlaybackState) -> Void)?
    var onProgress: ((PlaybackProgress) -> Void)?

    private let loadTimeoutSeconds: TimeInterval = 40

    func load(url: URL, skipPreflight: Bool = false) async throws {
        try await withTaskCancellationHandler {
            try await loadUncancelled(url: url, skipPreflight: skipPreflight)
        } onCancel: {
            Task { @MainActor in
                self.releaseActivePlayer()
            }
        }
    }

    /// Fully release the active player (pause, drop item, remove observers, drop reference) so a new
    /// `load` never leaves the previous `AVPlayer`/`AVPlayerItem` (and its decode buffers) retained.
    private func releaseActivePlayer() {
        cancelLoadWait()
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        tearDownObservers()
        player = nil
    }

    private func loadUncancelled(url: URL, skipPreflight: Bool) async throws {
        releaseActivePlayer()

        let playbackURL = StreamURLResolver.nativePlaybackURL(url)
        try Task.checkCancellation()

        if !skipPreflight {
            // Early auth check with a clear message: AVPlayer's -12881/-11800 errors are opaque.
            let preflight = await HLSPlaybackPreflight.probe(masterURL: playbackURL)
            try Task.checkCancellation()
            guard preflight.errorMessage == nil, (200 ... 299).contains(preflight.statusCode) else {
                let detail = preflight.errorMessage ?? "http \(preflight.statusCode)"
                throw AVPlayerEngineError.preflightFailed(detail)
            }
        }

        try await loadWithNativeAsset(url: playbackURL)
        await EarflowLog.shared.info("playback", "engine ready path=\(playbackURL.path)")
    }

    func play() {
        guard let player else { return }
        player.play()
        // Playback state follows `timeControlStatus` KVO — do not optimistically emit `.playing`
        // here or UI/progress can run ahead of actual audio (especially after background/lock).
    }

    func pause() {
        player?.pause()
    }

    func seek(to seconds: Double) {
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        player?.seek(to: time)
        onStatusChange?(.seeking)
    }

    func stop() {
        releaseActivePlayer()
        onProgress?(.zero)
        onStatusChange?(.idle)
    }

    func currentProgress() -> PlaybackProgress {
        guard let player, let item = player.currentItem else { return .zero }
        let current = player.currentTime().seconds
        let duration = item.duration.seconds
        return PlaybackProgress(
            currentTime: current.isFinite ? max(0, current) : 0,
            duration: duration.isFinite && duration > 0 ? duration : 0
        )
    }

    /// Native HLS playback. AVPlayer fetches master + variants + segments itself; we only inject auth.
    /// `AVAssetResourceLoaderDelegate` cannot serve HLS segments (Apple returns -12881), so AVPlayer
    /// MUST own the network; we pass Origin/cookies via asset options instead.
    private func loadWithNativeAsset(url: URL) async throws {
        let asset = Self.makeAuthenticatedAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        // Cap forward buffering: default (0 = automatic) lets AVPlayer buffer arbitrarily far ahead
        // on a fast network, growing resident memory over long playback. 60s is ample for music.
        item.preferredForwardBufferDuration = 60

        player = AVPlayer(playerItem: item)
        player?.automaticallyWaitsToMinimizeStalling = true
        if #available(iOS 16.0, *) {
            player?.audiovisualBackgroundPlaybackPolicy = .continuesIfPossible
        }
        observeItem(item)
        observeTimeControlStatus()
        observeEnd(item)
        startTimeObserver()
        try await waitUntilReadyOrFailed()
    }

    /// `AVURLAssetHTTPHeaderFieldsKey` is undocumented but the de-facto standard for header injection;
    /// `AVURLAssetHTTPCookiesKey` is documented. Both apply to every request for the asset (segments incl.).
    nonisolated static func makeAuthenticatedAsset(url: URL) -> AVURLAsset {
        AVURLAsset(url: url, options: assetOptions(for: url))
    }

    /// Exposed for tests — header/cookie injection is the auth contract, not the AVURLAsset instance.
    nonisolated static func assetOptions(for url: URL) -> [String: Any] {
        var options: [String: Any] = [
            "AVURLAssetHTTPHeaderFieldsKey": StreamCookieHeaders.assetHeaderFields(for: url),
        ]
        let cookies = StreamCookieHeaders.playbackCookies(for: url)
        if !cookies.isEmpty {
            options[AVURLAssetHTTPCookiesKey] = cookies
        }
        return options
    }

    private func waitUntilReadyOrFailed() async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                loadContinuation = continuation
                loadTimeoutTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64((self?.loadTimeoutSeconds ?? 40) * 1_000_000_000))
                    guard let self, self.loadContinuation != nil else { return }
                    self.finishLoadWait(with: .failure(AVPlayerEngineError.loadTimeout))
                }
            }
        } onCancel: {
            Task { @MainActor in
                self.cancelLoadWait()
            }
        }
    }

    private func observeItem(_ item: AVPlayerItem) {
        itemStatusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                guard let self else { return }
                switch item.status {
                case .readyToPlay:
                    self.finishLoadWait(with: .success(()))
                    self.onStatusChange?(.ready)
                    self.emitProgress()
                case .failed:
                    let message = item.error?.localizedDescription ?? "avplayer_item_failed"
                    Task {
                        await EarflowLog.shared.error("playback", "avplayer failed: \(message)")
                    }
                    self.finishLoadWait(with: .failure(AVPlayerEngineError.itemFailed(message)))
                    self.onStatusChange?(.failed)
                default:
                    break
                }
            }
        }
    }

    private func observeTimeControlStatus() {
        guard let player else { return }
        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            Task { @MainActor in
                guard let self else { return }
                switch player.timeControlStatus {
                case .playing:
                    self.onStatusChange?(.playing)
                case .paused:
                    if player.currentItem?.status == .readyToPlay {
                        self.onStatusChange?(.paused)
                    }
                case .waitingToPlayAtSpecifiedRate:
                    if let reason = player.reasonForWaitingToPlay {
                        switch reason {
                        case .toMinimizeStalls, .evaluatingBufferingRate:
                            self.onStatusChange?(.buffering)
                        default:
                            break
                        }
                    } else {
                        self.onStatusChange?(.buffering)
                    }
                @unknown default:
                    break
                }
            }
        }
    }

    private func observeEnd(_ item: AVPlayerItem) {
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.onStatusChange?(.ended)
            }
        }
    }

    private func startTimeObserver() {
        guard let player else { return }
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.emitProgress()
            }
        }
    }

    private func emitProgress() {
        onProgress?(currentProgress())
    }

    private func finishLoadWait(with result: Result<Void, Error>) {
        loadTimeoutTask?.cancel()
        loadTimeoutTask = nil
        guard let continuation = loadContinuation else { return }
        loadContinuation = nil
        switch result {
        case .success:
            continuation.resume()
        case .failure(let error):
            continuation.resume(throwing: error)
        }
    }

    private func cancelLoadWait() {
        loadTimeoutTask?.cancel()
        loadTimeoutTask = nil
        if let continuation = loadContinuation {
            loadContinuation = nil
            continuation.resume(throwing: CancellationError())
        }
    }

    private func tearDownObservers() {
        itemStatusObservation = nil
        timeControlObservation = nil
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
    }
}
