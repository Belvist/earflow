import Foundation

/// Creates HLS playback sessions via Gateway — never MinIO/S3 direct.
actor StreamSessionService {
    private let gateway: GatewayClient
    private var inFlight: [Int: Task<PlaybackSessionRef, Error>] = [:]

    init(gateway: GatewayClient) {
        self.gateway = gateway
    }

    func createSession(trackId: Int) async throws -> PlaybackSessionRef {
        if let existing = inFlight[trackId] {
            return try await existing.value
        }

        let task = Task<PlaybackSessionRef, Error> {
            let response: HLSSessionResponse = try await gateway.request(
                method: .post,
                path: "/api/ebap-hls/v1/session",
                body: HLSSessionRequest(trackId: trackId)
            )
            guard let master = response.masterUrl, let url = URL(string: master) else {
                throw GatewayError.network("missing_master_url")
            }
            try Self.validateStreamURL(url)
            let sessionId = "hls-\(trackId)-\(Int(Date().timeIntervalSince1970))"
            return PlaybackSessionRef(
                playbackSessionId: sessionId,
                trackId: trackId,
                masterURL: url,
                expiresAtMs: response.expiresAtMs.map(Int64.init)
            )
        }
        inFlight[trackId] = task
        defer { inFlight.removeValue(forKey: trackId) }
        return try await task.value
    }

    private nonisolated static func validateStreamURL(_ url: URL) throws {
        let host = url.host?.lowercased() ?? ""
        let blocked = ["minio", "s3.amazonaws", ":9000"]
        for token in blocked where host.contains(token) {
            throw GatewayError.directInternalServiceForbidden(host)
        }
    }
}
