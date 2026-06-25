import Foundation

/// Web `buildHomeHeroTags` — desktop + mobile home v3.
enum HomeHeroTags {
    static func labels(for track: TrackItem, showReason: Bool) -> [String] {
        if showReason, let reason = track.reason?.trimmingCharacters(in: .whitespacesAndNewlines), !reason.isEmpty {
            let parts = reason
                .split(whereSeparator: { ",;|•".contains($0) })
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            if !parts.isEmpty {
                return Array(parts.prefix(3))
            }
        }
        return ["для тебя", "в очереди"]
    }
}
