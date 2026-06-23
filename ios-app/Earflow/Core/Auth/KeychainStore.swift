import Foundation
import Security

enum KeychainStoreError: Error, Sendable {
    case encodingFailed
    case decodeFailed
    case unhandledStatus(OSStatus)
}

/// Secure storage for device identity key material only.
/// Proof access tokens live in memory (`ProofAccessTokenCache`), not Keychain.
enum KeychainStore {
    private static let service = "ru.earflow.listener.auth-device"
    private static let account = "primary"

    static func saveDeviceIdentity(_ identity: DeviceIdentity, privateKeyPKCS8: Data) throws {
        let payload = KeychainPayload(
            authDeviceId: identity.authDeviceId,
            sidHash: identity.sidHash,
            publicKeySpki: identity.publicKeySpki,
            createdAt: identity.createdAt,
            privateKeyPKCS8: privateKeyPKCS8
        )
        let data = try JSONEncoder().encode(payload)
        try save(data: data)
    }

    static func loadDeviceIdentity() throws -> (identity: DeviceIdentity, privateKeyPKCS8: Data)? {
        guard let data = try load() else { return nil }
        let payload = try JSONDecoder().decode(KeychainPayload.self, from: data)
        let identity = DeviceIdentity(
            authDeviceId: payload.authDeviceId,
            sidHash: payload.sidHash,
            publicKeySpki: payload.publicKeySpki,
            createdAt: payload.createdAt
        )
        return (identity, payload.privateKeyPKCS8)
    }

    static func clear() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainStoreError.unhandledStatus(status)
        }
    }

    // MARK: - Private

    private struct KeychainPayload: Codable {
        let authDeviceId: String
        let sidHash: String
        let publicKeySpki: String
        let createdAt: Date
        let privateKeyPKCS8: Data
    }

    private static func save(data: Data) throws {
        try clear()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainStoreError.unhandledStatus(status)
        }
    }

    private static func load() throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainStoreError.unhandledStatus(status)
        }
        return data
    }
}
