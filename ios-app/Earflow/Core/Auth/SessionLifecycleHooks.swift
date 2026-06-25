import Foundation

/// Cross-actor cleanup when auth session ends — mirrors web `earflow:auth:logout` listeners.
struct SessionLifecycleHooks: Sendable {
    var onSessionCleared: (@Sendable () async -> Void)?
}
