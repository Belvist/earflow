import AVFoundation
import Foundation

/// Injects session cookies on every HLS byte request (master + segments).
/// AVPlayer native HTTPS is intentionally avoided — it sends Sec-Fetch-Dest that nginx blocks with 403.
final class AuthenticatedStreamResourceLoader: NSObject, AVAssetResourceLoaderDelegate {
    static let customScheme = "earflow-stream"
    private static let playbackHost = "api.earflow.ru"

    private let httpHeaders: [String: String]?
    let loaderQueue = DispatchQueue(label: "ru.earflow.listener.hls-loader")
    private var activeLoads: [UUID: Task<Void, Never>] = [:]
    private let loadsLock = NSLock()

    private lazy var urlSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = SessionCookieStore.storage
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 22
        config.timeoutIntervalForResource = 50
        config.waitsForConnectivity = false
        config.httpMaximumConnectionsPerHost = 4
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        return URLSession(configuration: config)
    }()

    init(httpHeaders: [String: String]? = nil) {
        self.httpHeaders = httpHeaders
        super.init()
    }

    func cancelAllTasks() {
        loadsLock.lock()
        let tasks = Array(activeLoads.values)
        activeLoads.removeAll()
        loadsLock.unlock()
        tasks.forEach { $0.cancel() }
    }

    static func playbackURL(from httpsURL: URL) -> URL {
        let normalized = StreamURLResolver.nativePlaybackURL(httpsURL)
        guard normalized.scheme?.lowercased() == "https",
              var components = URLComponents(url: normalized, resolvingAgainstBaseURL: false) else {
            return normalized
        }
        components.scheme = customScheme
        return components.url ?? normalized
    }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        guard let requestURL = loadingRequest.request.url,
              let httpsURL = Self.rewriteToHTTPS(requestURL) else {
            return false
        }

        var rangeHeader: String?
        if let dataRequest = loadingRequest.dataRequest,
           dataRequest.requestedOffset > 0,
           !dataRequest.requestsAllDataToEndOfResource,
           !httpsURL.path.lowercased().hasSuffix(".m3u8") {
            rangeHeader = "bytes=\(dataRequest.requestedOffset)-"
        }

        let loadID = UUID()
        let task = Task { [weak self, weak loadingRequest] in
            guard let self else { return }
            defer { self.removeLoad(loadID) }
            guard let loadingRequest else { return }
            await self.deliver(loadingRequest: loadingRequest, httpsURL: httpsURL, rangeHeader: rangeHeader)
        }
        trackLoad(loadID, task: task)
        return true
    }

    private func deliver(
        loadingRequest: AVAssetResourceLoadingRequest,
        httpsURL: URL,
        rangeHeader: String?
    ) async {
        do {
            let (body, http) = try await fetchWithRetry(httpsURL: httpsURL, rangeHeader: rangeHeader)
            if Task.isCancelled {
                loadingRequest.finishLoading(with: CancellationError())
                return
            }

            var payload = body
            let isPlaylist = httpsURL.path.lowercased().hasSuffix(".m3u8")
            if isPlaylist {
                payload = Self.rewritePlaylistBody(payload)
            }

            if let info = loadingRequest.contentInformationRequest {
                info.contentType = Self.contentType(for: httpsURL, response: http)
                info.isByteRangeAccessSupported = !isPlaylist
                info.contentLength = Int64(payload.count)
            }
            if let dataRequest = loadingRequest.dataRequest, !payload.isEmpty {
                dataRequest.respond(with: payload)
            }
            loadingRequest.finishLoading()
        } catch is CancellationError {
            loadingRequest.finishLoading(with: CancellationError())
        } catch {
            await EarflowLog.shared.error("playback", "hls byte error: \(error.localizedDescription)")
            loadingRequest.finishLoading(with: error)
        }
    }

    private func fetchWithRetry(httpsURL: URL, rangeHeader: String?) async throws -> (Data, HTTPURLResponse) {
        var lastError: Error = URLError(.unknown)
        let maxAttempts = NetworkTransientRetry.playbackAttempts

        for attempt in 1 ... maxAttempts {
            if Task.isCancelled { throw CancellationError() }
            do {
                var request = URLRequest(url: httpsURL)
                request.httpMethod = "GET"
                request.cachePolicy = .reloadIgnoringLocalCacheData
                let headerFields = httpHeaders ?? StreamCookieHeaders.httpHeaderFields(for: httpsURL)
                for (key, value) in headerFields {
                    request.setValue(value, forHTTPHeaderField: key)
                }
                if let rangeHeader {
                    request.setValue(rangeHeader, forHTTPHeaderField: "Range")
                }

                let (data, response) = try await urlSession.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw URLError(.badServerResponse)
                }
                if (200 ... 299).contains(http.statusCode) {
                    return (data, http)
                }
                if attempt < maxAttempts,
                   NetworkTransientRetry.isTransientHTTP(http.statusCode),
                   http.statusCode != 401,
                   http.statusCode != 403 {
                    let delay = NetworkTransientRetry.delaySeconds(attempt: attempt)
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    continue
                }
                await EarflowLog.shared.error("playback", "hls HTTP \(http.statusCode) \(httpsURL.path)")
                throw URLError(.badServerResponse)
            } catch {
                lastError = error
                if attempt < maxAttempts, NetworkTransientRetry.isTransient(error) {
                    let delay = NetworkTransientRetry.delaySeconds(attempt: attempt)
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    continue
                }
                throw error
            }
        }
        throw lastError
    }

    private func trackLoad(_ id: UUID, task: Task<Void, Never>) {
        loadsLock.lock()
        activeLoads[id] = task
        loadsLock.unlock()
    }

    private func removeLoad(_ id: UUID) {
        loadsLock.lock()
        activeLoads.removeValue(forKey: id)
        loadsLock.unlock()
    }

    static func rewritePlaylistBodyForTests(_ data: Data) -> Data {
        rewritePlaylistBody(data)
    }

    private static func rewritePlaylistBody(_ data: Data) -> Data {
        guard let text = String(data: data, encoding: .utf8) else { return data }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        let rewritten = lines.map { line -> String in
            let raw = String(line)
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { return raw }
            if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
                return rewriteAbsoluteURL(trimmed)
            }
            if trimmed.hasPrefix("/") {
                return "\(customScheme)://\(playbackHost)\(trimmed)"
            }
            return raw
        }
        return Data(rewritten.joined(separator: "\n").utf8)
    }

    private static func rewriteAbsoluteURL(_ url: String) -> String {
        var value = url
        value = value.replacingOccurrences(of: "https://strmhaha.earflow.ru", with: "https://\(playbackHost)")
        value = value.replacingOccurrences(of: "http://strmhaha.earflow.ru", with: "https://\(playbackHost)")
        value = value.replacingOccurrences(of: "https://api.earflow.ru", with: "\(customScheme)://\(playbackHost)")
        value = value.replacingOccurrences(of: "http://api.earflow.ru", with: "\(customScheme)://\(playbackHost)")
        return value
    }

    private static func rewriteToHTTPS(_ url: URL) -> URL? {
        guard url.scheme?.lowercased() == customScheme,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.scheme = "https"
        guard let https = components.url else { return nil }
        return StreamURLResolver.nativePlaybackURL(https)
    }

    private static func contentType(for url: URL, response: HTTPURLResponse) -> String {
        if let mime = response.mimeType, !mime.isEmpty { return mime }
        if url.path.lowercased().hasSuffix(".m3u8") {
            return "application/vnd.apple.mpegurl"
        }
        if url.path.lowercased().hasSuffix(".m4s") || url.path.lowercased().hasSuffix(".mp4") {
            return "video/mp4"
        }
        return "application/octet-stream"
    }
}
