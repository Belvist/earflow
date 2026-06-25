import XCTest
import AVFoundation
@testable import Earflow

/// Contract tests for prod HLS path — these MUST fail if we regress nginx/auth parity.
/// Old `StreamSessionServiceIntegrationTests` only checked URL parsing (no Set-Cookie, no GET master).
final class HLSPlaybackContractTests: XCTestCase {
    override func setUp() {
        super.setUp()
        HLSPlaybackPreflight.testURLSession = nil
        HLSContractTestHarness.clearPlaybackCookies()
    }

    override func tearDown() {
        HLSPlaybackPreflight.testURLSession = nil
        HLSContractTestHarness.clearPlaybackCookies()
        super.tearDown()
    }

    func testStreamCookieHeadersIncludeOriginAndSecFetchEmpty() {
        HLSContractTestHarness.seedMpHlsCookie()
        let url = URL(string: "https://api.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8?token=t")!
        let fields = StreamCookieHeaders.httpHeaderFields(for: url)
        XCTAssertEqual(fields["Origin"], "https://earflow.ru")
        XCTAssertEqual(fields["Sec-Fetch-Dest"], "empty")
        XCTAssertEqual(fields["Sec-Fetch-Mode"], "cors")
        XCTAssertTrue((fields["Cookie"] ?? "").contains("mp_hls="))
    }

    // MARK: - Native asset options (root cause of -12881: segments cannot go through resource loader)

    func testAssetHeaderFieldsCarryOriginWithoutInlineCookie() {
        let url = URL(string: "https://api.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8?token=t")!
        let fields = StreamCookieHeaders.assetHeaderFields(for: url)
        XCTAssertEqual(fields["Origin"], "https://earflow.ru")
        XCTAssertEqual(fields["Sec-Fetch-Dest"], "empty")
        // Cookies travel via AVURLAssetHTTPCookiesKey — never inline (single cookie source).
        XCTAssertNil(fields["Cookie"])
    }

    func testPlaybackCookiesIncludeMpHls() {
        HLSContractTestHarness.seedMpHlsCookie()
        let url = URL(string: "https://api.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8")!
        let cookies = StreamCookieHeaders.playbackCookies(for: url)
        XCTAssertTrue(cookies.contains { $0.name == "mp_hls" })
    }

    func testAuthenticatedAssetOptionsInjectOriginAndCookies() {
        HLSContractTestHarness.seedMpHlsCookie()
        let url = URL(string: "https://api.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8?token=t")!
        let options = AVPlayerEngine.assetOptions(for: url)
        let headers = options["AVURLAssetHTTPHeaderFieldsKey"] as? [String: String]
        XCTAssertEqual(headers?["Origin"], "https://earflow.ru")
        let cookies = options[AVURLAssetHTTPCookiesKey] as? [HTTPCookie]
        XCTAssertTrue(cookies?.contains { $0.name == "mp_hls" } ?? false)
    }

