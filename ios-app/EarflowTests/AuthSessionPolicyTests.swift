import XCTest
@testable import Earflow

final class AuthSessionPolicyTests: XCTestCase {
    func testTransientHTTPStatus() {
        XCTAssertTrue(AuthSessionPolicy.isTransientHTTPStatus(0))
        XCTAssertTrue(AuthSessionPolicy.isTransientHTTPStatus(500))
        XCTAssertTrue(AuthSessionPolicy.isTransientHTTPStatus(503))
        XCTAssertTrue(AuthSessionPolicy.isTransientHTTPStatus(429))
        XCTAssertFalse(AuthSessionPolicy.isTransientHTTPStatus(401))
        XCTAssertFalse(AuthSessionPolicy.isTransientHTTPStatus(200))
    }

    func testBackendReauthRequired() {
        XCTAssertTrue(AuthSessionPolicy.isBackendReauthRequired(code: BackendAuthCode.noSession, reauthRequired: false))
        XCTAssertTrue(AuthSessionPolicy.isBackendReauthRequired(code: nil, reauthRequired: true))
        XCTAssertFalse(AuthSessionPolicy.isBackendReauthRequired(code: BackendAuthCode.csrfMissing, reauthRequired: false))
    }

    func testBackendRecoverable() {
        XCTAssertTrue(AuthSessionPolicy.isBackendRecoverable(code: BackendAuthCode.authUnavailable, recoverable: false))
        XCTAssertTrue(AuthSessionPolicy.isBackendRecoverable(code: nil, recoverable: true))
        XCTAssertFalse(AuthSessionPolicy.isBackendRecoverable(code: BackendAuthCode.noSession, recoverable: false))
    }

    func testDegradedShellRequiresProfile() {
        let profile = UserProfile(
            id: 1,
            userId: nil,
            email: "a@b.c",
            displayName: nil,
            username: "u",
            firstName: nil,
            mfaEnabled: false
        )
        XCTAssertEqual(AppShellMode(authState: .degraded, profile: profile), .authenticated)
        XCTAssertEqual(AppShellMode(authState: .degraded, profile: nil), .guest)
    }
}
