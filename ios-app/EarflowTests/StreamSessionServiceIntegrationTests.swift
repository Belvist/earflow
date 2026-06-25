import XCTest
@testable import Earflow

final class StreamSessionServiceIntegrationTests: XCTestCase {
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

    func testCreateSessionResolvesRelativeMasterURL() async throws {
        MockGatewayURLProtocol.setHandler { request in
            let path = request.url?.path ?? ""
            if path == "/api/ebap-hls/v1/session" {
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"masterUrl":"/api/ebap-hls/v1/tracks/42/master.m3u8?token=test","expiresAtMs":9999999999999}"#
                )
            }
            if path == "/api/auth/stream-ticket" {
                return MockGatewayURLProtocol.MockGatewayResponse(statusCode: 404)
            }
            throw URLError(.unsupportedURL)
        }

        let gateway = GatewayTestHarness.makeGatewayClient()
        let tickets = StreamTicketService(gateway: gateway)
        let sessions = StreamSessionService(gateway: gateway, streamTickets: tickets)

        let ref = try await sessions.createSession(trackId: 42)

        XCTAssertEqual(ref.trackId, 42)
        XCTAssertEqual(ref.masterURL.host, "api.earflow.ru")
        XCTAssertTrue(ref.masterURL.path.contains("master.m3u8"))
    }

    func testCreateSessionCachesUntilExpiry() async throws {
        var sessionPostCount = 0
        MockGatewayURLProtocol.setHandler { request in
            let path = request.url?.path ?? ""
            if path == "/api/ebap-hls/v1/session" {
                sessionPostCount += 1
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"masterUrl":"https://strmhaha.earflow.ru/audio/v3/direct/ps_x/master.m3u8?token=test","expiresAtMs":9999999999999}"#
                )
            }
            throw URLError(.unsupportedURL)
        }

        let gateway = GatewayTestHarness.makeGatewayClient()
        let tickets = StreamTicketService(gateway: gateway)
        let sessions = StreamSessionService(gateway: gateway, streamTickets: tickets)

        _ = try await sessions.createSession(trackId: 7)
        _ = try await sessions.createSession(trackId: 7)

        XCTAssertEqual(sessionPostCount, 1)
    }

    func testHLSSessionDoesNotAttachStreamTicketQuery() async throws {
        MockGatewayURLProtocol.setHandler { request in
            let path = request.url?.path ?? ""
            if path == "/api/ebap-hls/v1/session" {
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"masterUrl":"/api/ebap-hls/v1/hls/209/master.m3u8?token=signedtok","expiresAtMs":9999999999999}"#
                )
            }
            if path == "/api/auth/stream-ticket" {
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"ticket":"opaque_st_should_not_attach","expiresIn":60}"#
                )
            }
            throw URLError(.unsupportedURL)
        }

        let gateway = GatewayTestHarness.makeGatewayClient()
        let tickets = StreamTicketService(gateway: gateway)
        let sessions = StreamSessionService(gateway: gateway, streamTickets: tickets)

        let ref = try await sessions.createSession(trackId: 209)
        let items = URLComponents(url: ref.masterURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertNil(items.first { $0.name == "st" })
        XCTAssertEqual(items.first { $0.name == "token" }?.value, "signedtok")
    }
}

final class AuthenticatedStreamResourceLoaderTests: XCTestCase {
    func testRewritesHTTPSMasterToCustomScheme() {
        let https = URL(string: "https://strmhaha.earflow.ru/audio/master.m3u8?st=tok")!
        let custom = AuthenticatedStreamResourceLoader.playbackURL(from: https)
        XCTAssertEqual(custom.scheme, AuthenticatedStreamResourceLoader.customScheme)
        XCTAssertEqual(custom.host, "api.earflow.ru")
        XCTAssertEqual(custom.query, "st=tok")
    }

    func testPlaylistRewriteUsesCustomSchemeForStreamHost() {
        let input = """
        #EXTM3U
        #EXT-X-STREAM-INF:BANDWIDTH=128000
        https://strmhaha.earflow.ru/api/ebap-hls/v1/hls/42/variant.m3u8
        /api/ebap-hls/v1/hls/42/alt.m3u8
        """.data(using: .utf8)!
        let output = AuthenticatedStreamResourceLoader.rewritePlaylistBodyForTests(input)
        let text = String(decoding: output, as: UTF8.self)
        XCTAssertTrue(text.contains("earflow-stream://api.earflow.ru"))
        XCTAssertFalse(text.contains("strmhaha.earflow.ru"))
        XCTAssertTrue(text.contains("earflow-stream://api.earflow.ru/api/ebap-hls/v1/hls/42/alt.m3u8"))
    }
}
