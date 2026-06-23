import Foundation

struct RetryPolicy: Sendable {
    let maxAttempts: Int
    let initialDelay: TimeInterval
    let multiplier: Double
    let maxDelay: TimeInterval
    let retryableStatusCodes: Set<Int>

    static let `default` = RetryPolicy(
        maxAttempts: 3,
        initialDelay: 0.5,
        multiplier: 2.0,
        maxDelay: 8.0,
        retryableStatusCodes: [408, 500, 502, 503, 504]
    )

    /// 401/403/429 are never retried blindly — handled by caller.
    func delay(for attempt: Int) -> TimeInterval {
        let raw = initialDelay * pow(multiplier, Double(attempt - 1))
        return min(raw, maxDelay)
    }

    func shouldRetry(statusCode: Int, attempt: Int) -> Bool {
        guard attempt < maxAttempts else { return false }
        return retryableStatusCodes.contains(statusCode)
    }
}
