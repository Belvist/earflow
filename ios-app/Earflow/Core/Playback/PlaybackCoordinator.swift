import Combine
import Foundation

/// UI-facing playback facade — single owner for now-playing metadata, queue, sheet state.
@MainActor
final class PlaybackCoordinator: ObservableObject {
    @Published private(set) var state: PlaybackState = .idle
    @Published private(set) var nowPlaying: TrackItem?
    @Published private(set) var progress: PlaybackProgress = .zero
    @Published private(set) var playbackError: String?
    @Published private(set) var queue: [TrackItem] = []
    @Published private(set) var likedTrackIds: Set<Int> = []
    let playerSheet = PlayerSheetState()

    var sheetExpanded: Bool {
        get { playerSheet.isOpen || playerSheet.isModalVisible }
        set {
            if newValue {
                playerSheet.open()
            } else {
                playerSheet.finishClosed()
            }
        }
    }

    let coverAccent = CoverAccentStore()

    private let playback: PlaybackActor
    private var observationTask: Task<Void, Never>?
    private var progressTask: Task<Void, Never>?
    private var cancellables = Set<AnyCancellable>()
    private var lastPlayTrackId: Int?
    private var lastPlayStartedAt = Date.distantPast
    private var prefetchedTrackId: Int?

    init(playback: PlaybackActor) {
        self.playback = playback

        playerSheet.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        coverAccent.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        observationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for await next in await self.playback.stateStream() {
                self.state = next
                switch next {
                case .failed:
                    Task {
                        let detail = await self.playback.lastErrorMessage()
                        if self.playbackError == nil {
                            self.playbackError = detail ?? "Не удалось воспроизвести. Повторите через несколько секунд."
                        }
                    }
                case .revoked:
                    self.playbackError = nil
                    self.nowPlaying = nil
                    self.playerSheet.finishClosed()
                case .playing, .loadingSession, .loadingMedia:
                    self.playbackError = nil
                case .idle:
                    if self.nowPlaying == nil {
                        self.playbackError = nil
                    }
                case .ended:
                    Task { await self.advanceAfterEnd() }
                default:
                    break
                }
            }
        }
        progressTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for await tick in await self.playback.progressStream() {
                self.progress = self.resolvedProgress(tick)
                await self.maybePrefetchNextTrack()
            }
        }
    }

    deinit {
        observationTask?.cancel()
        progressTask?.cancel()
    }

    var displayDuration: Double {
        let trackSeconds = Double(nowPlaying?.duration ?? 0)
        if progress.duration > 0 { return progress.duration }
        if trackSeconds > 0 { return trackSeconds }
        return 0
    }

    var isCurrentTrackLiked: Bool {
        guard let id = nowPlaying?.id else { return false }
        return likedTrackIds.contains(id)
    }

    func setLikedTrackIds(_ ids: Set<Int>) {
        likedTrackIds = ids
    }

    func syncQueue(_ tracks: [TrackItem]) {
        var seen = Set<Int>()
        queue = tracks.filter { seen.insert($0.id).inserted }
    }

    func replaceQueue(_ tracks: [TrackItem], startAt track: TrackItem) async {
        syncQueue(tracks)
        await play(track, expandSheet: false)
    }

    /// Cold-start auto-resume — rebuilds the queue + now-playing track and continues from the saved
    /// position through the normal play pipeline (re-resolves a fresh HLS stream; never replays a
    /// persisted URL). `NowPlayingController` picks up the restored state automatically because it
    /// observes this coordinator. No-op if playback already started this launch.
    func restore(queue tracks: [TrackItem], current: TrackItem, position: Double) async {
        guard nowPlaying == nil, state == .idle, !tracks.isEmpty else { return }
        syncQueue(tracks)
        await play(current, startAt: position)
    }

    func play(_ track: TrackItem, expandSheet: Bool = false, startAt: Double = 0) async {
        guard NetworkMonitor.isReachable else {
            playbackError = "Нет интернета. Проверьте сеть и повторите."
            nowPlaying = track
            if queue.isEmpty || !queue.contains(where: { $0.id == track.id }) {
                queue = [track]
            }
            refreshAccent(for: track)
            state = .failed
            await EarflowLog.shared.warning("playback", "offline — play track \(track.id) blocked")
            return
        }

        let now = Date()
        if lastPlayTrackId == track.id,
           now.timeIntervalSince(lastPlayStartedAt) < 0.4,
           state == .playing || state == .buffering {
            if expandSheet { playerSheet.open() }
            return
        }
        lastPlayTrackId = track.id
        lastPlayStartedAt = now
        prefetchedTrackId = nil
        playbackError = nil
        nowPlaying = track
        if queue.isEmpty || !queue.contains(where: { $0.id == track.id }) {
            queue = [track]
        }
        refreshAccent(for: track)
        if expandSheet {
            playerSheet.open()
        }
        await EarflowLog.shared.info("playback", "play track \(track.id)")
        await playback.play(trackId: track.id, startAt: startAt)
    }

    func togglePlayPause() async {
        switch state {
        case .playing, .buffering:
            await playback.pause()
        case .paused, .ready:
            await playback.resume()
        case .idle, .ended, .failed:
            if let track = nowPlaying {
                await play(track)
            }
        default:
            break
        }
    }

    func playNext() async {
        guard let current = nowPlaying,
              let index = queue.firstIndex(where: { $0.id == current.id }),
              index + 1 < queue.count else { return }
        await play(queue[index + 1])
    }

    func playPrevious() async {
        guard let current = nowPlaying,
              let index = queue.firstIndex(where: { $0.id == current.id }) else { return }
        if progress.currentTime > 3, index == queue.firstIndex(where: { $0.id == current.id }) {
            await seek(to: 0)
            return
        }
        guard index > 0 else {
            await seek(to: 0)
            return
        }
        await play(queue[index - 1])
    }

    func pause() async {
        await playback.pause()
    }

    /// Re-start AVPlayer after a deferred `AVAudioSession` activation (cold-start / `!pux` retry).
    func retryPlaybackAfterAudioSessionRecovery() async {
        guard nowPlaying != nil else { return }
        switch state {
        case .playing, .buffering, .paused, .ready, .loadingMedia, .loadingSession:
            await playback.retryPendingEngineStartIfNeeded()
        default:
            break
        }
    }

    /// Lock screen / Control Center play — uses hard audio-session gate inside `PlaybackActor`.
    func resumeFromRemoteCommand() async {
        guard nowPlaying != nil else { return }
        switch state {
        case .playing, .buffering, .loadingSession, .loadingMedia:
            return
        case .idle, .ended, .failed:
            if let track = nowPlaying {
                await play(track)
            }
        default:
            await playback.resume()
        }
    }

    func hasPendingEngineStart() async -> Bool {
        await playback.hasPendingEngineStart()
    }

    /// Deprecated alias — use `retryPlaybackAfterAudioSessionRecovery`.
    func reassertPlaybackAfterAudioSessionRecovery() async {
        await retryPlaybackAfterAudioSessionRecovery()
    }

    func stop() async {
        await playback.stop()
        nowPlaying = nil
        progress = .zero
        queue = []
        playerSheet.finishClosed()
        coverAccent.update(coverURL: nil)
    }

    func seek(to seconds: Double) async {
        let duration = displayDuration
        guard duration > 0 else { return }
        let clamped = min(max(0, seconds), duration)
        await playback.seek(to: clamped)
    }

    func toggleLikeCurrent(catalog: CatalogService) async {
        guard let track = nowPlaying else { return }
        let id = track.id
        do {
            if likedTrackIds.contains(id) {
                try await catalog.unlikeTrack(id: id)
                likedTrackIds.remove(id)
            } else {
                try await catalog.likeTrack(id: id)
                likedTrackIds.insert(id)
            }
        } catch {
            await EarflowLog.shared.warning("playback", "like toggle failed: \(error)")
        }
    }

    private func advanceAfterEnd() async {
        await playNext()
    }

    private func refreshAccent(for track: TrackItem) {
        coverAccent.update(coverURL: MediaURLResolver.trackCover(track))
    }

    private func resolvedProgress(_ tick: PlaybackProgress) -> PlaybackProgress {
        let duration = tick.duration > 0 ? tick.duration : displayDuration
        return PlaybackProgress(currentTime: tick.currentTime, duration: duration)
    }

    private func maybePrefetchNextTrack() async {
        guard state == .playing || state == .buffering else { return }
        guard let current = nowPlaying,
              let index = queue.firstIndex(where: { $0.id == current.id }),
              index + 1 < queue.count else { return }
        let next = queue[index + 1]
        guard prefetchedTrackId != next.id else { return }
        let duration = displayDuration
        guard duration > 0 else { return }
        let remaining = duration - progress.currentTime
        guard remaining > 0, remaining < 30 else { return }
        prefetchedTrackId = next.id
        await playback.prefetchSession(trackId: next.id)
    }
}
