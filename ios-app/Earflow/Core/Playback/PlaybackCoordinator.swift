import Combine
import Foundation

/// UI-facing playback facade — single owner for now-playing metadata + sheet state.
@MainActor
final class PlaybackCoordinator: ObservableObject {
    @Published private(set) var state: PlaybackState = .idle
    @Published private(set) var nowPlaying: TrackItem?
    @Published var sheetExpanded = false

    private let playback: PlaybackActor
    private var observationTask: Task<Void, Never>?

    init(playback: PlaybackActor) {
        self.playback = playback
        observationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for await next in await self.playback.stateStream() {
                self.state = next
            }
        }
    }

    deinit {
        observationTask?.cancel()
    }

    func play(_ track: TrackItem) async {
        nowPlaying = track
        sheetExpanded = true
        await EarflowLog.shared.info("playback", "play track \(track.id)")
        await playback.play(trackId: track.id)
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

    func pause() async {
        await playback.pause()
    }

    func stop() async {
        await playback.stop()
        nowPlaying = nil
        sheetExpanded = false
    }
}
