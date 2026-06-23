import XCTest
@testable import Earflow

final class AuthStateTests: XCTestCase {
    func testAuthStateRawValues() {
        XCTAssertEqual(AuthState.authenticated.rawValue, "authenticated")
        XCTAssertEqual(AuthState.revoked.rawValue, "revoked")
    }

    func testPlaybackStateMachineValues() {
        let states: [PlaybackState] = [
            .idle, .loadingSession, .loadingMedia, .ready, .playing,
            .paused, .buffering, .seeking, .ended, .failed, .revoked,
        ]
        XCTAssertEqual(states.count, 11)
    }
}
