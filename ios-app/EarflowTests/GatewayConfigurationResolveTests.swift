import XCTest
@testable import Earflow

final class GatewayConfigurationResolveTests: XCTestCase {
    func testResolvePathWithQueryPreservesQueryString() {
        let config = GatewayConfiguration(appConfiguration: .production)
        let url = config.resolve(path: "/api/playlists/discover?seed=bucket-82510")
        XCTAssertEqual(url.host, "api.earflow.ru")
        XCTAssertEqual(url.path, "/api/playlists/discover")
        XCTAssertEqual(url.query, "seed=bucket-82510")
    }

    func testResolvePathWithMultipleQueryParams() {
        let config = GatewayConfiguration(appConfiguration: .production)
        let url = config.resolve(path: "/api/artists/popular?limit=12&offset=0")
        XCTAssertEqual(url.path, "/api/artists/popular")
        XCTAssertTrue(url.query?.contains("limit=12") == true)
    }
}
