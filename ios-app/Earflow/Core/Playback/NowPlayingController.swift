import AVFoundation
import Combine
import Foundation
import MediaPlayer
import UIKit

/// UIImage is effectively immutable here; safe to hand to MPMediaItemArtwork's @Sendable closure.
private struct ArtworkImageBox: @unchecked Sendable {
    let image: UIImage
}

/// Single owner of OS playback integration:
/// - `AVAudioSession` lifecycle (category + activation + interruptions + route changes)
/// - `MPNowPlayingInfoCenter` (lock screen / Control Center metadata)
/// - `MPRemoteCommandCenter` (play/pause/next/prev/seek from lock screen, AirPods, CarPlay)
///
/// Driven entirely by `PlaybackCoordinator` (the single UI source of truth). It never starts a
/// second playback path — it only reflects state and forwards remote intents back to the coordinator.
@MainActor
final class NowPlayingController {
    private let coordinator: PlaybackCoordinator
    private let session = AVAudioSession.sharedInstance()
    private let infoCenter = MPNowPlayingInfoCenter.default()
    private let commandCenter = MPRemoteCommandCenter.shared()

    private var cancellables = Set<AnyCancellable>()
    private var artworkTask: Task<Void, Never>?
    /// Bounded LRU-ish artwork cache. Unbounded growth here is a long-session OOM source:
    /// every distinct cover URL would otherwise retain a decoded `UIImage` for app lifetime.
    private var artworkCache: [URL: MPMediaItemArtwork] = [:]
    private var artworkCacheOrder: [URL] = []
    private let artworkCacheLimit = 16
    /// Lock-screen artwork never needs more than screen resolution; covers are served full-size,
    /// so downscale before retaining to cap per-entry memory.
    private static let artworkMaxDimension: CGFloat = 600
    private var currentArtwork: MPMediaItemArtwork?
    private var categoryConfigured = false
    private var sessionActive = false
    private var lastProgressPush = Date.distantPast
    private var loggedAudioSessionCategoryFailure = false
    private var pendingSessionActivation = false

    /// `AVAudioSessionErrorCodeCannotStartPlaying` (`!pux`) — `setActive(true)` while app is `.inactive`
    /// (launch transition before first `.active`, or transient resign-active).
    static let cannotStartPlayingCode = 561015905

    /// Whether `setActive(true)` must wait for a later lifecycle moment (cold-start / `!pux`).
    /// `.background` is allowed — lock screen and Control Center remote play run there with `UIBackgroundModes: audio`.
    nonisolated static func shouldDeferAudioSessionActivation(applicationState: UIApplication.State) -> Bool {
        applicationState == .inactive
    }

