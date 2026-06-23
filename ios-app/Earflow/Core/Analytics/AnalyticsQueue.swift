import Foundation

/// Analytics event queue with deduplication and offline buffer skeleton.
actor AnalyticsQueue {
    private let gateway: GatewayClient
    private let auth: AuthActor
    private var pending: [AnalyticsEvent] = []
    private var sentKeys: Set<String> = []
    private let maxBuffer = 500

    init(gateway: GatewayClient, auth: AuthActor) {
        self.gateway = gateway
        self.auth = auth
    }

    func enqueue(_ event: AnalyticsEvent) async {
        guard sentKeys.insert(event.idempotencyKey).inserted else { return }
        guard pending.count < maxBuffer else { return }
        pending.append(event)
        await flushIfPossible()
    }

    func trackPlayback(
        kind: AnalyticsEventKind,
        trackId: Int,
        playbackSessionId: String?,
        playbackMode: String = "hls",
        reason: String? = nil,
        errorCode: String? = nil
    ) async {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
        let deviceId = await auth.currentAuthDeviceId()
        let event = AnalyticsEvent(
            idempotencyKey: "\(kind.rawValue):\(trackId):\(playbackSessionId ?? "none"):\(Int(Date().timeIntervalSince1970))",
            kind: kind,
            trackId: trackId,
            playbackSessionId: playbackSessionId,
            timestamp: Date(),
            appVersion: version,
            networkType: "unknown",
            playbackMode: playbackMode,
            reason: reason,
            errorCode: errorCode,
            clientDeviceId: deviceId
        )
        await enqueue(event)
    }

    // MARK: - Private

    private func flushIfPossible() async {
        guard await auth.currentState() == .authenticated else { return }
        guard !pending.isEmpty else { return }

        // Skeleton: future POST /api/analytics/events via gateway.
        // Never send userId from client as trust source — backend resolves from session.
        GatewayLogger.debug("analytics flush skeleton count=\(pending.count)")
        pending.removeAll()
    }
}
