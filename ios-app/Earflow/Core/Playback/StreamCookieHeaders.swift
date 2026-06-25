import Foundation

/// Builds auth headers/cookies for HLS playback — mirrors web `withCredentials` + Origin.
/// Native AVPlayer (`AVURLAsset`) needs Origin via header fields and cookies via `AVURLAssetHTTPCookiesKey`;
/// URLSession preflight needs the combined header set (Cookie inline).
enum StreamCookieHeaders {
    private static let playbackCookieNames: Set<String> = ["mp_hls", "mp_lyrics", "mp_sid", "mp_csrf", "mp_stream"]

    /// Cookies AVPlayer/URLSession must send for HLS auth (`mp_hls` etc.) — host + playback-name match.
    static func playbackCookies(for url: URL) -> [HTTPCookie] {
        let storage = SessionCookieStore.storage
        let requestHost = url.host?.lowercased() ?? ""
        var merged: [HTTPCookie] = storage.cookies(for: url) ?? []

        if let all = storage.cookies {
            for cookie in all where !cookie.value.isEmpty {
                if merged.contains(where: { $0.name == cookie.name && $0.domain == cookie.domain }) {
                    continue
                }
                let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                let hostMatch = requestHost == domain || requestHost.hasSuffix(".\(domain)") || domain.hasSuffix("earflow.ru")
                if hostMatch || playbackCookieNames.contains(cookie.name) {
                    merged.append(cookie)
                }
            }
        }
        return merged
    }

    /// Header fields for native `AVURLAsset` — NO Cookie (cookies go through `AVURLAssetHTTPCookiesKey`).
    /// nginx requires `Origin` on every HLS request; `Sec-Fetch-Dest: empty` avoids the `document` 403 rule.
    static func assetHeaderFields(for url: URL) -> [String: String] {
        let origin = AppConfiguration.current.clientOrigin
        return [
            "Origin": origin,
            "Referer": "\(origin)/",
            "User-Agent": AppConfiguration.current.userAgent,
            "Accept": "*/*",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
        ]
    }

    /// Full header set incl. inline Cookie — for URLSession preflight/byte probes.
    static func httpHeaderFields(for url: URL) -> [String: String] {
        var fields = assetHeaderFields(for: url)
        let merged = playbackCookies(for: url)
        if !merged.isEmpty {
            for (key, value) in HTTPCookie.requestHeaderFields(with: merged) {
                fields[key] = value
            }
        }
        return fields
    }
}
