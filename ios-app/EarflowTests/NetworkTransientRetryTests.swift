import XCTest
@testable import Earflow

final class NetworkTransientRetryTests: XCTestCase {
    func testTLSHandshakeIsTransientAndRetryable() {
        let tls = URLError(.secureConnectionFailed)
        XCTAssertTrue(NetworkTransientRetry.isTransient(tls))
        XCTAssertTrue(GatewayTransport.isRetryable(tls))
        XCTAssertEqual(
            GatewayTransport.map(tls),
            .network(GatewayNetworkCode.tlsHandshakeFailed.rawValue)
        )
    }

    func testOfflineIsNotRetryable() {
        let offline = URLError(.notConnectedToInternet)
        XCTAssertFalse(NetworkTransientRetry.isTransient(offline))
        XCTAssertFalse(GatewayTransport.isRetryable(offline))
    }

    func testConnectionLostIsRetryable() {
        let lost = URLError(.networkConnectionLost)
        XCTAssertTrue(NetworkTransientRetry.isTransient(lost))
        XCTAssertEqual(
            GatewayTransport.map(lost),
            .network(GatewayNetworkCode.connectionLost.rawValue)
        )
    }
}
