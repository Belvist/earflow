import Foundation

/// Session cookies from gateway — scoped to API host (never log values).
enum SessionCookieStore {
    static let storage: HTTPCookieStorage = .shared

    private static let csrfCookieName = "mp_csrf"
    private static let sidCookieName = "mp_sid"

    static func csrfToken(for apiBaseURL: URL) -> String? {
        cookieValue(named: csrfCookieName, for: apiBaseURL)
    }

    static func hasNamedCookie(_ name: String, for apiBaseURL: URL = AppConfiguration.current.gatewayBaseURL) -> Bool {
        cookieDiagnostic(named: name, for: apiBaseURL).present
    }

    static func hasSessionCookie(for apiBaseURL: URL) -> Bool {
        sidDiagnostic(for: apiBaseURL).present
    }

    static func sidDiagnostic(for apiBaseURL: URL) -> CookiePresenceDiagnostic {
        cookieDiagnostic(named: sidCookieName, for: apiBaseURL)
    }

    static func csrfDiagnostic(for apiBaseURL: URL) -> CookiePresenceDiagnostic {
        cookieDiagnostic(named: csrfCookieName, for: apiBaseURL)
    }

    private static let playbackCookieNames: Set<String> = ["mp_hls", "mp_lyrics", "mp_stream"]

    /// Explicitly store Set-Cookie from gateway responses (URLSession may miss domain/path variants).
    static func ingestCookies(from response: HTTPURLResponse, for url: URL) {
        var headerFields: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String else { continue }
            if let stringValue = value as? String {
                headerFields[name] = stringValue
            }
        }
        guard !headerFields.isEmpty else { return }
        let parsed = HTTPCookie.cookies(withResponseHeaderFields: headerFields, for: url)
        var stored = 0
        for cookie in parsed where !cookie.value.isEmpty {
            if let normalized = normalizedPlaybackCookie(cookie, apiHost: apiHost(for: url)) {
                storage.setCookie(normalized)
                stored += 1
            } else if let normalized = normalizedSessionCookie(cookie, apiHost: apiHost(for: url)) {
                storage.setCookie(normalized)
                stored += 1
            }
        }
        if stored > 0 {
            Task { await EarflowLog.shared.debug("auth", "ingested \(stored) cookies from response") }
        }
    }

    /// Pin HLS playback cookies to `.earflow.ru` so AVPlayer requests on `api.earflow.ru` always send them.
    static func pinPlaybackCookies(apiBaseURL: URL = AppConfiguration.current.gatewayBaseURL) {
        let host = apiHost(for: apiBaseURL)
        guard let all = storage.cookies else { return }
        for cookie in all where playbackCookieNames.contains(cookie.name) && !cookie.value.isEmpty {
            storage.deleteCookie(cookie)
            if let normalized = normalizedPlaybackCookie(cookie, apiHost: host) {
                storage.setCookie(normalized)
            }
        }
    }

    static func playbackCookieDiagnostic(
        for apiBaseURL: URL = AppConfiguration.current.gatewayBaseURL
    ) -> (mpHls: CookiePresenceDiagnostic, mpLyrics: CookiePresenceDiagnostic) {
        (
            mpHls: cookieDiagnostic(named: "mp_hls", for: apiBaseURL),
            mpLyrics: cookieDiagnostic(named: "mp_lyrics", for: apiBaseURL)
        )
    }

    private static func apiHost(for url: URL) -> String {
        url.host?.lowercased() ?? "api.earflow.ru"
    }

    private static func normalizedPlaybackCookie(_ cookie: HTTPCookie, apiHost: String) -> HTTPCookie? {
        guard playbackCookieNames.contains(cookie.name) else { return nil }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: cookie.name,
            .value: cookie.value,
            .path: "/api/ebap-hls/v1/",
            .secure: true,
        ]
        if cookie.isHTTPOnly { properties[.init("HttpOnly")] = "TRUE" }
        properties[.domain] = ".earflow.ru"
        if let expires = cookie.expiresDate { properties[.expires] = expires }
        return HTTPCookie(properties: properties)
    }

    private static func normalizedSessionCookie(_ cookie: HTTPCookie, apiHost: String) -> HTTPCookie? {
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: cookie.name,
            .value: cookie.value,
            .path: cookie.path.isEmpty ? "/" : cookie.path,
            .secure: true,
        ]
        if cookie.isHTTPOnly { properties[.init("HttpOnly")] = "TRUE" }
        let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        if domain == apiHost || apiHost.hasSuffix(".\(domain)") || domain.hasSuffix("earflow.ru") {
            properties[.domain] = ".earflow.ru"
        } else {
            properties[.domain] = cookie.domain
        }
        if let expires = cookie.expiresDate { properties[.expires] = expires }
        return HTTPCookie(properties: properties)
    }

    private static func cookieDiagnostic(named name: String, for apiBaseURL: URL) -> CookiePresenceDiagnostic {
        if let cookie = resolveCookie(named: name, for: apiBaseURL), !cookie.value.isEmpty {
            return CookiePresenceDiagnostic(present: true, domain: cookie.domain)
        }
        return CookiePresenceDiagnostic(present: false, domain: nil)
    }

    private static func cookieValue(named name: String, for apiBaseURL: URL) -> String? {
        resolveCookie(named: name, for: apiBaseURL)?.value
    }

    private static func resolveCookie(named name: String, for apiBaseURL: URL) -> HTTPCookie? {
        if let direct = storage.cookies(for: apiBaseURL)?.first(where: { $0.name == name }),
           !direct.value.isEmpty {
            return direct
        }
        let host = apiBaseURL.host?.lowercased() ?? ""
        return storage.cookies?.first { cookie in
            guard cookie.name == name, !cookie.value.isEmpty else { return false }
            return hostMatches(cookie: cookie, requestHost: host)
        }
    }

    private static func hostMatches(cookie: HTTPCookie, requestHost: String) -> Bool {
        let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let host = requestHost.lowercased()
        return host == domain || host.hasSuffix(".\(domain)")
    }
}
