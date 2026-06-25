import XCTest
@testable import Earflow

final class AuthStateTests: XCTestCase {
    func testAuthStateRawValues() {
        XCTAssertEqual(AuthState.authenticated.rawValue, "authenticated")
        XCTAssertEqual(AuthState.revoked.rawValue, "revoked")
    }

    func testAppShellModeFromAuthState() {
        XCTAssertEqual(AppShellMode(authState: .authenticated), .authenticated)
        XCTAssertEqual(AppShellMode(authState: .refreshing), .authenticated)
        XCTAssertEqual(AppShellMode(authState: .unauthenticated), .guest)
        XCTAssertEqual(AppShellMode(authState: .expired), .guest)
        XCTAssertEqual(AppShellMode(authState: .revoked), .guest)
        XCTAssertEqual(AppShellMode(authState: .authenticating), .guest)
        XCTAssertEqual(AuthState.degraded.rawValue, "degraded")
    }

    func testPlaybackStateMachineValues() {
        let states: [PlaybackState] = [
            .idle, .loadingSession, .loadingMedia, .ready, .playing,
            .paused, .buffering, .seeking, .ended, .failed, .revoked,
        ]
        XCTAssertEqual(states.count, 11)
    }
}
