import Foundation
import os

enum LogLevel: String, Sendable, Codable, CaseIterable {
    case debug
    case info
    case warning
    case error

    var osLogType: OSLogType {
        switch self {
        case .debug: return .debug
        case .info: return .info
        case .warning: return .default
        case .error: return .error
        }
    }
}

struct LogEntry: Identifiable, Sendable, Codable {
    let id: UUID
    let timestamp: Date
    let level: LogLevel
    let category: String
    let message: String

    var formatted: String {
        let ts = ISO8601DateFormatter().string(from: timestamp)
        return "[\(ts)] [\(level.rawValue.uppercased())] [\(category)] \(message)"
    }
}

/// Central log — ring buffer for in-app debug console; secrets redacted.
actor EarflowLog {
    static let shared = EarflowLog()

    private let logger = Logger(subsystem: "ru.earflow.listener", category: "app")
    private var entries: [LogEntry] = []
    private let maxEntries = 400

    func log(_ level: LogLevel, category: String, _ message: String) {
        let redacted = LogRedactor.redact(message)
        let entry = LogEntry(id: UUID(), timestamp: Date(), level: level, category: category, message: redacted)
        entries.append(entry)
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }
        logger.log(level: level.osLogType, "[\(category)] \(redacted, privacy: .public)")
    }

    func debug(_ category: String, _ message: String) { log(.debug, category: category, message) }
    func info(_ category: String, _ message: String) { log(.info, category: category, message) }
    func warning(_ category: String, _ message: String) { log(.warning, category: category, message) }
    func error(_ category: String, _ message: String) { log(.error, category: category, message) }

    func recent(limit: Int = 200) -> [LogEntry] {
        Array(entries.suffix(min(limit, entries.count)))
    }

    func exportText() -> String {
        recent(limit: maxEntries).map(\.formatted).joined(separator: "\n")
    }

    func clear() {
        entries.removeAll()
    }
}
