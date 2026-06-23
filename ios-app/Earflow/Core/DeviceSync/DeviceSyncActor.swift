import Foundation

enum DeviceSyncState: String, Sendable, Equatable {
    case localOnly
    case syncing
    case synced
    case conflict
    case serverOverride
    case failed
}

/// Device Sync client skeleton — server frames are authoritative (`INV-DS-001`).
actor DeviceSyncActor {
    private let gateway: GatewayClient
    private let auth: AuthActor
    private var state: DeviceSyncState = .localOnly
    private var webSocketTask: Task<Void, Never>?

    init(gateway: GatewayClient, auth: AuthActor) {
        self.gateway = gateway
        self.auth = auth
    }

    func currentState() -> DeviceSyncState { state }

    /// Connect after auth — WS with ticket, no REST polling (`INV-DS-006`).
    func connectIfAuthenticated() async {
        guard await auth.currentState() == .authenticated else { return }
        guard webSocketTask == nil else { return }
        webSocketTask = Task {
            await self.runWebSocketLoop()
        }
    }

    func disconnect() {
        webSocketTask?.cancel()
        webSocketTask = nil
        state = .localOnly
    }

    /// Send play intent — backend decides transfer (`INV-DS-002`). No self-transfer.
    func sendPlayIntent(trackId: Int) async throws {
        _ = trackId
        // Phase 2: POST device-sync command via gateway + WS ticket flow.
        GatewayLogger.debug("device-sync play intent queued (skeleton)")
    }

    // MARK: - Private

    private func runWebSocketLoop() async {
        state = .syncing
        // Skeleton: real implementation uses POST /api/devices/ws-ticket with proof,
        // then connects to wss://api.earflow.ru/ws/devices with one-time ticket.
        GatewayLogger.debug("device-sync ws skeleton — not polling REST")
        state = .localOnly
    }
}
