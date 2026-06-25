import Foundation

/// Resolves `masterUrl` from `POST /api/ebap-hls/v1/session` — mirrors web `apiClient.createHlsSession`.
enum StreamURLResolver {
    /// iOS native AVPlayer uses the API gateway host for HLS bytes (same nginx routes as `strmhaha`).
    /// Avoids TLS/VPN breakage on the dedicated stream subdomain while keeping token/`st` query intact.
    static func nativePlaybackURL(_ url: URL, configuration: AppConfiguration = .current) -> URL {
        guard configuration.prefersGatewayForNativeHLS else { return url }
        guard let host = url.host?.lowercased(), host == "strmhaha.earflow.ru" else { return url }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        components.host = configuration.gatewayBaseURL.host
        return components.url ?? url
    }

    static func resolveMasterURL(_ raw: String, configuration: AppConfiguration = .current) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let absolute = URL(string: trimmed),
           let scheme = absolute.scheme?.lowercased(),
           !scheme.isEmpty,
           absolute.host != nil {
            return nativePlaybackURL(absolute, configuration: configuration)
        }

        for base in configuration.hlsResolveBases {
            if let resolved = URL(string: trimmed, relativeTo: base)?.absoluteURL,
               resolved.scheme != nil,
               resolved.host != nil {
                return nativePlaybackURL(resolved, configuration: configuration)
            }
        }
        return nil
    }
}
