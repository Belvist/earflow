import Foundation
@testable import Earflow

/// Simulates `nginx` rules for `^/api/ebap-hls/.*\.m3u8$` on api.earflow.ru (see `nginx/conf.d/20-media-maps.conf`).
final class MockNginxHLSURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        guard request.url?.host?.lowercased() == "api.earflow.ru" else { return false }
        return request.url?.path.lowercased().contains("/api/ebap-hls/") == true
            && request.url?.path.lowercased().hasSuffix(".m3u8") == true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }

        let origin = request.value(forHTTPHeaderField: "Origin") ?? ""
        let allowedOrigin = origin.range(
            of: #"^https?://(www\.)?earflow\.ru"#, options: .regularExpression
        ) != nil

        if !allowedOrigin {
            respond(url: url, status: 401, body: "Unauthorized")
            return
        }

        let secFetchDest = (request.value(forHTTPHeaderField: "Sec-Fetch-Dest") ?? "").lowercased()
        if secFetchDest == "document" {
            respond(url: url, status: 403, body: "Forbidden")
            return
        }

        let hasToken = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .contains { $0.name == "token" && !($0.value ?? "").isEmpty } ?? false
        let cookieHeader = request.value(forHTTPHeaderField: "Cookie") ?? ""
        let hasMpHls = cookieHeader.contains("mp_hls=")

        if !hasToken && !hasMpHls {
            respond(url: url, status: 401, body: "Unauthorized")
            return
        }

        let playlist = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nvariant.m3u8\n"
        respond(url: url, status: 200, body: playlist, contentType: "application/vnd.apple.mpegurl")
    }

    override func stopLoading() {}

    private func respond(url: URL, status: Int, body: String, contentType: String = "text/plain") {
        let data = Data(body.utf8)
        let headers = [
            "Content-Type": contentType,
            "Content-Length": "\(data.count)",
        ]
        let http = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

enum HLSContractTestHarness {
    static func makeNginxMockSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockNginxHLSURLProtocol.self]
        config.httpCookieStorage = SessionCookieStore.storage
        config.httpShouldSetCookies = true
        return URLSession(configuration: config)
    }

    static func seedMpHlsCookie() {
        let api = AppConfiguration.current.gatewayBaseURL
        let properties: [HTTPCookiePropertyKey: Any] = [
            .name: "mp_hls",
            .value: "1.test.42.hash.999.sig",
            .domain: ".earflow.ru",
            .path: "/api/ebap-hls/v1/",
            .secure: true,
        ]
        if let cookie = HTTPCookie(properties: properties) {
            SessionCookieStore.storage.setCookie(cookie)
        }
        _ = api
    }

    static func clearPlaybackCookies() {
        let storage = SessionCookieStore.storage
        storage.cookies?
            .filter { ["mp_hls", "mp_lyrics"].contains($0.name) }
            .forEach { storage.deleteCookie($0) }
    }
}