    /// Cookie-less session: cover art is public; never leak `mp_*` auth cookies to the image host.
    private let artworkSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.urlCache = URLCache(memoryCapacity: 16 * 1024 * 1024, diskCapacity: 64 * 1024 * 1024, directory: nil)
        config.timeoutIntervalForRequest = 15
        return URLSession(configuration: config)
    }()

    init(coordinator: PlaybackCoordinator) {
        self.coordinator = coordinator
        // Do NOT touch AVAudioSession here — configuring before the app/scene is `.active`
        // returns OSStatus -50 (paramErr) and breaks background playback for the whole session.
        registerRemoteCommands()
        observeSessionNotifications()
        observeCoordinator()
        pushNowPlayingInfo()
        updateCommandAvailability()
    }

    /// Must run immediately before `AVPlayer.play()` — returns whether the session is active.
    @discardableResult
    func prepareAudioSessionForPlayback() -> Bool {
        prepareAudioSessionForPlaybackResult() == .active
    }

    func prepareAudioSessionForPlaybackResult() -> AudioSessionPrepareResult {
        activateSession(force: true)
        if sessionActive { return .active }
        if pendingSessionActivation { return .deferred }
        return .failed
    }

    /// Retry activation after cold-start auto-resume once UIApplication is `.active`.
    func retryPendingAudioSessionActivationIfNeeded() async {
        guard pendingSessionActivation else { return }
        let shouldReassert = coordinator.nowPlaying != nil
            && coordinator.state != .idle
            && coordinator.state != .revoked
        activateSession(force: true)
        guard sessionActive, shouldReassert else { return }
        await EarflowLog.shared.info("playback", "intent=session_retry result=ok source=didBecomeActive")
        await coordinator.retryPlaybackAfterAudioSessionRecovery()
    }

    // MARK: - Coordinator observation

    private func observeCoordinator() {
        coordinator.$nowPlaying
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] track in
                MainActor.assumeIsolated { self?.onNowPlayingChanged(track) }
            }
            .store(in: &cancellables)

        coordinator.$state
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                MainActor.assumeIsolated { self?.onStateChanged(state) }
            }
            .store(in: &cancellables)

        coordinator.$progress
            .receive(on: DispatchQueue.main)
            .sink { [weak self] progress in
                MainActor.assumeIsolated { self?.onProgress(progress) }
            }
            .store(in: &cancellables)

        coordinator.$queue
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                MainActor.assumeIsolated { self?.updateCommandAvailability() }
            }
            .store(in: &cancellables)
    }

    private func onNowPlayingChanged(_ track: TrackItem?) {
        loadArtwork(for: track)
        pushNowPlayingInfo()
        updateCommandAvailability()
    }

    private func onStateChanged(_ state: PlaybackState) {
        switch state {
        case .loadingSession, .loadingMedia, .ready, .buffering, .seeking, .playing, .paused, .ended, .failed:
            activateSession()
        case .idle, .revoked:
            // Only tear down the audio session when playback is truly stopped (no track loaded).
            // Brief `.idle` during engine teardown on track switch must not deactivate — that
            // kills background audio and leaves progress ticking with no sound after lock screen.
            if coordinator.nowPlaying == nil {
                deactivateSession()
            }
        }
        pushNowPlayingInfo()
    }

    private func onProgress(_ progress: PlaybackProgress) {
        // Lock screen extrapolates elapsed time from playback rate; only refresh ~1/s to correct drift.
        guard Date().timeIntervalSince(lastProgressPush) >= 0.9 else { return }
        pushNowPlayingInfo()
    }

    // MARK: - Now Playing Info

    private func pushNowPlayingInfo() {
        guard let track = coordinator.nowPlaying else {
            infoCenter.nowPlayingInfo = nil
            return
        }
        var info = Self.makeNowPlayingInfo(
            track: track,
            elapsed: coordinator.progress.currentTime,
            duration: coordinator.displayDuration,
            isPlaying: coordinator.state == .playing
        )
        if let currentArtwork {
            info[MPMediaItemPropertyArtwork] = currentArtwork
        }
        infoCenter.nowPlayingInfo = info
        lastProgressPush = Date()
    }

    /// Pure builder — unit tested. Artwork is merged separately once it loads.
    nonisolated static func makeNowPlayingInfo(track: TrackItem, elapsed: Double, duration: Double, isPlaying: Bool) -> [String: Any] {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.displayTitle,
            MPMediaItemPropertyArtist: track.displayArtist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: max(0, elapsed),
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if let album = track.album?.trimmingCharacters(in: .whitespacesAndNewlines), !album.isEmpty {
            info[MPMediaItemPropertyAlbumTitle] = album
        }
        if duration.isFinite, duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        return info
    }

    private func loadArtwork(for track: TrackItem?) {
        artworkTask?.cancel()
        currentArtwork = nil
        guard let track, let url = MediaURLResolver.trackCover(track) else { return }

        if let cached = artworkCache[url] {
            currentArtwork = cached
            return
        }

        let trackId = track.id
        artworkTask = Task { [weak self] in
            guard let self else { return }
            guard let data = await self.fetchArtworkData(from: url),
                  let image = Self.makeArtworkImage(from: data) else { return }
            guard self.coordinator.nowPlaying?.id == trackId else { return }
            let box = ArtworkImageBox(image: image)
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in box.image }
            self.storeArtwork(artwork, for: url)
            self.currentArtwork = artwork
            self.pushNowPlayingInfo()
        }
    }

    /// Insert with bounded eviction (oldest-first) so a long listening session can't accumulate
    /// one retained cover per played track.
    private func storeArtwork(_ artwork: MPMediaItemArtwork, for url: URL) {
        if artworkCache[url] == nil {
            artworkCacheOrder.append(url)
            while artworkCacheOrder.count > artworkCacheLimit, let oldest = artworkCacheOrder.first {
                artworkCacheOrder.removeFirst()
                artworkCache.removeValue(forKey: oldest)
            }
        }
        artworkCache[url] = artwork
    }

    /// Decode and downscale cover art to `artworkMaxDimension`; full-resolution covers waste
    /// several MB each on the lock screen and compound across cached entries.
    nonisolated static func makeArtworkImage(from data: Data) -> UIImage? {
        guard let image = UIImage(data: data) else { return nil }
        let maxSide = max(image.size.width, image.size.height)
        guard maxSide > artworkMaxDimension, maxSide > 0 else { return image }
        let scale = artworkMaxDimension / maxSide
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    /// Off-actor fetch returning only `Data` (Sendable) — keeps non-Sendable `URLResponse` off the hop back.
    private nonisolated func fetchArtworkData(from url: URL) async -> Data? {
        guard let (data, _) = try? await artworkSession.data(from: url) else { return nil }
        return data
    }

    // MARK: - Remote commands

    private func registerRemoteCommands() {
        commandCenter.playCommand.removeTarget(nil)
        _ = commandCenter.playCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            return self.handleRemotePlayCommand()
        }

        commandCenter.pauseCommand.removeTarget(nil)
        _ = commandCenter.pauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            Task { @MainActor in await self.ensurePaused() }
            return .success
        }

        commandCenter.togglePlayPauseCommand.removeTarget(nil)
        _ = commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            switch self.coordinator.state {
            case .playing, .buffering:
                Task { @MainActor in await self.ensurePaused() }
                return .success
            default:
                return self.handleRemotePlayCommand()
            }
        }

        commandCenter.nextTrackCommand.removeTarget(nil)
        _ = commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            Task { @MainActor in await self.coordinator.playNext() }
            return .success
        }

        commandCenter.previousTrackCommand.removeTarget(nil)
        _ = commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            Task { @MainActor in await self.coordinator.playPrevious() }
            return .success
        }

        commandCenter.changePlaybackPositionCommand.removeTarget(nil)
        _ = commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self, let position = (event as? MPChangePlaybackPositionCommandEvent)?.positionTime else {
                return .commandFailed
            }
            Task { @MainActor in await self.coordinator.seek(to: position) }
            return .success
        }

        // Skip seek (±) and rating are not part of the product surface — keep them disabled.
        commandCenter.skipForwardCommand.isEnabled = false
        commandCenter.skipBackwardCommand.isEnabled = false
    }

    private func updateCommandAvailability() {
        let hasTrack = coordinator.nowPlaying != nil
        commandCenter.playCommand.isEnabled = hasTrack
        commandCenter.pauseCommand.isEnabled = hasTrack
        commandCenter.togglePlayPauseCommand.isEnabled = hasTrack
        commandCenter.changePlaybackPositionCommand.isEnabled = hasTrack
        commandCenter.previousTrackCommand.isEnabled = hasTrack
        commandCenter.nextTrackCommand.isEnabled = Self.hasNext(currentId: coordinator.nowPlaying?.id, queue: coordinator.queue)
    }

    nonisolated static func hasNext(currentId: Int?, queue: [TrackItem]) -> Bool {
        guard let currentId, let index = queue.firstIndex(where: { $0.id == currentId }) else { return false }
        return index + 1 < queue.count
    }

    private func handleRemotePlayCommand() -> MPRemoteCommandHandlerStatus {
        var status: MPRemoteCommandHandlerStatus = .commandFailed
        let semaphore = DispatchSemaphore(value: 0)
        Task { @MainActor [weak self] in
            guard let self else {
                semaphore.signal()
                return
            }
            status = await self.remotePlayOutcome()
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 8)
        return status
    }

    private func remotePlayOutcome() async -> MPRemoteCommandHandlerStatus {
        let prepareResult = prepareAudioSessionForPlaybackResult()
        switch prepareResult {
        case .failed:
            return .commandFailed
        case .deferred, .active:
            break
        }

        switch coordinator.state {
        case .playing, .buffering, .loadingMedia, .loadingSession:
            return .success
        default:
            await coordinator.resumeFromRemoteCommand()
        }

        let pending = await coordinator.hasPendingEngineStart()
        let outcome = RemotePlayCommandPolicy.handlerStatus(
            prepareResult: prepareResult,
            coordinatorState: coordinator.state,
            pendingEngineStart: pending
        )
        return outcome == .success ? .success : .commandFailed
    }

    private func ensurePlaying() async {
        _ = prepareAudioSessionForPlayback()
        switch coordinator.state {
        case .playing, .buffering, .loadingSession, .loadingMedia:
            return
        default:
            await coordinator.resumeFromRemoteCommand()
        }
    }

    private func ensurePaused() async {
        switch coordinator.state {
        case .playing, .buffering:
            await coordinator.pause()
        default:
            return
        }
    }

    // MARK: - AVAudioSession lifecycle (single owner)

    private func configureCategoryIfNeeded() {
        guard !categoryConfigured else { return }
        do {
            // `.playback` already routes to speaker/receiver/AirPlay — `.allowAirPlay` is not a
            // valid option here and returns OSStatus -50 (paramErr) on device.
            try session.setCategory(.playback, mode: .default)
            categoryConfigured = true
        } catch {
            logAudioSessionFailure(phase: "category", error: error)
        }
    }

    private func activateSession(force: Bool = false) {
        configureCategoryIfNeeded()
        guard categoryConfigured else { return }
        if !force, sessionActive { return }

        let appState = UIApplication.shared.applicationState
        if Self.shouldDeferAudioSessionActivation(applicationState: appState) {
            pendingSessionActivation = true
            logSessionActivation(intent: "activate", result: "deferred", appState: appState, reason: "inactive")
            return
        }

        do {
            try session.setActive(true)
            sessionActive = true
            pendingSessionActivation = false
            logSessionActivation(intent: "activate", result: "ok", appState: appState)
        } catch {
            let code = (error as NSError).code
            if code == Self.cannotStartPlayingCode {
                pendingSessionActivation = true
                logSessionActivation(intent: "activate", result: "deferred", appState: appState, reason: "cannot_start_playing", code: code)
                return
            }
            sessionActive = false
            logSessionActivation(intent: "activate", result: "fail", appState: appState, phase: "activate", code: code)
        }
    }

    private func logAudioSessionFailure(phase: String, error: Error) {
        guard phase == "category" else {
            let code = (error as NSError).code
            logSessionActivation(
                intent: "configure",
                result: "fail",
                appState: UIApplication.shared.applicationState,
                phase: phase,
                code: code
            )
            return
        }
        guard !loggedAudioSessionCategoryFailure else { return }
        loggedAudioSessionCategoryFailure = true
        let code = (error as NSError).code
        logSessionActivation(
            intent: "configure",
            result: "fail",
            appState: UIApplication.shared.applicationState,
            phase: phase,
            code: code
        )
    }

    private func logSessionActivation(
        intent: String,
        result: String,
        appState: UIApplication.State,
        reason: String? = nil,
        phase: String? = nil,
        code: Int? = nil
    ) {
        var parts = [
            "intent=session_\(intent)",
            "result=\(result)",
            "appState=\(Self.logAppState(appState))",
        ]
        if let reason { parts.append("reason=\(reason)") }
        if let phase { parts.append("phase=\(phase)") }
        if let code { parts.append("code=\(code)") }
        let message = parts.joined(separator: " ")
        Task {
            switch result {
            case "fail":
                await EarflowLog.shared.error("playback", message)
            case "deferred":
                await EarflowLog.shared.info("playback", message)
            default:
                await EarflowLog.shared.info("playback", message)
            }
        }
    }

    nonisolated static func logAppState(_ state: UIApplication.State) -> String {
        switch state {
        case .active: return "active"
        case .inactive: return "inactive"
        case .background: return "background"
        @unknown default: return "unknown"
        }
    }

    private func deactivateSession() {
        guard sessionActive else { return }
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
            sessionActive = false
            logSessionActivation(intent: "deactivate", result: "ok", appState: UIApplication.shared.applicationState)
        } catch {
            let code = (error as NSError).code
            logSessionActivation(
                intent: "deactivate",
                result: "fail",
                appState: UIApplication.shared.applicationState,
                phase: "deactivate",
                code: code
            )
        }
    }

    private func observeSessionNotifications() {
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: session,
            queue: .main
        ) { [weak self] note in
            guard let typeRaw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
            let optionsRaw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt
            Task { @MainActor in self?.handleInterruption(typeRaw: typeRaw, optionsRaw: optionsRaw) }
        }

        NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: session,
            queue: .main
        ) { [weak self] note in
            guard let reasonRaw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt else { return }
            Task { @MainActor in self?.handleRouteChange(reasonRaw: reasonRaw) }
        }
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in await self?.retryPendingAudioSessionActivationIfNeeded() }
        }
    }

    private func handleInterruption(typeRaw: UInt, optionsRaw: UInt?) {
        guard let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
        switch type {
        case .began:
            sessionActive = false // system has deactivated our session
            Task { await self.ensurePaused() }
        case .ended:
            guard let optionsRaw else { return }
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)
            if options.contains(.shouldResume) {
                let result = prepareAudioSessionForPlaybackResult()
                guard result != .failed else { return }
                Task { await self.ensurePlaying() }
            }
        @unknown default:
            break
        }
    }

    private func handleRouteChange(reasonRaw: UInt) {
        guard let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) else { return }
        // Headphones/Bluetooth removed → pause, matching Apple HIG (do not blast speakers).
        if reason == .oldDeviceUnavailable {
            Task { await self.ensurePaused() }
        }
    }
}
