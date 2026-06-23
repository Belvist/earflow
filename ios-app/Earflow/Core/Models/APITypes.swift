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
        requestTimeout = 30
        resourceTimeout = 120
    }

    func resolve(path: String) -> URL {
        let normalized = path.hasPrefix("/") ? path : "/\(path)"
        return baseURL.appending(path: normalized)
    }
}

enum GatewayNetworkCode: String, Sendable {
    case dnsLookupFailed = "dns_lookup_failed"
    case offline = "offline"
    case timeout = "timeout"
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
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
            return .network(GatewayNetworkCode.offline.rawValue)
        case .timedOut:
            return .network(GatewayNetworkCode.timeout.rawValue)
        default:
            return nil
        }
    }

    static func isRetryable(_ error: Error) -> Bool {
        if let gateway = map(error) {
            if case .cancelled = gateway { return false }
            if case let .network(code) = gateway {
                return code == GatewayNetworkCode.timeout.rawValue
            }
            return false
        }
        return true
    }
}

enum GatewayError: Error, Equatable, Sendable {
    case blockedHost(String)
    case directInternalServiceForbidden(String)
    case invalidURL
    case unauthorized(code: String?)
    case forbidden(code: String?)
    case rateLimited
    case serverError(status: Int)
    case decodingFailed
    case cancelled
    case network(String)
    case maxRetriesExceeded
}

struct APIErrorBody: Codable, Sendable {
    let error: String?
    let code: String?
}
