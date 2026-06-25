import Foundation

enum LogRedactor {
    private static let sensitiveQueryKeys: Set<String> = [
        "token", "ticket", "st", "proof", "csrf", "bearer",
    ]

    static func redact(_ message: String) -> String {
        var result = redactURLQueryItems(in: message)
        result = result.replacingOccurrences(
            of: #"(?i)(token|ticket|proof|csrf|bearer|st|mp_[a-z_]+)\s*[:=]\s*[^\s,;&]+"#,
            with: "$1=[REDACTED]",
            options: .regularExpression
        )
        return result
    }

    private static func redactURLQueryItems(in message: String) -> String {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return message
        }
        let range = NSRange(message.startIndex..., in: message)
        var output = message
        let matches = detector.matches(in: message, options: [], range: range).reversed()
        for match in matches {
            guard let urlRange = Range(match.range, in: message),
                  var components = URLComponents(string: String(message[urlRange])),
                  let items = components.queryItems,
                  !items.isEmpty else { continue }

            var changed = false
            components.queryItems = items.map { item in
                let key = item.name.lowercased()
                guard sensitiveQueryKeys.contains(key), let value = item.value, !value.isEmpty else {
                    return item
                }
                changed = true
                return URLQueryItem(name: item.name, value: "[REDACTED]")
            }
            guard changed, let sanitized = components.string else { continue }
            output.replaceSubrange(urlRange, with: sanitized)
        }
        return output
    }
}

enum GatewayLogger {
    static func debug(_ message: String) {
        Task { await EarflowLog.shared.debug("gateway", LogRedactor.redact(message)) }
    }

    static func error(_ message: String) {
        Task { await EarflowLog.shared.error("gateway", LogRedactor.redact(message)) }
    }
}
