import Foundation

// MARK: - Backend contract (Gateway / Auth Core — source of truth)

/// Mirror of stable `code` values from `backend/auth-service/lib/authErrorCodes.js` (SoT).
/// Gateway may add session/CSRF/device codes — listed here for iOS projection only.
/// iOS must not invent new platform auth codes — only map these + gaps in `PENDING.md`.
enum BackendAuthCode {
    // Gateway session / CSRF
    static let authUnavailable = "AUTH_UNAVAILABLE"
    static let csrfBadOrigin = "CSRF_BAD_ORIGIN"
    static let csrfInvalid = "CSRF_INVALID"
    static let csrfMissing = "CSRF_MISSING"
    static let csrfMissingOrigin = "CSRF_MISSING_ORIGIN"
    static let noSession = "NO_SESSION"
    static let sessionUnverified = "SESSION_UNVERIFIED"

    // Device proof (gateway middleware)
    static let deviceProofRequired = "DEVICE_PROOF_REQUIRED"
    static let deviceProofInvalid = "DEVICE_PROOF_INVALID"
    static let deviceProofExpired = "DEVICE_PROOF_EXPIRED"
    static let deviceProofReplay = "DEVICE_PROOF_REPLAY"
    static let deviceRevoked = "DEVICE_REVOKED"

    // MFA (auth-service / security-service)
    static let mfaRequired = "MFA_REQUIRED"
    static let mfaRequiredToSetPassword = "MFA_REQUIRED_TO_SET_PASSWORD"
    static let mfaStepUpRequired = "MFA_STEP_UP_REQUIRED"
    static let freshLoginRequired = "FRESH_LOGIN_REQUIRED"

    // Auth-service login/register
    static let invalidCredentials = "INVALID_CREDENTIALS"
    static let loginRateLimited = "LOGIN_RATE_LIMITED"
    static let sessionExpired = "SESSION_EXPIRED"
    static let sessionRevoked = "SESSION_REVOKED"
    static let rateLimited = "RATE_LIMITED"
    static let serverError = "SERVER_ERROR"
    static let validationError = "VALIDATION_ERROR"
    static let emailAlreadyRegistered = "EMAIL_ALREADY_REGISTERED"

    // Other documented upstream
    static let unauthorized = "UNAUTHORIZED"

    /// Machine codes promoted from JSON `error` when `code` is absent (legacy upstream).
    static let legacyMachineErrorFields: Set<String> = [
        mfaRequired,
        mfaRequiredToSetPassword,
    ]

    static func isCsrf(_ code: String) -> Bool {
        code.hasPrefix("CSRF_")
    }

    static func isDeviceProof(_ code: String) -> Bool {
        code.hasPrefix("DEVICE_PROOF_") || code == deviceRevoked
    }

    static func isMfa(_ code: String) -> Bool {
        code.contains("MFA") || code.contains("2FA")
    }

    /// Sensitive session action blocked until step-up (security-service) or fresh login (<24h).
    static func isStepUpRequired(_ code: String) -> Bool {
        code == mfaStepUpRequired || code == freshLoginRequired || isMfa(code)
    }

    static func isSessionExpired(_ code: String) -> Bool {
        code == noSession || code == sessionUnverified || code == sessionExpired
    }

    static func isRevoked(_ code: String) -> Bool {
        code == deviceRevoked || code == sessionRevoked
    }

    static func isInvalidCredentials(_ code: String) -> Bool {
        code == invalidCredentials
    }

    static func isLoginRateLimited(_ code: String) -> Bool {
        code == loginRateLimited || code == rateLimited
    }

    static func isValidationError(_ code: String) -> Bool {
        code == validationError
    }

    static func isEmailAlreadyRegistered(_ code: String) -> Bool {
        code == emailAlreadyRegistered
    }

    /// Normalize `code` or legacy machine `error` field — never infer from human text.
    static func normalize(rawCode: String?, message: String?) -> String? {
        if let rawCode, !rawCode.isEmpty {
            return rawCode.uppercased()
        }
        guard let message, !message.isEmpty else { return nil }
        let upper = message.uppercased()
        if legacyMachineErrorFields.contains(upper) || upper == rateLimited {
            return upper
        }
        return nil
    }
}

// MARK: - iOS projection (NOT platform SoT)

enum AuthErrorProvenance: String, Sendable, Equatable {
    /// JSON `code` field or documented machine code from backend `error`.
    case backendContract
    /// Only human `error` string — backend gap (no stable `code`).
    case backendMessageOnly
    /// iOS-local transport / cookie jar (not an auth decision).
    case clientDiagnostic
    /// URLSession / DNS / offline.
    case transport
}

