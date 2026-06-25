import Foundation
import Network

/// Shared reachability — observable on MainActor; no blocking semaphore probes.
@MainActor
final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()

    @Published private(set) var isConnected = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "ru.earflow.listener.network-monitor")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isConnected = path.status == .satisfied
            }
        }
        monitor.start(queue: queue)
    }

    /// Use from `@MainActor` UI — reads last path update without blocking the main thread.
    static var isReachable: Bool {
        shared.isConnected
    }
}
