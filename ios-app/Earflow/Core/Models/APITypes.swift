import Foundation

enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

struct GatewayConfiguration: Sendable {
    let baseURL: URL
    let allowedHosts: Set<String>
    let userAgent: String
    let requestTimeout: TimeInterval
    let resourceTimeout: TimeInterval

    init(appConfiguration: AppConfiguration = .current) {
        baseURL = appConfiguration.gatewayBaseURL
        allowedHosts = appConfiguration.allowedGatewayHosts
        userAgent = appConfiguration.userAgent
        requestTimeout = 45
        resourceTimeout = 150
    }

    func resolve(path: String) -> URL {
        let normalized = path.hasPrefix("/") ? path : "/\(path)"
        guard let question = normalized.firstIndex(of: "?") else {
            return baseURL.appending(path: normalized)
        }

        let pathOnly = String(normalized[..<question])
        let query = String(normalized[normalized.index(after: question)...])

        var components = URLComponents()
        components.scheme = baseURL.scheme
        components.host = baseURL.host
        components.port = baseURL.port
        let basePath = baseURL.path.hasSuffix("/") ? String(baseURL.path.dropLast()) : baseURL.path
        components.path = basePath + pathOnly
        components.percentEncodedQuery = query

        guard let url = components.url, url.host != nil else {
            return baseURL.appending(path: pathOnly)
        }
        return url
    }
}

enum GatewayNetworkCode: String, Sendable {
    case dnsLookupFailed = "dns_lookup_failed"
    case offline = "offline"
    case connectionLost = "connection_lost"
    case timeout = "timeout"
    case tlsHandshakeFailed = "tls_handshake_failed"
}

enum GatewayTransport {
    /// Maps URLSession transport errors; DNS/offline are not retryable.
    static func map(_ error: Error) -> GatewayError? {
        if error is CancellationError { return .cancelled }
        guard let urlError = error as? URLError else { return nil }
        switch urlError.code {
        case .cancelled:
            return .cancelled
        case .cannotFindHost, .dnsLookupFailed:
            return .network(GatewayNetworkCode.dnsLookupFailed.rawValue)
        case .notConnectedToInternet, .dataNotAllowed:
            return .network(GatewayNetworkCode.offline.rawValue)
        case .networkConnectionLost, .cannotConnectToHost:
            return .network(GatewayNetworkCode.connectionLost.rawValue)
        case .timedOut:
            return .network(GatewayNetworkCode.timeout.rawValue)
        case .secureConnectionFailed,
             .serverCertificateUntrusted,
             .serverCertificateHasBadDate,
             .clientCertificateRejected,
             .clientCertificateRequired:
            return .network(GatewayNetworkCode.tlsHandshakeFailed.rawValue)
        default:
            return nil
        }
    }

    static func isRetryable(_ error: Error) -> Bool {
        NetworkTransientRetry.isTransient(error)
    }
}

struct APIErrorBody: Codable, Sendable {
    let error: String?
    let code: String?
    let retryAfterSeconds: Int?
    let recoverable: Bool?
    let reauthRequired: Bool?
}

struct GatewayHTTPErrorDetail: Equatable, Sendable {
    let status: Int
    let code: String?
    let message: String?
    let retryAfterSeconds: Int?
    let recoverable: Bool
    let reauthRequired: Bool

    init(
        status: Int,
        code: String?,
        message: String?,
        retryAfterSeconds: Int?,
        recoverable: Bool = false,
        reauthRequired: Bool = false
    ) {
        self.status = status
        self.code = code
        self.message = message
        self.retryAfterSeconds = retryAfterSeconds
        self.recoverable = recoverable
        self.reauthRequired = reauthRequired
    }
}

enum GatewayError: Error, Equatable, Sendable {
    case blockedHost(String)
    case directInternalServiceForbidden(String)
    case invalidURL
    case unauthorized(GatewayHTTPErrorDetail)
    case forbidden(GatewayHTTPErrorDetail)
    case rateLimited
    case serverError(GatewayHTTPErrorDetail)
    case decodingFailed
    case cancelled
    case network(String)
    case maxRetriesExceeded
}

extension GatewayError: CustomStringConvertible {
    var description: String {
        switch self {
        case .blockedHost(let host): return "blockedHost(\(host))"
        case .directInternalServiceForbidden(let token): return "directInternalForbidden(\(token))"
        case .invalidURL: return "invalidURL"
        case .unauthorized(let detail): return "unauthorized(\(detail.status),\(detail.code ?? "nil"))"
        case .forbidden(let detail): return "forbidden(\(detail.status),\(detail.code ?? "nil"))"
        case .rateLimited: return "rateLimited"
        case .serverError(let detail): return "serverError(\(detail.status),\(detail.code ?? "nil"))"
        case .decodingFailed: return "decodingFailed"
        case .cancelled: return "cancelled"
        case .network(let msg): return "network(\(msg))"
        case .maxRetriesExceeded: return "maxRetriesExceeded"
        }
    }

    var localizedDescription: String {
        switch self {
        case .unauthorized(let detail):
            return detail.message ?? detail.code ?? "unauthorized"
        case .forbidden(let detail):
            return detail.message ?? detail.code ?? "forbidden"
        case .serverError(let detail):
            return detail.message ?? detail.code ?? "server_error"
        default:
            return description
        }
    }
}
