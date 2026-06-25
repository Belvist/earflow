import XCTest
@testable import Earflow

final class AppConfigurationTests: XCTestCase {
    func testProductionDefaultWhenEnvUnsetOrMalformed() {
        let override = ProcessInfo.processInfo.environment["EARFLOW_API_BASE_URL"]
        let config = AppConfiguration.current

        if let override, !override.isEmpty, override.lowercased().hasPrefix("http"),
           let url = URL(string: override), let host = url.host, !host.isEmpty {
            XCTAssertEqual(config.gatewayBaseURL.host, host)
        } else {
            XCTAssertEqual(config.gatewayBaseURL.host, "api.earflow.ru")
            XCTAssertEqual(config.clientOrigin, "https://earflow.ru")
        }
    }
}
