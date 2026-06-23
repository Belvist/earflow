import Foundation

enum AuthValidators {
    static let emailRegex = try! NSRegularExpression(pattern: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#)
    static let usernameRegex = try! NSRegularExpression(pattern: #"^[A-Za-zА-Яа-яЁё0-9._-]{3,32}$"#)
    static let passwordMinLength = 8

    static func isValidEmail(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return emailRegex.firstMatch(in: value, range: range) != nil
    }

    static func normalizeUsername(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"^@+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)
    }

    static func isValidUsername(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return usernameRegex.firstMatch(in: value, range: range) != nil
    }

    struct PasswordStrength: Equatable {
        let label: String
        let percent: Int
        let meetsPolicy: Bool
        let tone: PasswordTone
    }

    enum PasswordTone: String, Equatable {
        case idle, weak, medium, good, strong
    }

    static func evaluatePassword(_ password: String) -> PasswordStrength {
        guard !password.isEmpty else {
            return PasswordStrength(label: "", percent: 0, meetsPolicy: false, tone: .idle)
        }
        var score = 0
        if password.count >= passwordMinLength { score += 1 }
        if password.count >= 12 { score += 1 }
        if password.range(of: #"[A-Za-zА-Яа-яЁё]"#, options: .regularExpression) != nil { score += 1 }
        if password.range(of: #"[0-9]"#, options: .regularExpression) != nil { score += 1 }
        if password.range(of: #"[^A-Za-z0-9А-Яа-яЁё]"#, options: .regularExpression) != nil { score += 1 }
        let normalized = min(score, 4)
        let percent = Int((Double(normalized) / 4.0) * 100)
        let meets = password.count >= passwordMinLength
            && password.range(of: #"[A-Za-zА-Яа-яЁё]"#, options: .regularExpression) != nil
            && password.range(of: #"[0-9]"#, options: .regularExpression) != nil
        let tone: PasswordTone
        let label: String
        switch normalized {
        case 0...1:
            tone = .weak
            label = "Слабый"
        case 2:
            tone = .medium
            label = "Средний"
        case 3:
            tone = .good
            label = "Хороший"
        default:
            tone = .strong
            label = "Сильный"
        }
        return PasswordStrength(label: label, percent: percent, meetsPolicy: meets, tone: tone)
    }
}
