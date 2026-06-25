import Foundation

/// Probes HLS master URL with the same headers as playback — retries flaky VPN/TLS paths.
enum HLSPlaybackPreflight {
    struct Result: Sendable {
        let statusCode: Int
        let errorMessage: String?
    }

    private static let defaultSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = SessionCookieStore.storage
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 22
        config.timeoutIntervalForResource = 40
        config.waitsForConnectivity = false
        config.httpMaximumConnectionsPerHost = 4
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        return URLSession(configuration: config)
    }()

    /// Test-only override — contract tests inject nginx mock `URLSession`.
    static var testURLSession: URLSession?

    static func probe(masterURL: URL) async -> Result {
        let url = StreamURLResolver.nativePlaybackURL(masterURL)
        var last = Result(statusCode: 0, errorMessage: "no_attempt")
        let session = testURLSession ?? defaultSession

        for attempt in 1 ... NetworkTransientRetry.playbackAttempts {
            last = await probeOnce(url: url, session: session)
            if (200 ... 299).contains(last.statusCode) {
                return last
            }
            let retryHTTP = NetworkTransientRetry.isTransientHTTP(last.statusCode)
            let retryable = retryHTTP && last.statusCode != 401 && last.statusCode != 403
            guard attempt < NetworkTransientRetry.playbackAttempts, retryable else {
                return last
            }
            let delay = NetworkTransientRetry.delaySeconds(attempt: attempt)
            await EarflowLog.shared.debug(
                "playback",
                "hls preflight retry attempt=\(attempt) status=\(last.statusCode) delay=\(String(format: "%.2f", delay))s"
            )
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
        return last
    }

    private static func probeOnce(url: URL, session: URLSession) async -> Result {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        for (key, value) in StreamCookieHeaders.httpHeaderFields(for: url) {
            request.setValue(value, forHTTPHeaderField: key)
        }

        let hasToken = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .contains { $0.name == "token" && !($0.value ?? "").isEmpty } ?? false
        let cookies = SessionCookieStore.playbackCookieDiagnostic()

        do {
            let (_, response) = try await session.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200 ... 299).contains(code) {
                return Result(statusCode: code, errorMessage: nil)
            }
            let hint = code == 403
                ? "forbidden (auth token/cookie)"
                : code == 401
                    ? "unauthorized (cookie/token)"
                    : "http \(code)"
            await EarflowLog.shared.error(
                "playback",
                "hls preflight \(hint) path=\(url.path) mp_hls=\(cookies.mpHls.present) token=\(hasToken)"
            )
            return Result(statusCode: code, errorMessage: hint)
        } catch {
            if NetworkTransientRetry.isTransient(error) {
                await EarflowLog.shared.debug(
                    "playback",
                    "hls preflight transient: \(error.localizedDescription)"
                )
            } else {
                await EarflowLog.shared.error("playback", "hls preflight network: \(error.localizedDescription)")
            }
            return Result(statusCode: 0, errorMessage: error.localizedDescription)
        }
    }
}
