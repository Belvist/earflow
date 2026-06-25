import XCTest
@testable import Earflow

final class LogRedactorTests: XCTestCase {
    func testRedactsStQueryParamInURL() {
        let input = "GET https://api.earflow.ru/hls/master.m3u8?st=opaque_secret&token=abc"
        let redacted = LogRedactor.redact(input)
        XCTAssertFalse(redacted.contains("opaque_secret"))
        XCTAssertTrue(redacted.contains("st=[REDACTED]") || redacted.contains("st=%5BREDACTED%5D"))
    }

    func testRedactsInlineTokenAssignment() {
        let input = "failed token=supersecret value"
        let redacted = LogRedactor.redact(input)
        XCTAssertFalse(redacted.contains("supersecret"))
        XCTAssertTrue(redacted.contains("token=[REDACTED]"))
    }
}

final class GatewayHTTPErrorMappingTests: XCTestCase {
    func testServerErrorProjectionPreservesBackendCode() {
        let detail = GatewayHTTPErrorDetail(
            status: 503,
            code: "AUTH_UNAVAILABLE",
            message: "auth down",
            retryAfterSeconds: 30,
            recoverable: true
        )
        let error = GatewayError.serverError(detail)
        let projection = AuthErrorClassifier.project(for: error)
        XCTAssertEqual(projection.backendCode, "AUTH_UNAVAILABLE")
        XCTAssertEqual(projection.httpStatus, 503)
        XCTAssertEqual(projection.backendMessage, "auth down")
    }
}
