import XCTest
@testable import Earflow

final class CanonicalProofStringTests: XCTestCase {
    func testCanonicalProofStringMatchesGatewayContract() {
        let canonical = DeviceProofSigner.buildCanonicalProofString(
            method: "GET",
            url: "/api/profile",
            timestamp: "1710000000",
            nonce: "nonce-test",
            sidHash: "sidhash-test"
        )
        XCTAssertEqual(
            canonical,
            "v1\nGET\n/api/profile\n\n1710000000\nnonce-test\nsidhash-test"
        )
    }

    func testCanonicalProofStringWithQuerySorted() {
        let canonical = DeviceProofSigner.buildCanonicalProofString(
            method: "POST",
            url: "https://api.earflow.ru/api/auth/proof/token?b=2&a=1",
            timestamp: "1710000001",
            nonce: "nonce-abc",
            sidHash: "sh"
        )
        XCTAssertTrue(canonical.contains("POST"))
        XCTAssertTrue(canonical.contains("/api/auth/proof/token"))
        XCTAssertTrue(canonical.contains("a=1"))
        XCTAssertTrue(canonical.contains("b=2"))
    }

    func testAuthDeviceIdPrefix() {
        let id = DeviceProofSigner.generateAuthDeviceId()
        XCTAssertTrue(id.hasPrefix("adev_"))
        XCTAssertLessThanOrEqual(id.count, 64)
    }
}
