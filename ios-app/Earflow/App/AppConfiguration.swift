import Foundation

/// Runtime configuration for the listener iOS app.
/// All API traffic uses the public Gateway host — never internal service URLs.
enum AppConfiguration: Sendable {
    case production
    case localDev(host: String, port: Int)

    static var current: AppConfiguration {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["EARFLOW_API_BASE_URL"],
           let url = URL(string: override),
           let host = url.host {
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
}