/// UI/diagnostic grouping — derived from backend code, never replaces it.
enum AuthErrorCategory: Equatable, Sendable {
    case backend(code: String)
    case network
    case clientCookieMissing
    case rateLimited
    case authFailedUnknown(status: Int)
    case unknown

    var diagnosticKey: String {
        switch self {
        case .backend(let code): return "backend:\(code)"
        case .network: return "network"
        case .clientCookieMissing: return "client:cookie_missing"
        case .rateLimited: return "rate_limited"
        case .authFailedUnknown(let status): return "auth_failed_unknown:\(status)"
        case .unknown: return "unknown"
        }
    }
}

struct AuthErrorProjection: Equatable, Sendable {
    let httpStatus: Int?
    let backendCode: String?
    let backendMessage: String?
    let retryAfterSeconds: Int?
    let category: AuthErrorCategory
    let provenance: AuthErrorProvenance

    static func from(error: Error, path: String? = nil) -> AuthErrorProjection {
        if let gateway = error as? GatewayError {
            return from(gateway: gateway, path: path)
        }
        if error is CancellationError {
            return AuthErrorProjection(
                httpStatus: nil,
                backendCode: nil,
                backendMessage: nil,
                retryAfterSeconds: nil,
                category: .unknown,
                provenance: .transport
            )
        }
        return AuthErrorProjection(
            httpStatus: nil,
            backendCode: nil,
            backendMessage: error.localizedDescription,
            retryAfterSeconds: nil,
            category: .network,
            provenance: .transport
        )
    }

    static func from(gateway: GatewayError, path: String? = nil) -> AuthErrorProjection {
        switch gateway {
        case .unauthorized(let detail), .forbidden(let detail):
            return projectHTTP(
                status: detail.status,
                rawCode: detail.code,
                message: detail.message,
                retryAfterSeconds: detail.retryAfterSeconds,
                path: path
            )
        case .rateLimited:
            return AuthErrorProjection(
                httpStatus: 429,
                backendCode: BackendAuthCode.rateLimited,
                backendMessage: nil,
                retryAfterSeconds: nil,
                category: .rateLimited,
                provenance: .backendContract
            )
        case .serverError(let detail):
            return AuthErrorProjection(
                httpStatus: detail.status,
                backendCode: detail.code ?? BackendAuthCode.serverError,
                backendMessage: detail.message,
                retryAfterSeconds: detail.retryAfterSeconds,
                category: .unknown,
                provenance: .backendContract
            )
        case .network(let msg):
            if msg.contains("session_not_established") {
                return AuthErrorProjection(
                    httpStatus: nil,
                    backendCode: nil,
                    backendMessage: nil,
                    retryAfterSeconds: nil,
                    category: .clientCookieMissing,
                    provenance: .clientDiagnostic
                )
            }
            return AuthErrorProjection(
                httpStatus: nil,
                backendCode: nil,
                backendMessage: msg,
                retryAfterSeconds: nil,
                category: .network,
                provenance: .transport
            )
        case .decodingFailed, .cancelled, .invalidURL, .blockedHost,
             .directInternalServiceForbidden, .maxRetriesExceeded:
            return AuthErrorProjection(
                httpStatus: nil,
                backendCode: nil,
                backendMessage: nil,
                retryAfterSeconds: nil,
                category: .unknown,
                provenance: .transport
            )
        }
    }

    private static func projectHTTP(
        status: Int,
        rawCode: String?,
        message: String?,
        retryAfterSeconds: Int?,
        path: String?
    ) -> AuthErrorProjection {
        let normalizedCode = BackendAuthCode.normalize(rawCode: rawCode, message: message)

        if let normalizedCode {
            let category: AuthErrorCategory
            if BackendAuthCode.isLoginRateLimited(normalizedCode) {
                category = .rateLimited
            } else {
                category = .backend(code: normalizedCode)
            }
            return AuthErrorProjection(
                httpStatus: status,
                backendCode: normalizedCode,
                backendMessage: message,
                retryAfterSeconds: retryAfterSeconds,
                category: category,
                provenance: rawCode != nil ? .backendContract : .backendMessageOnly
            )
        }

        if status == 401 || status == 403 {
            return AuthErrorProjection(
                httpStatus: status,
                backendCode: nil,
                backendMessage: message,
                retryAfterSeconds: retryAfterSeconds,
                category: .authFailedUnknown(status: status),
                provenance: message != nil ? .backendMessageOnly : .backendContract
            )
        }

        if status == 429 {
            return AuthErrorProjection(
                httpStatus: status,
                backendCode: nil,
                backendMessage: message,
                retryAfterSeconds: retryAfterSeconds,
                category: .rateLimited,
                provenance: .backendMessageOnly
            )
        }

        return AuthErrorProjection(
            httpStatus: status,
            backendCode: nil,
            backendMessage: message,
            retryAfterSeconds: retryAfterSeconds,
            category: .unknown,
            provenance: .backendMessageOnly
        )
    }
}

