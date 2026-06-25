import Foundation

struct CookiePresenceDiagnostic: Sendable, Equatable {
    let present: Bool
    let domain: String?
}

struct AuthDiagnosticsSnapshot: Sendable, Equatable {
    var gatewayReachable: Bool
    var authEndpointReachable: Bool
    var lastAuthStatusCode: Int?
    var lastAuthPath: String?
    var hasMpSid: Bool
    var mpSidDomain: String?
    var hasMpCsrf: Bool
    var mpCsrfDomain: String?
    var proofTokenActive: Bool
    var authState: AuthState
    var lastErrorProjection: AuthErrorProjection?
    var profileUserId: Int?
    var profileFromGateway: Bool
    var mfaEnabled: Bool
    var mfaStepUpActive: Bool
    var lastUpdated: Date

    static let initial = AuthDiagnosticsSnapshot(
        gatewayReachable: false,
        authEndpointReachable: false,
        lastAuthStatusCode: nil,
        lastAuthPath: nil,
        hasMpSid: false,
        mpSidDomain: nil,
        hasMpCsrf: false,
        mpCsrfDomain: nil,
        proofTokenActive: false,
        authState: .unknown,
        lastErrorProjection: nil,
        profileUserId: nil,
        profileFromGateway: false,
        mfaEnabled: false,
        mfaStepUpActive: false,
        lastUpdated: Date()
    )
}

/// Dev-safe auth probe state — never stores secrets.
actor AuthDiagnostics {
    static let shared = AuthDiagnostics()

    private var snapshot = AuthDiagnosticsSnapshot.initial
    private var continuations: [UUID: AsyncStream<AuthDiagnosticsSnapshot>.Continuation] = [:]

    func current() -> AuthDiagnosticsSnapshot { snapshot }

    func stream() -> AsyncStream<AuthDiagnosticsSnapshot> {
        AsyncStream { continuation in
            let id = UUID()
            continuation.yield(snapshot)
            continuations[id] = continuation
            continuation.onTermination = { _ in
                Task { await self.removeContinuation(id) }
            }
        }
    }

    func recordGatewayProbe(reachable: Bool) {
        snapshot.gatewayReachable = reachable
        snapshot.lastUpdated = Date()
        publish()
    }

    func recordAuthEndpointProbe(reachable: Bool, statusCode: Int?) {
        snapshot.authEndpointReachable = reachable
        if let statusCode { snapshot.lastAuthStatusCode = statusCode }
        snapshot.lastUpdated = Date()
        publish()
    }

    func recordAuthAttempt(path: String, statusCode: Int?, error: Error?) {
        snapshot.lastAuthPath = sanitizePath(path)
        snapshot.lastAuthStatusCode = statusCode
        if let error {
            snapshot.lastErrorProjection = AuthErrorProjection.from(error: error, path: path)
        }
        refreshCookieFlags()
        snapshot.lastUpdated = Date()
        publish()
    }

    func recordAuthState(_ state: AuthState) {
        snapshot.authState = state
        snapshot.lastUpdated = Date()
        publish()
    }

    func recordProfile(_ profile: UserProfile?, fromGateway: Bool) {
        snapshot.profileUserId = profile?.resolvedId
        snapshot.profileFromGateway = fromGateway
        snapshot.mfaEnabled = profile?.mfaEnabled == true
        snapshot.lastUpdated = Date()
        publish()
    }

    func recordMfaStepUp(active: Bool) {
        snapshot.mfaStepUpActive = active
        snapshot.lastUpdated = Date()
        publish()
    }

    func recordProofTokenActive(_ active: Bool) {
        snapshot.proofTokenActive = active
        snapshot.lastUpdated = Date()
        publish()
    }

    func recordErrorProjection(_ projection: AuthErrorProjection) {
        snapshot.lastErrorProjection = projection
        snapshot.lastUpdated = Date()
        publish()
    }

    func refreshFromEnvironment(
        authState: AuthState,
        proofTokenActive: Bool,
        profile: UserProfile?
    ) {
        snapshot.authState = authState
        snapshot.proofTokenActive = proofTokenActive
        if let profile {
            snapshot.profileUserId = profile.resolvedId
            snapshot.profileFromGateway = true
            snapshot.mfaEnabled = profile.mfaEnabled == true
        }
        refreshCookieFlags()
        snapshot.lastUpdated = Date()
        publish()
    }

    private func refreshCookieFlags() {
        let base = AppConfiguration.current.gatewayBaseURL
        let sid = SessionCookieStore.sidDiagnostic(for: base)
        let csrf = SessionCookieStore.csrfDiagnostic(for: base)
        snapshot.hasMpSid = sid.present
        snapshot.mpSidDomain = sid.domain
        snapshot.hasMpCsrf = csrf.present
        snapshot.mpCsrfDomain = csrf.domain
    }

    private func sanitizePath(_ path: String) -> String {
        let raw = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("http"), let url = URL(string: raw) {
            return url.path
        }
        if let q = raw.firstIndex(of: "?") {
            return String(raw[..<q])
        }
        return raw
    }

    private func publish() {
        for continuation in continuations.values {
            continuation.yield(snapshot)
        }
    }

    private func removeContinuation(_ id: UUID) {
        continuations.removeValue(forKey: id)
    }
}
