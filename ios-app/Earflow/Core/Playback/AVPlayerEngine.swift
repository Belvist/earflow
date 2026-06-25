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
    private var loadContinuation: CheckedContinuation<Void, Error>?
    private var loadTimeoutTask: Task<Void, Never>?
    private static var audioSessionConfigured = false

    var onStatusChange: ((PlaybackState) -> Void)?
    var onProgress: ((PlaybackProgress) -> Void)?

    private let loadTimeoutSeconds: TimeInterval = 40

    func load(url: URL) async throws {
        try await withTaskCancellationHandler {
            try await loadUncancelled(url: url)
        } onCancel: {
            Task { @MainActor in
                self.teardownForCancellation()
            }
        }
    }

    private func teardownForCancellation() {
        cancelLoadWait()
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        tearDownObservers()
        player = nil
    }

    private func loadUncancelled(url: URL) async throws {
        tearDownObservers()
        cancelLoadWait()

        let playbackURL = StreamURLResolver.nativePlaybackURL(url)
        try Task.checkCancellation()

        // Early auth check with a clear message: AVPlayer's -12881/-11800 errors are opaque.
        let preflight = await HLSPlaybackPreflight.probe(masterURL: playbackURL)
        try Task.checkCancellation()
        guard preflight.errorMessage == nil, (200 ... 299).contains(preflight.statusCode) else {
            let detail = preflight.errorMessage ?? "http \(preflight.statusCode)"
            throw AVPlayerEngineError.preflightFailed(detail)
        }

        try await loadWithNativeAsset(url: playbackURL)
        await EarflowLog.shared.info("playback", "engine ready path=\(playbackURL.path)")
    }

    func play() {
        guard let player else { return }
        player.play()
        onStatusChange?(.playing)
    }

    func pause() {
        player?.pause()
        onStatusChange?(.paused)
    }

    func seek(to seconds: Double) {
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        player?.seek(to: time)
        onStatusChange?(.seeking)
    }

    func stop() {
        teardownForCancellation()
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

    private func loadWithResourceLoader(url: URL) async throws {
        let loader = AuthenticatedStreamResourceLoader()
        resourceLoader = loader

        let customURL = AuthenticatedStreamResourceLoader.playbackURL(from: url)
        let asset = AVURLAsset(url: customURL)
        asset.resourceLoader.setDelegate(loader, queue: loader.loaderQueue)
        let item = AVPlayerItem(asset: asset)

        player = AVPlayer(playerItem: item)
        player?.automaticallyWaitsToMinimizeStalling = true
        configureAudioSessionOnce()
        observeItem(item)
        observeEnd(item)
        startTimeObserver()
        try await waitUntilReadyOrFailed()
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
                self.resourceLoader?.cancelAllTasks()
            }
        }
    }

    private func configureAudioSessionOnce() {
        guard !Self.audioSessionConfigured else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.allowAirPlay])
        try? session.setActive(true)
        Self.audioSessionConfigured = true
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
