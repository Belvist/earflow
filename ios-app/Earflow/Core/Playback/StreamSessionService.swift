import Foundation

/// Creates HLS playback sessions via Gateway — never MinIO/S3 direct.
actor StreamSessionService {
    private let gateway: GatewayClient
    private let streamTickets: StreamTicketService
    private var inFlight: [Int: Task<PlaybackSessionRef, Error>] = [:]
    private var cache: [Int: CachedHLSSession] = [:]
    private var prefetchInFlight: [Int: Task<Void, Never>] = [:]
    private var prefetchCache: [Int: CachedHLSSession] = [:]

    init(gateway: GatewayClient, streamTickets: StreamTicketService) {
        self.gateway = gateway
        self.streamTickets = streamTickets
    }

    func createSession(trackId: Int) async throws -> PlaybackSessionRef {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        if let cached = cache[trackId],
           let expires = cached.expiresAtMs,
           expires > nowMs + 5000 {
            return Self.sanitizeCachedRef(cached.ref)
        }

        if let existing = inFlight[trackId] {
            return try await existing.value
        }

        let task = Task<PlaybackSessionRef, Error> {
            try await self.resolveSession(trackId: trackId, prefetch: false)
        }
        inFlight[trackId] = task
        defer { inFlight.removeValue(forKey: trackId) }
        let ref = try await task.value
        guard !Task.isCancelled else { throw CancellationError() }
        cache[trackId] = CachedHLSSession(ref: ref, expiresAtMs: ref.expiresAtMs)
        prefetchCache.removeValue(forKey: trackId)
        return ref
    }

    /// Warms masterUrl+token in memory without rotating `mp_hls` — safe while another track plays.
    func prefetchSession(
        trackId: Int,
        generation: UInt64,
        isGenerationCurrent: @Sendable @escaping (UInt64) async -> Bool
    ) async {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        if cache[trackId] != nil { return }
        if let cached = prefetchCache[trackId],
           let expires = cached.expiresAtMs,
           expires > nowMs + 5000 {
            return
        }
        if prefetchInFlight[trackId] != nil { return }

        let task = Task<Void, Never> {
            do {
                let ref = try await self.resolveSession(trackId: trackId, prefetch: true)
                guard !Task.isCancelled else { return }
                guard await isGenerationCurrent(generation) else {
                    await EarflowLog.shared.debug("playback", "hls prefetch stale generation track=\(trackId)")
                    return
                }
                self.prefetchCache[trackId] = CachedHLSSession(ref: ref, expiresAtMs: ref.expiresAtMs)
                await EarflowLog.shared.debug("playback", "hls prefetch ready track=\(trackId)")
            } catch {
                await EarflowLog.shared.debug("playback", "hls prefetch skipped track=\(trackId): \(error)")
            }
        }
        prefetchInFlight[trackId] = task
        defer { prefetchInFlight.removeValue(forKey: trackId) }
        await task.value
    }

    func clearCache(for trackId: Int? = nil) {
        if let trackId {
            cache.removeValue(forKey: trackId)
            prefetchCache.removeValue(forKey: trackId)
            inFlight[trackId]?.cancel()
            inFlight.removeValue(forKey: trackId)
            prefetchInFlight[trackId]?.cancel()
            prefetchInFlight.removeValue(forKey: trackId)
            return
        }
        for task in inFlight.values {
            task.cancel()
        }
        for task in prefetchInFlight.values {
            task.cancel()
        }
        inFlight.removeAll()
        prefetchInFlight.removeAll()
        cache.removeAll()
        prefetchCache.removeAll()
    }

    private func resolveSession(trackId: Int, prefetch: Bool) async throws -> PlaybackSessionRef {
        let response: HLSSessionResponse = try await gateway.request(
            method: .post,
            path: "/api/ebap-hls/v1/session",
            body: HLSSessionRequest(trackId: trackId, prefetch: prefetch),
            additionalHeaders: prefetch ? ["X-Earflow-Session-Intent": "prefetch"] : [:]
        )
        try Task.checkCancellation()
        if !prefetch {
            SessionCookieStore.pinPlaybackCookies()
        }
        guard let master = response.masterUrl,
              let url = StreamURLResolver.resolveMasterURL(master) else {
            throw GatewayError.network("missing_master_url")
        }
        try Self.validateStreamURL(url)
        let sessionId = "hls-\(trackId)-\(Int(Date().timeIntervalSince1970))"
        let playbackURL = Self.sanitizePlaybackURL(
            await streamTickets.attachMediaTicketIfAvailable(
                masterURL: url,
                sessionId: sessionId,
                trackId: trackId
            )
        )
        try Self.validatePlaybackCredentials(masterURL: playbackURL, trackId: trackId, prefetch: prefetch)
        try Task.checkCancellation()
        let hasToken = Self.hasSignedToken(in: playbackURL)
        await EarflowLog.shared.info(
            "playback",
            "hls \(prefetch ? "prefetch" : "session") intent=\(prefetch ? "prefetch" : "play") track=\(trackId) setCookie=\(prefetch ? "no" : "yes") token=\(hasToken)"
        )
        return PlaybackSessionRef(
            playbackSessionId: sessionId,
            trackId: trackId,
            masterURL: playbackURL,
            expiresAtMs: response.expiresAtMs.map(Int64.init)
        )
    }

    private static func sanitizePlaybackURL(_ url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = components.queryItems ?? []
        items.removeAll { $0.name == "st" }
        components.queryItems = items.isEmpty ? nil : items
        return components.url ?? url
    }

    private static func sanitizeCachedRef(_ ref: PlaybackSessionRef) -> PlaybackSessionRef {
        let sanitized = sanitizePlaybackURL(ref.masterURL)
        guard sanitized != ref.masterURL else { return ref }
        return PlaybackSessionRef(
            playbackSessionId: ref.playbackSessionId,
            trackId: ref.trackId,
            masterURL: sanitized,
            expiresAtMs: ref.expiresAtMs
        )
    }

    private struct CachedHLSSession: Sendable {
        let ref: PlaybackSessionRef
        let expiresAtMs: Int64?
    }

    private nonisolated static func validateStreamURL(_ url: URL) throws {
        let host = url.host?.lowercased() ?? ""
        let blocked = ["minio", "s3.amazonaws", ":9000"]
        for token in blocked where host.contains(token) {
            throw GatewayError.directInternalServiceForbidden(host)
        }
    }

    /// nginx `hls_auth_ok` needs `?token=` or `mp_hls` cookie — fail before AVPlayer if both missing.
    private nonisolated static func validatePlaybackCredentials(
        masterURL: URL,
        trackId: Int,
        prefetch: Bool
    ) throws {
        let hasToken = hasSignedToken(in: masterURL)
        let mpHls = SessionCookieStore.hasNamedCookie("mp_hls")
        guard hasToken || mpHls else {
            throw GatewayError.network("hls_session_missing_playback_auth track=\(trackId) prefetch=\(prefetch)")
        }
    }

    private nonisolated static func hasSignedToken(in url: URL) -> Bool {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return items.contains { $0.name == "token" && !($0.value ?? "").isEmpty }
    }
}
