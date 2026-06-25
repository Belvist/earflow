import Foundation

/// Runtime configuration for the listener iOS app.
/// All API traffic uses the public Gateway host — never internal service URLs.
enum AppConfiguration: Sendable {
    case production
    case localDev(host: String, port: Int)

    static var current: AppConfiguration {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["EARFLOW_API_BASE_URL"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty,
           override.lowercased().hasPrefix("http"),
           let url = URL(string: override),
           let host = url.host,
           !host.isEmpty {
            let port = url.port ?? (url.scheme == "https" ? 443 : 80)
            return .localDev(host: host, port: port)
        }
        #endif
        return .production
    }

    var gatewayBaseURL: URL {
        switch self {
        case .production:
            return URL(string: "https://api.earflow.ru")!
        case let .localDev(host, port):
            var components = URLComponents()
            components.scheme = port == 443 ? "https" : "http"
            components.host = host
            if port != 80 && port != 443 {
                components.port = port
            }
            return components.url!
        }
    }

    var allowedGatewayHosts: Set<String> {
        switch self {
        case .production:
            return ["api.earflow.ru"]
        case let .localDev(host, _):
            return [host.lowercased(), "localhost", "127.0.0.1"]
        }
    }

    var userAgent: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "Earflow-iOS/\(version) (\(build))"
    }

    var isLocalDev: Bool {
        if case .localDev = self { return true }
        return false
    }

    var gatewayDisplayURL: String {
        gatewayBaseURL.absoluteString
    }

    /// HLS manifest host — prod web runtime uses `api.earflow.ru` (`EARFLOW_STREAMING_BASE_URL` in docker-compose).
    var streamingBaseURL: URL {
        switch self {
        case .production:
            return URL(string: "https://strmhaha.earflow.ru")!
        case .localDev:
            return gatewayBaseURL
        }
    }

    /// Native AVPlayer fetches HLS via `api.earflow.ru` — identical routes, fewer TLS/VPN failures on stream host.
    var prefersGatewayForNativeHLS: Bool {
        switch self {
        case .production, .localDev:
            return true
        }
    }

    var hlsResolveBases: [URL] {
        if prefersGatewayForNativeHLS {
            return [gatewayBaseURL, streamingBaseURL]
        }
        return [streamingBaseURL, gatewayBaseURL]
    }

    /// Web login host for ASWebAuthenticationSession — auth subdomain in prod, gateway in local dev.
    var webLoginBaseURL: URL {
        switch self {
        case .production:
            return URL(string: "https://auth.earflow.ru")!
        case .localDev:
            return gatewayBaseURL
        }
    }

    /// Custom URL scheme intercepted by ASWebAuthenticationSession on the native auth callback.
    /// Must be listed in gateway NATIVE_AUTH_REDIRECT_URIS via `nativeAuthRedirectURI`.
    var nativeAuthCallbackScheme: String { "earflow" }

    var nativeAuthRedirectURI: String { "earflow://auth/callback" }

    /// CSRF Origin header — must match gateway ALLOWED_ORIGINS (same as web listener).
    var clientOrigin: String {
        switch self {
        case .production:
            return "https://earflow.ru"
        case .localDev:
            // auth-e2e overlay allows http://127.0.0.1:18080
            return gatewayBaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }
    }
}
