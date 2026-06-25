import Foundation

/// Last confirmed profile from gateway — mirrors web `localStorage.user` for degraded bootstrap.
enum SessionProfileCache {
    private static let storageKey = "ru.earflow.listener.cachedProfile"

    static func load() -> UserProfile? {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else { return nil }
        return try? JSONDecoder().decode(UserProfile.self, from: data)
    }

    static func save(_ profile: UserProfile) {
        guard AuthSessionPolicy.hasResolvableUser(profile) else { return }
        guard let data = try? JSONEncoder().encode(profile) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }
}
