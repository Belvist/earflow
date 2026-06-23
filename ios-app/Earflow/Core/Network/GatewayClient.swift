import Foundation

/// Auth integration hooks — installed by `AuthActor` after init.
struct GatewayAuthHooks: Sendable {
    var authHeaders: (@Sendable (HTTPMethod, String) async throws -> [String: String])?
    var csrfToken: (@Sendable () async -> String?)?
    var unauthorized: (@Sendable (Int, Data?) async -> Void)?
}

actor GatewayClient {
    private let configuration: GatewayConfiguration
    private let session: URLSession
    private let retryPolicy: RetryPolicy
    private var authHooks = GatewayAuthHooks()

    init(configuration: GatewayConfiguration = GatewayConfiguration(), retryPolicy: RetryPolicy = .default) {
        self.configuration = configuration
        self.retryPolicy = retryPolicy

        let sessionConfig = URLSessionConfiguration.default
        sessionConfig.httpCookieAcceptPolicy = .always
        sessionConfig.httpShouldSetCookies = true
        sessionConfig.httpCookieStorage = SessionCookieStore.storage
        sessionConfig.timeoutIntervalForRequest = configuration.requestTimeout
        sessionConfig.timeoutIntervalForResource = configuration.resourceTimeout
        sessionConfig.waitsForConnectivity = true
        sessionConfig.httpAdditionalHeaders = [
            "User-Agent": configuration.userAgent,
            "Accept": "application/json",
        ]
        session = URLSession(configuration: sessionConfig)
    }

    func bindAuthHooks(_ hooks: GatewayAuthHooks) {
        authHooks = hooks
    }

    var apiBaseURL: URL { configuration.baseURL }

    func request<T: Decodable>(
        method: HTTPMethod,
        path: String,
        body: (any Encodable)? = nil,
        skipAuth: Bool = false,
        decoder: JSONDecoder = JSONDecoder()
    ) async throws -> T {
        let data = try await requestData(
            method: method,
            path: path,
            body: body,
            skipAuth: skipAuth
        )
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            GatewayLogger.error("decode failed path=\(path)")
            throw GatewayError.decodingFailed
        }
    }

    func requestData(
        method: HTTPMethod,
        path: String,
        body: (any Encodable)? = nil,
        skipAuth: Bool = false
    ) async throws -> Data {
        try validateGatewayPath(path)
        let url = configuration.resolve(path: path)
        try validateURL(url)

        var attempt = 0
        while true {
            attempt += 1
            do {
                return try await performRequest(
                    method: method,
                    url: url,
                    path: path,
                    body: body,
                    skipAuth: skipAuth
                )
            } catch let error as GatewayError {
                if case .cancelled = error { throw error }
                if case let .serverError(status) = error,
                   retryPolicy.shouldRetry(statusCode: status, attempt: attempt) {
                    let delay = retryPolicy.delay(for: attempt)
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    continue
                }
                throw error
            } catch is CancellationError {
                throw GatewayError.cancelled
            } catch {
                if let mapped = GatewayTransport.map(error) {
                    throw mapped
                }
                if attempt < retryPolicy.maxAttempts, GatewayTransport.isRetryable(error) {
                    let delay = retryPolicy.delay(for: attempt)
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    continue
                }
                throw GatewayError.network(error.localizedDescription)
            }
        }
    }

    func clearCookies() {
        let storage = session.configuration.httpCookieStorage ?? HTTPCookieStorage.shared
        storage.cookies?
            .filter { cookie in
                let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                return configuration.allowedHosts.contains(domain)
            }
            .forEach { storage.deleteCookie($0) }
    }

    func requestWithAdditionalHeaders(
        method: HTTPMethod,
        path: String,
        body: (any Encodable)? = nil,
        additionalHeaders: [String: String]
    ) async throws -> Data {
        try validateGatewayPath(path)
        let url = configuration.resolve(path: path)
        try validateURL(url)

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        for (key, value) in additionalHeaders {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if method != .get, let csrf = await authHooks.csrfToken?(), !csrf.isEmpty {
            request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GatewayError.network("non-http response")
        }
        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 401 {
                await authHooks.unauthorized?(401, data)
            }
            throw GatewayError.unauthorized(code: parseErrorCode(data))
        }
        return data
    }

    // MARK: - Private

    private func performRequest(
        method: HTTPMethod,
        url: URL,
        path: String,
        body: (any Encodable)?,
        skipAuth: Bool
    ) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body {
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }

        if !skipAuth, let authHeaders = authHooks.authHeaders {
            let headers = try await authHeaders(method, path)
            for (key, value) in headers {
                request.setValue(value, forHTTPHeaderField: key)
            }
            if method != .get, let csrf = await authHooks.csrfToken?(), !csrf.isEmpty {
                request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token")
            }
        }

        GatewayLogger.debug("\(method.rawValue) \(path)")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GatewayError.network("non-http response")
        }

        switch http.statusCode {
        case 200...299:
            return data
        case 401:
            await authHooks.unauthorized?(401, data)
            let code = parseErrorCode(data)
            throw GatewayError.unauthorized(code: code)
        case 403:
            let code = parseErrorCode(data)
            if code == "DEVICE_REVOKED" {
                await authHooks.unauthorized?(403, data)
            }
            throw GatewayError.forbidden(code: code)
        case 429:
            throw GatewayError.rateLimited
        case 500...599:
            throw GatewayError.serverError(status: http.statusCode)
        default:
            throw GatewayError.network("HTTP \(http.statusCode)")
        }
    }

    private func validateGatewayPath(_ path: String) throws {
        let lower = path.lowercased()
        let blocked = [
            "minio", "redis", "postgres", "internal/", "/s3/", "strmhaha",
            ":9000", ":5432", ":6379", "database-service", "auth-service",
        ]
        for token in blocked where lower.contains(token) {
            throw GatewayError.directInternalServiceForbidden(token)
        }
    }

    private func validateURL(_ url: URL) throws {
        guard let host = url.host?.lowercased() else {
            throw GatewayError.invalidURL
        }
        guard configuration.allowedHosts.contains(host) else {
            throw GatewayError.blockedHost(host)
        }
        if let scheme = url.scheme?.lowercased(), scheme != "https" && scheme != "http" {
            throw GatewayError.invalidURL
        }
    }

    private func parseErrorCode(_ data: Data) -> String? {
        (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.code
            ?? (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error
    }
}

private struct AnyEncodable: Encodable {
    private let encode: (Encoder) throws -> Void
    init(_ wrapped: any Encodable) { encode = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encode(encoder) }
}