enum AuthErrorClassifier {
    static func project(for error: Error, path: String? = nil) -> AuthErrorProjection {
        AuthErrorProjection.from(error: error, path: path)
    }

    static func userMessage(for error: Error, path: String? = nil) -> String {
        let projection = project(for: error, path: path)

        if projection.provenance == .clientDiagnostic,
           case .clientCookieMissing = projection.category {
            return "Сессия не сохранилась после входа (mp_sid). Попробуйте «Войти как на сайте»."
        }

        if let code = projection.backendCode {
            if BackendAuthCode.isInvalidCredentials(code) {
                return "Неверный email или пароль."
            }
            if BackendAuthCode.isEmailAlreadyRegistered(code) {
                return "Этот email уже зарегистрирован."
            }
            if BackendAuthCode.isValidationError(code) {
                if let backendMessage = projection.backendMessage, !backendMessage.isEmpty {
                    return backendMessage
                }
                return "Проверьте введённые данные."
            }
            if BackendAuthCode.isLoginRateLimited(code) {
                if let seconds = projection.retryAfterSeconds, seconds > 0 {
                    return "Слишком много попыток. Подождите \(seconds) сек."
                }
                return "Слишком много попыток. Подождите."
            }
            return messageForBackendCode(code)
        }

        if let backendMessage = projection.backendMessage, !backendMessage.isEmpty {
            return backendMessage
        }

        switch projection.category {
        case .authFailedUnknown:
            return "Не удалось войти. Проверьте данные или попробуйте позже."
        case .network:
            return networkMessage(for: error)
        case .rateLimited:
            return "Слишком много попыток. Подождите."
        case .unknown:
            return "Не удалось выполнить запрос. См. Auth Gate (dev)."
        default:
            return "Не удалось выполнить запрос."
        }
    }

    static func shouldOpenMfaStepUp(_ projection: AuthErrorProjection) -> Bool {
        guard let code = projection.backendCode else { return false }
        return BackendAuthCode.isStepUpRequired(code)
    }

    private static func messageForBackendCode(_ code: String) -> String {
        switch code {
        case BackendAuthCode.noSession, BackendAuthCode.sessionUnverified:
            return "Сессия истекла. Войдите снова."
        case BackendAuthCode.deviceRevoked:
            return "Устройство отозвано. Войдите снова."
        case BackendAuthCode.deviceProofRequired, BackendAuthCode.deviceProofInvalid,
             BackendAuthCode.deviceProofExpired, BackendAuthCode.deviceProofReplay:
            return "Требуется подтверждение устройства."
        case BackendAuthCode.mfaRequired, BackendAuthCode.mfaRequiredToSetPassword,
             BackendAuthCode.mfaStepUpRequired:
            return "Требуется код двухфакторной аутентификации."
        case BackendAuthCode.freshLoginRequired:
            return "Нужен повторный вход или подтверждение 2FA для этого действия."
        case BackendAuthCode.csrfBadOrigin, BackendAuthCode.csrfMissingOrigin,
             BackendAuthCode.csrfMissing, BackendAuthCode.csrfInvalid:
            return "Ошибка безопасности сессии (CSRF)."
        case BackendAuthCode.authUnavailable:
            return "Сервис авторизации временно недоступен."
        case BackendAuthCode.validationError:
            return "Проверьте введённые данные."
        case BackendAuthCode.emailAlreadyRegistered:
            return "Этот email уже зарегистрирован."
        case BackendAuthCode.rateLimited:
            return "Слишком много попыток. Подождите."
        default:
            return "Ошибка авторизации (\(code))."
        }
    }

    private static func networkMessage(for error: Error) -> String {
        guard let gateway = error as? GatewayError, case .network(let msg) = gateway else {
            return "Нет связи с api.earflow.ru."
        }
        switch msg {
        case GatewayNetworkCode.dnsLookupFailed.rawValue:
            return "Не удалось найти api.earflow.ru (DNS). Проверьте сеть."
        case GatewayNetworkCode.offline.rawValue:
            return "Нет интернета."
        case GatewayNetworkCode.connectionLost.rawValue:
            return "Соединение оборвалось. Повторите через несколько секунд."
        case GatewayNetworkCode.timeout.rawValue:
            return "Таймаут подключения к api.earflow.ru."
        case GatewayNetworkCode.tlsHandshakeFailed.rawValue:
            return "Не удалось установить защищённое соединение. Повторите запрос."
        default:
            return "Нет связи с api.earflow.ru."
        }
    }
}
