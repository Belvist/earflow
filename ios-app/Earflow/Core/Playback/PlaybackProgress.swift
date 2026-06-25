import Foundation

struct PlaybackProgress: Sendable, Equatable {
    var currentTime: Double = 0
    var duration: Double = 0

    static let zero = PlaybackProgress()

    var fraction: Double {
        guard duration.isFinite, duration > 0, currentTime.isFinite else { return 0 }
        return min(1, max(0, currentTime / duration))
    }
}

enum PlaybackTimeFormat {
    static func mmss(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let total = Int(seconds.rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
