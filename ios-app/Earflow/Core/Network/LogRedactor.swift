import Foundation

enum LogRedactor {
  private static let sensitivePatterns: [String] = [
    "mp_auth", "mp_sid", "mp_csrf", "mp_stream",
    "X-Auth-Proof-Access-Token", "X-Auth-Device-Proof",
    "Bearer ", "token=", "ticket=", "st=",
  ]

  static func redact(_ message: String) -> String {
    var result = message
    for pattern in sensitivePatterns {
      if result.localizedCaseInsensitiveContains(pattern) {
        result = result.replacingOccurrences(
          of: #"(?i)(token|ticket|proof|csrf|bearer|mp_[a-z_]+)\s*[:=]\s*[^\s,;]+"#,
          with: "$1=[REDACTED]",
          options: .regularExpression
        )
      }
    }
    return result
  }
}

enum GatewayLogger {
  static func debug(_ message: String) {
    Task { await EarflowLog.shared.debug("gateway", message) }
  }

  static func error(_ message: String) {
    Task { await EarflowLog.shared.error("gateway", message) }
  }
}
