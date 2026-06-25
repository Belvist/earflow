import Foundation

/// Retries for flaky paths (VPN tunnels, utun*, TLS re-handshake) — not a substitute for cert validation.
enum NetworkTransientRetry {
    static let gatewayAttempts = 5
    static let playbackAttempts = 4

    static func delaySeconds(attempt: Int) -> TimeInterval {
        let base = 0.35 * pow(1.75, Double(max(0, attempt - 1)))
        return min(base, 3.5)
    }

    static func isTransientHTTP(_ statusCode: Int) -> Bool {
        statusCode == 0 || statusCode == 408 || (500 ... 504).contains(statusCode)
    }

    static func isTransient(_ error: Error) -> Bool {
        if error is CancellationError { return false }
        if let gateway = error as? GatewayError {
            switch gateway {
            case .cancelled:
                return false
            case let .network(code):
                return retryableNetworkCodes.contains(code)
            case let .serverError(detail):
                return (500 ... 504).contains(detail.status) || detail.status == 408
            default:
                return false
            }
        }
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .cancelled,
             .notConnectedToInternet,
             .dataNotAllowed,
             .cannotFindHost,
             .dnsLookupFailed,
             .unsupportedURL,
             .badURL:
            return false
        case .timedOut,
             .secureConnectionFailed,
             .serverCertificateUntrusted,
             .serverCertificateHasBadDate,
             .clientCertificateRejected,
             .clientCertificateRequired,
             .networkConnectionLost,
             .cannotConnectToHost,
             .cannotLoadFromNetwork,
             .internationalRoamingOff:
            return true
        default:
            return false
        }
    }

    private static let retryableNetworkCodes: Set<String> = [
        GatewayNetworkCode.timeout.rawValue,
        GatewayNetworkCode.tlsHandshakeFailed.rawValue,
        GatewayNetworkCode.connectionLost.rawValue,
    ]
}