    func testNginxMockRejectsMasterWithoutOrigin() async {
        HLSPlaybackPreflight.testURLSession = HLSContractTestHarness.makeNginxMockSession()
        HLSContractTestHarness.seedMpHlsCookie()
        let master = URL(string: "https://api.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8?token=signed")!

        // Bypass StreamCookieHeaders — raw request would miss Origin (old bug class).
        var request = URLRequest(url: master)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockNginxHLSURLProtocol.self]
        let session = URLSession(configuration: config)
        let (_, response) = try! await session.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 401)
    }

    func testNginxMockRejectsSecFetchDocument() async {
        HLSContractTestHarness.seedMpHlsCookie()
        var request = URLRequest(url: URL(string: "https://api.earflow.ru/api/ebap-hls/v1/hls/1/master.m3u8?token=t")!)
        request.setValue("https://earflow.ru", forHTTPHeaderField: "Origin")
        request.setValue("document", forHTTPHeaderField: "Sec-Fetch-Dest")

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockNginxHLSURLProtocol.self]
        let (_, response) = try! await URLSession(configuration: config).data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 403)
    }

    func testPreflightSucceedsWithTokenAndStreamCookieHeaders() async {
        HLSPlaybackPreflight.testURLSession = HLSContractTestHarness.makeNginxMockSession()
        let master = URL(string: "https://api.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8?token=signed")!
        let result = await HLSPlaybackPreflight.probe(masterURL: master)
        XCTAssertEqual(result.statusCode, 200)
        XCTAssertNil(result.errorMessage)
    }

    func testPreflightSucceedsWithMpHlsCookieWithoutToken() async {
        HLSPlaybackPreflight.testURLSession = HLSContractTestHarness.makeNginxMockSession()
        HLSContractTestHarness.seedMpHlsCookie()
        let master = URL(string: "https://api.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8")!
        let result = await HLSPlaybackPreflight.probe(masterURL: master)
        XCTAssertEqual(result.statusCode, 200)
    }

    func testPreflightFailsWithoutTokenAndCookie() async {
        HLSPlaybackPreflight.testURLSession = HLSContractTestHarness.makeNginxMockSession()
        let master = URL(string: "https://api.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8")!
        let result = await HLSPlaybackPreflight.probe(masterURL: master)
        XCTAssertEqual(result.statusCode, 401)
    }

    func testSessionServiceRejectsResponseWithoutTokenOrMpHls() async {
        MockGatewayURLProtocol.setHandler { request in
            if request.url?.path == "/api/ebap-hls/v1/session" {
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"masterUrl":"/api/ebap-hls/v1/hls/99/master.m3u8","expiresAtMs":9999999999999}"#
                )
            }
            throw URLError(.unsupportedURL)
        }

        let gateway = GatewayTestHarness.makeGatewayClient()
        let sessions = StreamSessionService(gateway: gateway, streamTickets: StreamTicketService(gateway: gateway))

        do {
            _ = try await sessions.createSession(trackId: 99)
            XCTFail("expected missing playback auth")
        } catch let error as GatewayError {
            if case .network(let code) = error {
                XCTAssertTrue(code.contains("hls_session_missing_playback_auth"))
            } else {
                XCTFail("unexpected \(error)")
            }
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testSessionServiceAcceptsTokenInMasterUrl() async throws {
        MockGatewayURLProtocol.setHandler { request in
            if request.url?.path == "/api/ebap-hls/v1/session" {
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"masterUrl":"/api/ebap-hls/v1/hls/100/master.m3u8?token=signed","expiresAtMs":9999999999999}"#
                )
            }
            throw URLError(.unsupportedURL)
        }

        let gateway = GatewayTestHarness.makeGatewayClient()
        let sessions = StreamSessionService(gateway: gateway, streamTickets: StreamTicketService(gateway: gateway))
        let ref = try await sessions.createSession(trackId: 100)
        let items = URLComponents(url: ref.masterURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertNotNil(items.first { $0.name == "token" })
    }

    func testSessionServiceAcceptsMpHlsFromSetCookie() async throws {
        MockGatewayURLProtocol.setHandler { request in
            if request.url?.path == "/api/ebap-hls/v1/session" {
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"masterUrl":"/api/ebap-hls/v1/hls/101/master.m3u8","expiresAtMs":9999999999999}"#,
                    headers: [
                        "Set-Cookie": "mp_hls=1.test.101.hash.1.sig; Path=/api/ebap-hls/v1/; Domain=.earflow.ru; Secure; HttpOnly",
                    ]
                )
            }
            throw URLError(.unsupportedURL)
        }

        let gateway = GatewayTestHarness.makeGatewayClient()
        let sessions = StreamSessionService(gateway: gateway, streamTickets: StreamTicketService(gateway: gateway))
        let ref = try await sessions.createSession(trackId: 101)
        XCTAssertTrue(SessionCookieStore.hasNamedCookie("mp_hls"))
        XCTAssertEqual(ref.masterURL.host, "api.earflow.ru")
    }

    func testFullContractSessionThenPreflight() async throws {
        MockGatewayURLProtocol.setHandler { request in
            if request.url?.path == "/api/ebap-hls/v1/session" {
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"masterUrl":"/api/ebap-hls/v1/hls/202/master.m3u8?token=live","expiresAtMs":9999999999999}"#
                )
            }
            throw URLError(.unsupportedURL)
        }

        let gateway = GatewayTestHarness.makeGatewayClient()
        let sessions = StreamSessionService(gateway: gateway, streamTickets: StreamTicketService(gateway: gateway))
        let ref = try await sessions.createSession(trackId: 202)

        HLSPlaybackPreflight.testURLSession = HLSContractTestHarness.makeNginxMockSession()
        let preflight = await HLSPlaybackPreflight.probe(masterURL: ref.masterURL)
        XCTAssertEqual(preflight.statusCode, 200, "session → preflight must pass nginx contract")
    }
}
