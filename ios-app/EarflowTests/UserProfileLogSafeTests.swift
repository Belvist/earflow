import XCTest
@testable import Earflow

final class UserProfileLogSafeTests: XCTestCase {
    func testLogSafeHandlePrefersUsername() {
        let profile = UserProfile(
            id: 157,
            userId: nil,
            email: "user@example.com",
            displayName: "Display",
            username: "earflow_user",
            firstName: nil,
            mfaEnabled: false
        )
        XCTAssertEqual(profile.logSafeHandle, "@earflow_user")
    }

    func testLogSafeHandleNeverExposesNumericId() {
        let profile = UserProfile(
            id: 157,
            userId: 157,
            email: nil,
            displayName: nil,
            username: nil,
            firstName: nil,
            mfaEnabled: false
        )
        XCTAssertEqual(profile.logSafeHandle, "account")
        XCTAssertFalse(profile.logSafeHandle.contains("157"))
    }
}
