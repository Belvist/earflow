import XCTest
@testable import Earflow

/// Simulator integration matrix for PEND-IOS-001 — login, bootstrap, restart, logout.
final class AuthActorLifecycleIntegrationTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockGatewayURLProtocol.setHandler(nil)
        SessionProfileCache.clear()
        try? KeychainStore.clear()
        clearSessionCookies()
        GatewayTestHarness.seedSessionCookies(in: SessionCookieStore.storage)
    }

    override func tearDown() {
        MockGatewayURLProtocol.setHandler(nil)
        SessionProfileCache.clear()
        try? KeychainStore.clear()
        clearSessionCookies()
        super.tearDown()
    }

    private func clearSessionCookies() {
        let storage = SessionCookieStore.storage
        storage.cookies?.forEach { cookie in
            if cookie.name == "mp_sid" || cookie.name == "mp_csrf" {
                storage.deleteCookie(cookie)
            }
        }
    }

    func testBootstrapAuthenticatedWithExistingSession() async {
        MockGatewayURLProtocol.setHandler(
            GatewayTestHarness.standardAuthRoutes(cookieStorage: SessionCookieStore.storage)
        )
        let gateway = GatewayTestHarness.makeGatewayClient()
        let auth = AuthActor(gateway: gateway)

        await auth.bootstrap()

        let state = await auth.currentState()
        let profileId = await auth.currentProfile()?.resolvedId
        XCTAssertEqual(state, .authenticated)
        XCTAssertEqual(profileId, 157)
        XCTAssertTrue(SessionCookieStore.hasSessionCookie(for: GatewayTestHarness.apiBaseURL))
        XCTAssertNotNil(SessionCookieStore.csrfToken(for: GatewayTestHarness.apiBaseURL))
    }

    func testColdStartRestartKeepsAuthenticatedProfile() async {
        MockGatewayURLProtocol.setHandler(
            GatewayTestHarness.standardAuthRoutes(cookieStorage: SessionCookieStore.storage)
        )
        let gateway = GatewayTestHarness.makeGatewayClient()
        let first = AuthActor(gateway: gateway)
        await first.bootstrap()
        let firstState = await first.currentState()
        XCTAssertEqual(firstState, .authenticated)

        let restarted = AuthActor(gateway: GatewayTestHarness.makeGatewayClient())
        await restarted.bootstrap()

        let restartedState = await restarted.currentState()
        let restartedProfileId = await restarted.currentProfile()?.resolvedId
        XCTAssertEqual(restartedState, .authenticated)
        XCTAssertEqual(restartedProfileId, 157)
        XCTAssertEqual(SessionProfileCache.load()?.resolvedId, 157)
    }

    func testRevalidateSessionStaysAuthenticated() async {
        MockGatewayURLProtocol.setHandler(
            GatewayTestHarness.standardAuthRoutes(cookieStorage: SessionCookieStore.storage)
        )
        let gateway = GatewayTestHarness.makeGatewayClient()
        let auth = AuthActor(gateway: gateway)
        await auth.bootstrap()
        let bootState = await auth.currentState()
        XCTAssertEqual(bootState, .authenticated)

        await auth.revalidateSession()

        let state = await auth.currentState()
        let profileId = await auth.currentProfile()?.resolvedId
        XCTAssertEqual(state, .authenticated)
        XCTAssertEqual(profileId, 157)
    }

    func testLogoutClearsSessionAndReturnsGuest() async {
        MockGatewayURLProtocol.setHandler(
            GatewayTestHarness.standardAuthRoutes(cookieStorage: SessionCookieStore.storage)
        )
        let gateway = GatewayTestHarness.makeGatewayClient()
        let auth = AuthActor(gateway: gateway)
        await auth.bootstrap()
        let bootState = await auth.currentState()
        XCTAssertEqual(bootState, .authenticated)

        await auth.logout()

        let state = await auth.currentState()
        let profile = await auth.currentProfile()
        XCTAssertEqual(state, .revoked)
        XCTAssertNil(profile)
        XCTAssertNil(SessionProfileCache.load())
        XCTAssertFalse(SessionCookieStore.hasSessionCookie(for: GatewayTestHarness.apiBaseURL))
    }

    func testEmailLoginPipelineAuthenticated() async throws {
        clearSessionCookies()
        MockGatewayURLProtocol.setHandler(
            GatewayTestHarness.standardAuthRoutes(cookieStorage: SessionCookieStore.storage)
        )
        let gateway = GatewayTestHarness.makeGatewayClient()
        let auth = AuthActor(gateway: gateway)

        try await auth.login(email: "ios-smoke@earflow.ru", password: "secret")

        let state = await auth.currentState()
        let profileId = await auth.currentProfile()?.resolvedId
        XCTAssertEqual(state, .authenticated)
        XCTAssertEqual(profileId, 157)
        XCTAssertTrue(SessionCookieStore.hasSessionCookie(for: GatewayTestHarness.apiBaseURL))
    }

    func testInvalidCredentialsSurfacesBackendCode() async {
        clearSessionCookies()
        MockGatewayURLProtocol.setHandler { request in
            let path = request.url?.path ?? ""
            if path == "/api/auth/csrf" {
                return MockGatewayURLProtocol.MockGatewayResponse(statusCode: 204)
            }
            if path == "/api/auth/email/login" {
                let body = try JSONEncoder().encode(
                    APIErrorBody(
                        error: "Неверный email или пароль",
                        code: "INVALID_CREDENTIALS",
                        retryAfterSeconds: nil,
                        recoverable: nil,
                        reauthRequired: nil
                    )
                )
                return MockGatewayURLProtocol.MockGatewayResponse(
                    statusCode: 401,
                    body: body,
                    headers: ["Content-Type": "application/json"]
                )
            }
            throw URLError(.unsupportedURL)
        }
        let auth = AuthActor(gateway: GatewayTestHarness.makeGatewayClient())

        do {
            try await auth.login(email: "bad@earflow.ru", password: "wrong")
            XCTFail("expected login failure")
        } catch let error as GatewayError {
            if case .unauthorized(let detail) = error {
                XCTAssertEqual(detail.code, "INVALID_CREDENTIALS")
            } else {
                XCTFail("unexpected gateway error \(error)")
            }
        } catch {
            XCTFail("unexpected error \(error)")
        }
        let state = await auth.currentState()
        XCTAssertEqual(state, .unauthenticated)
    }
}
