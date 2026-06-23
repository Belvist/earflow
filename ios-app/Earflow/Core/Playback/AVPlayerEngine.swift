import AVFoundation
import Foundation

/// Thin AVPlayer wrapper — single instance per `PlaybackActor`.
@MainActor
final class AVPlayerEngine: NSObject {
    private(set) var player: AVPlayer?
    private var timeObserver: Any?
    var onStatusChange: ((PlaybackState) -> Void)?

    func load(url: URL) {
        tearDownObserver()
        let item = AVPlayerItem(url: url)
        player = AVPlayer(playerItem: item)
        configureAudioSession()
        observeItem(item)
    }

    func play() {
        player?.play()
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
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        tearDownObserver()
        player = nil
        onStatusChange?(.idle)
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
    }

    private func observeItem(_ item: AVPlayerItem) {
        item.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                switch item.status {
                case .readyToPlay:
                    self?.onStatusChange?(.ready)
                case .failed:
                    self?.onStatusChange?(.failed)
                default:
                    break
                }
            }
        }
    }

    private func tearDownObserver() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
    }
}
