import XCTest
@testable import Earflow

final class AuthErrorClassifierTests: XCTestCase {
    func testLogin401WithoutCodeIsAuthFailedUnknown() {
        let error = GatewayError.unauthorized(
            GatewayHTTPErrorDetail(status: 401, code: nil, message: "Неверный email или пароль", retryAfterSeconds: nil)
        )
        let projection = AuthErrorClassifier.project(for: error, path: "/api/auth/email/login")
        XCTAssertEqual(projection.category, .authFailedUnknown(status: 401))
        XCTAssertEqual(projection.provenance, .backendMessageOnly)
        XCTAssertNil(projection.backendCode)
    }

    func testInvalidCredentialsUsesBackendCode() {
        let error = GatewayError.unauthorized(
            GatewayHTTPErrorDetail(
                status: 401,
                code: "INVALID_CREDENTIALS",
                message: "Неверный email или пароль",
                retryAfterSeconds: nil
            )
        )
        let projection = AuthErrorClassifier.project(for: error, path: "/api/auth/email/login")
        XCTAssertEqual(projection.backendCode, "INVALID_CREDENTIALS")
        XCTAssertEqual(projection.category, .backend(code: "INVALID_CREDENTIALS"))
        XCTAssertEqual(projection.provenance, .backendContract)
        XCTAssertNotEqual(projection.category, AuthErrorCategory.authFailedUnknown(status: 401))
        XCTAssertEqual(AuthErrorClassifier.userMessage(for: error), "Неверный email или пароль.")
    }

    func testLoginRateLimitedWithRetryAfter() {
        let error = GatewayError.unauthorized(
            GatewayHTTPErrorDetail(
                status: 429,
                code: "LOGIN_RATE_LIMITED",
                message: "Слишком много неудачных попыток",
                retryAfterSeconds: 90
            )
        )
        let projection = AuthErrorClassifier.project(for: error)
        XCTAssertEqual(projection.backendCode, "LOGIN_RATE_LIMITED")
        XCTAssertEqual(projection.category, .rateLimited)
        XCTAssertEqual(AuthErrorClassifier.userMessage(for: error), "Слишком много попыток. Подождите 90 сек.")
    }

    func testMfaForbiddenUsesBackendCode() {
        let error = GatewayError.forbidden(
            GatewayHTTPErrorDetail(status: 403, code: "MFA_REQUIRED", message: "MFA_REQUIRED", retryAfterSeconds: nil)
        )
        let projection = AuthErrorClassifier.project(for: error)
        XCTAssertEqual(projection.backendCode, "MFA_REQUIRED")
        XCTAssertTrue(AuthErrorClassifier.shouldOpenMfaStepUp(projection))
    }

    func testMfaStepUpRequiredOpensStepUp() {
        let error = GatewayError.forbidden(
            GatewayHTTPErrorDetail(
                status: 403,
                code: "MFA_STEP_UP_REQUIRED",
                message: "Step-up required",
                retryAfterSeconds: nil
            )
        )
        let projection = AuthErrorClassifier.project(for: error)
        XCTAssertEqual(projection.backendCode, "MFA_STEP_UP_REQUIRED")
        XCTAssertTrue(AuthErrorClassifier.shouldOpenMfaStepUp(projection))
    }

    func testFreshLoginRequiredOpensStepUp() {
        let error = GatewayError.forbidden(
            GatewayHTTPErrorDetail(
                status: 403,
                code: "FRESH_LOGIN_REQUIRED",
                message: "Fresh login required",
                retryAfterSeconds: nil
            )
        )
        let projection = AuthErrorClassifier.project(for: error)
        XCTAssertEqual(projection.backendCode, "FRESH_LOGIN_REQUIRED")
        XCTAssertTrue(AuthErrorClassifier.shouldOpenMfaStepUp(projection))
    }

    func testGatewayCsrfIsBackendContract() {
        let error = GatewayError.forbidden(
            GatewayHTTPErrorDetail(status: 403, code: "CSRF_MISSING_ORIGIN", message: nil, retryAfterSeconds: nil)
        )
        let projection = AuthErrorClassifier.project(for: error)
        XCTAssertEqual(projection.provenance, .backendContract)
    }

    func testClientCookieMissingIsClientDiagnostic() {
        let error = GatewayError.network("session_not_established")
        let projection = AuthErrorClassifier.project(for: error)
        XCTAssertEqual(projection.category, .clientCookieMissing)
        XCTAssertEqual(projection.provenance, .clientDiagnostic)
    }

    func testNoSessionMapsToBackendCode() {
        let error = GatewayError.unauthorized(
            GatewayHTTPErrorDetail(status: 401, code: "NO_SESSION", message: "Authentication required", retryAfterSeconds: nil)
        )
        let projection = AuthErrorClassifier.project(for: error)
        XCTAssertEqual(projection.backendCode, "NO_SESSION")
    }

    func testValidationErrorUsesBackendContract() {
        let error = GatewayError.unauthorized(
            GatewayHTTPErrorDetail(
                status: 400,
                code: "VALIDATION_ERROR",
                message: "Email и пароль обязательны",
                retryAfterSeconds: nil
            )
        )
        let projection = AuthErrorClassifier.project(for: error, path: "/api/auth/email/register")
        XCTAssertEqual(projection.backendCode, "VALIDATION_ERROR")
        XCTAssertEqual(projection.category, .backend(code: "VALIDATION_ERROR"))
        XCTAssertEqual(projection.provenance, .backendContract)
        XCTAssertNotEqual(projection.category, .authFailedUnknown(status: 400))
        XCTAssertEqual(AuthErrorClassifier.userMessage(for: error), "Email и пароль обязательны")
    }

    func testEmailAlreadyRegisteredUsesBackendContract() {
        let error = GatewayError.unauthorized(
            GatewayHTTPErrorDetail(
                status: 400,
                code: "EMAIL_ALREADY_REGISTERED",
                message: "Email уже зарегистрирован",
                retryAfterSeconds: nil
            )
        )
        let projection = AuthErrorClassifier.project(for: error, path: "/api/auth/email/register")
        XCTAssertEqual(projection.backendCode, "EMAIL_ALREADY_REGISTERED")
        XCTAssertEqual(projection.category, .backend(code: "EMAIL_ALREADY_REGISTERED"))
        XCTAssertNotEqual(projection.backendCode, "INVALID_CREDENTIALS")
        XCTAssertEqual(AuthErrorClassifier.userMessage(for: error), "Этот email уже зарегистрирован.")
    }
}
