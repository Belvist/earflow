import Foundation

/// Mirrors `frontend/src/context/AuthContext.js` bootstrap / reauth policy (projection only).
enum AuthSessionPolicy {
    static func isTransientHTTPStatus(_ status: Int) -> Bool {
        if status == 0 || status == 403 || status == 408 || status == 429 { return true }
        return status >= 500 && status <= 599
    }

    static func isBackendReauthRequired(code: String?, reauthRequired: Bool) -> Bool {
        if reauthRequired { return true }
        guard let code else { return false }
        switch code {
        case BackendAuthCode.noSession,
             BackendAuthCode.sessionRevoked,
             "REFRESH_REVOKED",
             BackendAuthCode.deviceProofRequired,
             BackendAuthCode.deviceRevoked:
            return true
        default:
            return false
        }
    }

    static func isBackendRecoverable(code: String?, recoverable: Bool) -> Bool {
        if recoverable { return true }
        guard let code else { return false }
        switch code {
        case BackendAuthCode.authUnavailable,
             BackendAuthCode.csrfBadOrigin,
             BackendAuthCode.csrfInvalid,
             BackendAuthCode.csrfMissing,
             BackendAuthCode.csrfMissingOrigin,
             BackendAuthCode.sessionUnverified:
            return true
        default:
            return false
        }
    }

    static func hasResolvableUser(_ profile: UserProfile?) -> Bool {
        profile?.resolvedId != nil
    }
}

enum AuthBootstrapOutcome: Sendable, Equatable {
    case authenticated
    case degraded
    case guest
}

struct AuthBootstrapResult: Sendable, Equatable {
    let outcome: AuthBootstrapOutcome
    let profile: UserProfile?
    let diagnosticCode: String?
}

struct RefreshSessionResult: Sendable, Equatable {
    let ok: Bool
    let status: Int
    let code: String?
    let recoverable: Bool
    let reauthRequired: Bool
}
