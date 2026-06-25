import Foundation

/// In-memory proof access token cache — never persisted to disk.
actor ProofAccessTokenCache {
    struct Entry: Sendable {
        let token: String
        let authDeviceId: String
        let expiresAtMs: Int64
    }

    private var cached: Entry?
    private var exchangeTask: Task<Entry, Error>?

    func getValid(nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> Entry? {
        guard let cached, cached.expiresAtMs > nowMs + 5_000 else { return nil }
        return cached
    }

    func hasActiveToken(nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> Bool {
        getValid(nowMs: nowMs) != nil
    }

    func set(_ entry: Entry) {
        cached = entry
    }

    func clear() {
        cached = nil
        exchangeTask?.cancel()
        exchangeTask = nil
    }

    func coalescedExchange(_ operation: @escaping @Sendable () async throws -> Entry) async throws -> Entry {
        if let existing = exchangeTask {
            return try await existing.value
        }
        let task = Task {
            defer { exchangeTask = nil }
            return try await operation()
        }
        exchangeTask = task
        return try await task.value
    }
}
