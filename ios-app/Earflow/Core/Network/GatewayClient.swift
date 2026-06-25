import Foundation

/// Auth integration hooks — installed by `AuthActor` after init.
struct GatewayAuthHooks: Sendable {
    var authHeaders: (@Sendable (HTTPMethod, String) async throws -> [String: String])?
    var csrfToken: (@Sendable () async -> String?)?
    /// Returns true if session cookies were renewed (POST /api/auth/refresh).
    var refreshSession: (@Sendable () async -> Bool)?
    /// Re-bind device after DEVICE_PROOF_* 401 — mirrors web `deviceProofRecovery` middleware.
    var recoverDeviceProof: (@Sendable () async -> Bool)?
    var unauthorized: (@Sendable (Int, Data?) async -> Void)?
}

actor GatewayClient {
    private let configuration: GatewayConfiguration
    private let session: URLSession
    private let retryPolicy: RetryPolicy
    private var authHooks = GatewayAuthHooks()

    init(configuration: GatewayConfiguration = GatewayConfiguration(), retryPolicy: RetryPolicy = .default, urlSession: URLSession? = nil) {
        self.configuration = configuration
        self.retryPolicy = retryPolicy

        if let urlSession {
            session = urlSession
            return
        }

        let sessionConfig = URLSessionConfiguration.default
        sessionConfig.httpCookieAcceptPolicy = .always
        sessionConfig.httpShouldSetCookies = true
        sessionConfig.httpCookieStorage = SessionCookieStore.storage
        sessionConfig.timeoutIntervalForRequest = configuration.requestTimeout
        sessionConfig.timeoutIntervalForResource = configuration.resourceTimeout
        sessionConfig.waitsForConnectivity = false
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
            #if DEBUG
            GatewayLogger.error("decode failed path=\(path) error=\(error)")
            #else
            GatewayLogger.error("decode failed path=\(path)")
            #endif
            throw GatewayError.decodingFailed
        }
    }

    func requestData(
        method: HTTPMethod,
        path: String,
        body: (any Encodable)? = nil,
        skipAuth: Bool = false,
        allowRefreshOnUnauthorized: Bool = true
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
                    skipAuth: skipAuth,
                    retryAfterRefresh: false,
                    retryAfterDeviceProof: false,
                    allowRefreshOnUnauthorized: allowRefreshOnUnauthorized
                )
            } catch let error as GatewayError {
                if case .cancelled = error { throw error }
                if case let .serverError(detail) = error,
                   retryPolicy.shouldRetry(statusCode: detail.status, attempt: attempt) {
                    let delay = retryPolicy.delay(for: attempt)
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    continue
                }
                throw error
            } catch is CancellationError {
                throw GatewayError.cancelled
            } catch {
                let mapped = GatewayTransport.map(error)
                let retryError: Error = mapped ?? error
                if attempt < retryPolicy.maxAttempts, NetworkTransientRetry.isTransient(retryError) {
                    let delay = retryPolicy.delay(for: attempt)
                    await EarflowLog.shared.debug(
                        "gateway",
                        "transport retry attempt=\(attempt)/\(retryPolicy.maxAttempts) delay=\(String(format: "%.2f", delay))s"
                    )
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    continue
                }
                if let mapped {
                    throw mapped
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
        applyNativeClientHeaders(&request)
        if method != .get, let csrf = await authHooks.csrfToken?(), !csrf.isEmpty {
            request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GatewayError.network("non-http response")
        }
        guard (200...299).contains(http.statusCode) else {
            throw gatewayErrorForResponse(status: http.statusCode, data: data, notifyUnauthorized: http.statusCode == 401)
        }
        SessionCookieStore.ingestCookies(from: http, for: url)
        return data
    }

    /// Lightweight auth surface probe — GET /api/auth/csrf (no secrets logged).
    func probeAuthEndpoint() async -> (reachable: Bool, statusCode: Int?) {
        do {
            _ = try await requestData(method: .get, path: "/api/auth/csrf", skipAuth: true)
            return (true, 204)
        } catch let error as GatewayError {
            switch error {
            case .unauthorized(let detail), .forbidden(let detail):
                return (true, detail.status)
            case .serverError(let detail):
                return (detail.status < 500, detail.status)
            case .network:
                return (false, nil)
            default:
                return (true, nil)
            }
        } catch {
            return (false, nil)
        }
    }

    // MARK: - Private

    private func performRequest(
        method: HTTPMethod,
        url: URL,
        path: String,
        body: (any Encodable)?,
        skipAuth: Bool,
        retryAfterRefresh: Bool,
        retryAfterDeviceProof: Bool,
        allowRefreshOnUnauthorized: Bool
    ) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyNativeClientHeaders(&request)

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
            SessionCookieStore.ingestCookies(from: http, for: url)
            return data
        case 401:
            let detail = parseHTTPError(status: 401, data: data)
            if allowRefreshOnUnauthorized,
               !skipAuth,
               !retryAfterRefresh,
               !Self.isAuthRefreshPath(path),
               let refresh = authHooks.refreshSession,
               await refresh() {
                return try await performRequest(
                    method: method,
                    url: url,
                    path: path,
                    body: body,
                    skipAuth: skipAuth,
                    retryAfterRefresh: true,
                    retryAfterDeviceProof: retryAfterDeviceProof,
                    allowRefreshOnUnauthorized: allowRefreshOnUnauthorized
                )
            }
            if !skipAuth,
               !retryAfterDeviceProof,
               let recover = authHooks.recoverDeviceProof,
               Self.isRecoverableDeviceProofCode(detail.code),
               await recover() {
                return try await performRequest(
                    method: method,
                    url: url,
                    path: path,
                    body: body,
                    skipAuth: skipAuth,
                    retryAfterRefresh: retryAfterRefresh,
                    retryAfterDeviceProof: true,
                    allowRefreshOnUnauthorized: allowRefreshOnUnauthorized
                )
            }
            if !skipAuth {
                await authHooks.unauthorized?(401, data)
            }
            throw GatewayError.unauthorized(detail)
        case 403:
            let detail = parseHTTPError(status: 403, data: data)
            if detail.code == "DEVICE_REVOKED", !skipAuth {
                await authHooks.unauthorized?(403, data)
            }
            throw GatewayError.forbidden(detail)
        case 429:
            let detail = parseHTTPError(status: 429, data: data)
            throw GatewayError.unauthorized(detail)
        case 400...499:
            let detail = parseHTTPError(status: http.statusCode, data: data)
            throw GatewayError.unauthorized(detail)
        case 500...599:
            let detail = parseHTTPError(status: http.statusCode, data: data)
            throw GatewayError.serverError(detail)
        default:
            throw GatewayError.network("HTTP \(http.statusCode)")
        }
    }

    private func gatewayErrorForResponse(status: Int, data: Data, notifyUnauthorized: Bool) -> GatewayError {
        let detail = parseHTTPError(status: status, data: data)
        switch status {
        case 403:
            return .forbidden(detail)
        case 429:
            return .unauthorized(detail)
        case 400...499:
            if notifyUnauthorized {
                Task { await self.authHooks.unauthorized?(status, data) }
            }
            return .unauthorized(detail)
        case 500...599:
            return .serverError(detail)
        default:
            return .network("HTTP \(status)")
        }
    }

    private func applyNativeClientHeaders(_ request: inout URLRequest) {
        request.setValue(AppConfiguration.current.clientOrigin, forHTTPHeaderField: "Origin")
        request.setValue("ios-native", forHTTPHeaderField: "X-Earflow-Client")
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

    static func isAuthRefreshPath(_ path: String) -> Bool {
        let base = path.split(separator: "?", maxSplits: 1).first.map(String.init) ?? path
        return base == "/api/auth/refresh"
    }

    private static func isRecoverableDeviceProofCode(_ code: String?) -> Bool {
        guard let code else { return false }
        return code == BackendAuthCode.deviceProofInvalid || code == BackendAuthCode.deviceProofRequired
    }

    private func parseHTTPError(status: Int, data: Data) -> GatewayHTTPErrorDetail {
        let body = try? JSONDecoder().decode(APIErrorBody.self, from: data)
        let code = BackendAuthCode.normalize(rawCode: body?.code, message: body?.error)
        return GatewayHTTPErrorDetail(
            status: status,
            code: code,
            message: body?.error,
            retryAfterSeconds: body?.retryAfterSeconds,
            recoverable: body?.recoverable == true,
            reauthRequired: body?.reauthRequired == true
        )
    }
}

private struct AnyEncodable: Encodable {
    private let encode: (Encoder) throws -> Void
    init(_ wrapped: any Encodable) { encode = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encode(encoder) }
}
