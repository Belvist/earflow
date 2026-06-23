import Foundation
import WebKit

/// Session cookies from gateway — scoped to API host (never log values).
enum SessionCookieStore {
    static let storage: HTTPCookieStorage = .shared

    private static let csrfCookieName = "mp_csrf"
    private static let sidCookieName = "mp_sid"

    static func csrfToken(for apiBaseURL: URL) -> String? {
        cookieValue(named: csrfCookieName, for: apiBaseURL)
    }

    static func hasSessionCookie(for apiBaseURL: URL) -> Bool {
        cookieValue(named: sidCookieName, for: apiBaseURL) != nil
    }

    /// Copy cookies from WKWebView (auth.earflow.ru login) into URLSession jar.
    static func syncFromWebKit() async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        let cookies = await withCheckedContinuation { (continuation: CheckedContinuation<[HTTPCookie], Never>) in
            store.getAllCookies { continuation.resume(returning: $0) }
        }
        for cookie in cookies where cookie.name == sidCookieName || cookie.name == csrfCookieName {
            storage.setCookie(cookie)
        }
        await EarflowLog.shared.debug("auth", "synced \(cookies.count) webkit cookies to URLSession")
    }

    private static func cookieValue(named name: String, for apiBaseURL: URL) -> String? {
        if let direct = storage.cookies(for: apiBaseURL)?.first(where: { $0.name == name })?.value,
           !direct.isEmpty {
            return direct
        }
        let host = apiBaseURL.host?.lowercased() ?? ""
        return storage.cookies?.first { cookie in
            guard cookie.name == name, !cookie.value.isEmpty else { return false }
            return hostMatches(cookie: cookie, requestHost: host)
        }?.value
    }

    private static func hostMatches(cookie: HTTPCookie, requestHost: String) -> Bool {
        let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let host = requestHost.lowercased()
        return host == domain || host.hasSuffix(".\(domain)")
    }
}
