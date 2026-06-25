import Foundation
@testable import Earflow

/// In-memory gateway stub for AuthActor integration tests (Simulator).
final class MockGatewayURLProtocol: URLProtocol {
    typealias Handler = (URLRequest) throws -> MockGatewayResponse

    struct MockGatewayResponse: Sendable {
        let statusCode: Int
        let body: Data
        let headers: [String: String]

        init(statusCode: Int, body: Data = Data(), headers: [String: String] = [:]) {
            self.statusCode = statusCode
            self.body = body
            self.headers = headers
        }

        static func jsonData(_ statusCode: Int, _ json: String, headers: [String: String] = [:]) -> MockGatewayResponse {
            var merged = headers
            if merged["Content-Type"] == nil {
                merged["Content-Type"] = "application/json"
            }
            return MockGatewayResponse(statusCode: statusCode, body: Data(json.utf8), headers: merged)
        }
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var _handler: Handler?

    static func setHandler(_ handler: Handler?) {
        lock.lock()
        defer { lock.unlock() }
        _handler = handler
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.lowercased() == "api.earflow.ru"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self._handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        do {
            let response = try handler(request)
            guard let url = request.url else {
                throw URLError(.badURL)
            }
            let http = HTTPURLResponse(
                url: url,
                statusCode: response.statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: response.headers
            )!
            client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
            if !response.body.isEmpty {
                client?.urlProtocol(self, didLoad: response.body)
            }
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

enum GatewayTestHarness {
    static let apiBaseURL = URL(string: "https://api.earflow.ru")!

    static func makeGatewayClient(cookieStorage: HTTPCookieStorage = SessionCookieStore.storage) -> GatewayClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockGatewayURLProtocol.self]
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.httpCookieStorage = cookieStorage
        config.httpAdditionalHeaders = [
            "User-Agent": "Earflow-iOS-Tests",
            "Accept": "application/json",
        ]
        let session = URLSession(configuration: config)
        return GatewayClient(configuration: GatewayConfiguration(), urlSession: session)
    }

    static func seedSessionCookies(in storage: HTTPCookieStorage) {
        let expires = Date().addingTimeInterval(86_400)
        for (name, value) in [("mp_sid", "test-sid"), ("mp_csrf", "test-csrf")] {
            let properties: [HTTPCookiePropertyKey: Any] = [
                .name: name,
                .value: value,
                .domain: "api.earflow.ru",
                .path: "/",
                .secure: true,
                .expires: expires,
            ]
            if let cookie = HTTPCookie(properties: properties) {
                storage.setCookie(cookie)
            }
        }
    }

    static let sampleProfile = UserProfile(
        id: 157,
        userId: nil,
        email: "ios-smoke@earflow.ru",
        displayName: "iOS Smoke",
        username: "ios_smoke",
        firstName: nil,
        mfaEnabled: false
    )

    static func standardAuthRoutes(
        profile: UserProfile = sampleProfile,
        cookieStorage: HTTPCookieStorage? = nil
    ) -> MockGatewayURLProtocol.Handler {
        let profileJSON = """
        {"id":\(profile.resolvedId ?? 157),"email":"\(profile.email ?? "")","username":"\(profile.username ?? "")","mfaEnabled":false}
        """
        return { request in
            let path = request.url?.path ?? ""
            switch (request.httpMethod ?? "GET", path) {
            case ("GET", "/api/auth/csrf"):
                return MockGatewayURLProtocol.MockGatewayResponse(statusCode: 204)
            case ("GET", "/api/profile"):
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(200, profileJSON)
            case ("POST", "/api/auth/device/register"):
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"authDeviceId":"test-device","sidHash":"test-sid-hash","ok":true}"#
                )
            case ("POST", "/api/auth/proof/token"):
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"token":"proof-access-test","expiresIn":90}"#
                )
            case ("GET", "/api/auth/2fa/step-up/status"):
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(200, #"{"ok":true,"active":true}"#)
            case ("POST", "/api/auth/refresh"):
                return MockGatewayURLProtocol.MockGatewayResponse(statusCode: 204)
            case ("POST", "/api/auth/logout"):
                return MockGatewayURLProtocol.MockGatewayResponse(statusCode: 204)
            case ("POST", "/api/auth/email/login"):
                if let cookieStorage {
                    seedSessionCookies(in: cookieStorage)
                }
                return MockGatewayURLProtocol.MockGatewayResponse.jsonData(
                    200,
                    #"{"ok":true,"user":\#(profileJSON)}"#
                )
            default:
                throw URLError(.unsupportedURL)
            }
        }
    }
}