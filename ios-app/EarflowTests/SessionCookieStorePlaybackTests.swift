import XCTest
@testable import Earflow

final class SessionCookieStorePlaybackTests: XCTestCase {
    override func tearDown() {
        let storage = SessionCookieStore.storage
        storage.cookies?
            .filter { ["mp_hls", "mp_lyrics"].contains($0.name) }
            .forEach { storage.deleteCookie($0) }
        super.tearDown()
    }

    func testPinPlaybackCookieNormalizesDomainAndPath() {
        let storage = SessionCookieStore.storage
        let api = AppConfiguration.current.gatewayBaseURL
        let properties: [HTTPCookiePropertyKey: Any] = [
            .name: "mp_hls",
            .value: "1.test.157.hash.999.sig",
            .domain: "api.earflow.ru",
            .path: "/",
            .secure: true,
        ]
        guard let cookie = HTTPCookie(properties: properties) else {
            XCTFail("cookie")
            return
        }
        storage.setCookie(cookie)

        SessionCookieStore.pinPlaybackCookies(apiBaseURL: api)

        XCTAssertTrue(SessionCookieStore.hasNamedCookie("mp_hls", for: api))
        let diagnostic = SessionCookieStore.playbackCookieDiagnostic(for: api)
        XCTAssertTrue(diagnostic.mpHls.present)
        XCTAssertEqual(diagnostic.mpHls.domain, ".earflow.ru")
    }

    func testIngestCookiesStoresPlaybackCookieFromSetCookieHeader() {
        let api = AppConfiguration.current.gatewayBaseURL
        let response = HTTPURLResponse(
            url: api.appending(path: "/api/ebap-hls/v1/session"),
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Set-Cookie": "mp_hls=1.test.42.hash.1.sig; Path=/api/ebap-hls/v1/; Domain=.earflow.ru; Secure; HttpOnly",
            ]
        )!
        SessionCookieStore.ingestCookies(from: response, for: api)
        XCTAssertTrue(SessionCookieStore.hasNamedCookie("mp_hls", for: api))
    }
}
