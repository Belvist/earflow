import Foundation

enum PlaybackState: String, Sendable, Equatable {
    case idle
    case loadingSession
    case loadingMedia
    case ready
    case playing
    case paused
    case buffering
    case seeking
    case ended
    case failed
    case revoked
}

struct PlaybackSessionRef: Sendable, Equatable {
    let playbackSessionId: String
    let trackId: Int
    let masterURL: URL
    let expiresAtMs: Int64?
}
