import Foundation

enum AuthState: String, Sendable, Equatable {
    case unknown
    case unauthenticated
    case authenticating
    case authenticated
    case degraded
    case refreshing
    case expired
    case revoked
    case error
}

struct DeviceIdentity: Codable, Sendable, Equatable {
    let authDeviceId: String
    var sidHash: String
    let publicKeySpki: String
    /// PKCS#8 private key bytes stored in Keychain — never logged.
    let createdAt: Date

    var needsRegister: Bool { sidHash.isEmpty }
}

enum AnalyticsEventKind: String, Codable, Sendable {
    case playbackStarted = "playback_started"
    case playbackFirstByte = "playback_first_byte"
    case playbackPaused = "playback_paused"
    case playbackResumed = "playback_resumed"
    case playbackSeek = "playback_seek"
    case playback30s = "playback_30s"
    case playback60s = "playback_60s"
    case playbackCompleted = "playback_completed"
    case playbackSkipped = "playback_skipped"
    case playbackFailed = "playback_failed"
    case playbackRebuffer = "playback_rebuffer"
    case qualityChanged = "quality_changed"
}

struct AnalyticsEvent: Codable, Sendable, Equatable {
    let idempotencyKey: String
    let kind: AnalyticsEventKind
    let trackId: Int
    let playbackSessionId: String?
    let timestamp: Date
    let appVersion: String
    let networkType: String
    let playbackMode: String
    let reason: String?
    let errorCode: String?
    /// Never sent as trust source — backend resolves user from gateway session.
    let clientDeviceId: String?
}
