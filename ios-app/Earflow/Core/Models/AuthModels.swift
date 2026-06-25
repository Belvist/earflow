import Foundation

struct LoginRequest: Encodable, Sendable {
    let email: String
    let password: String
}

struct LoginResponse: Decodable, Sendable {
    let user: UserProfile?
    let ok: Bool?
}

struct UserProfile: Codable, Sendable, Equatable {
    let id: Int?
    let userId: Int?
    let email: String?
    let displayName: String?
    let username: String?
    let firstName: String?
    let mfaEnabled: Bool?

    var resolvedId: Int? { id ?? userId }

    var resolvedDisplayName: String? {
        if let displayName, !displayName.isEmpty { return displayName }
        if let firstName, !firstName.isEmpty { return firstName }
        return username
    }
}

struct MfaStepUpRequest: Encodable, Sendable {
    let token: String?
    let recoveryCode: String?

    init(totpCode: String) {
        token = totpCode
        recoveryCode = nil
    }

    init(recoveryCode: String) {
        token = nil
        self.recoveryCode = recoveryCode
    }
}

struct MfaStepUpResponse: Decodable, Sendable {
    let ok: Bool?
    let ttlSeconds: Int?
}

struct MfaStepUpStatusResponse: Decodable, Sendable {
    let ok: Bool?
    let active: Bool?
}

struct DeviceRegisterRequest: Encodable, Sendable {
    let authDeviceId: String
    let publicKeySpki: String
}

struct DeviceRegisterResponse: Decodable, Sendable {
    let authDeviceId: String
    let sidHash: String
    let ok: Bool
}

/// Native web-login (ASWebAuthenticationSession + PKCE) — exchanges a one-time code for a
/// device-bound session. Contract: gateway `POST /api/auth/native/exchange`.
struct NativeAuthExchangeRequest: Encodable, Sendable {
    let code: String
    let codeVerifier: String
    let authDeviceId: String
    let publicKeySpki: String
}

struct NativeAuthExchangeResponse: Decodable, Sendable {
    let user: UserProfile?
    let authDeviceId: String
    let sidHash: String
    let ok: Bool
}

struct ProofTokenResponse: Decodable, Sendable {
    let token: String
    let expiresAt: String?
    let expiresIn: Int?
}

struct HLSSessionRequest: Encodable, Sendable {
    let trackId: Int
}

struct HLSSessionResponse: Decodable, Sendable {
    let masterUrl: String?
    let expiresAtMs: Int?
}

struct PublicConfigResponse: Decodable, Sendable {
    let ok: Bool?
    let telegramBotUsername: String?

    enum CodingKeys: String, CodingKey {
        case ok
        case telegramBotUsername
    }
}

struct RegisterRequest: Encodable, Sendable {
    let email: String
    let password: String
    let firstName: String
    let username: String
}

struct TelegramLoginRequest: Encodable, Sendable {
    let id: Int64
    let first_name: String?
    let last_name: String?
    let username: String?
    let photo_url: String?
    let auth_date: Int64
    let hash: String

    enum CodingKeys: String, CodingKey {
        case id
        case first_name, last_name, username, photo_url, auth_date, hash
    }

    init(from payload: [String: Any]) throws {
        guard let idNum = payload["id"] as? Int ?? (payload["id"] as? NSNumber)?.intValue else {
            throw GatewayError.network("invalid_telegram_payload")
        }
        id = Int64(idNum)
        first_name = payload["first_name"] as? String
        last_name = payload["last_name"] as? String
        username = payload["username"] as? String
        photo_url = payload["photo_url"] as? String
        if let ad = payload["auth_date"] as? Int { auth_date = Int64(ad) }
        else if let ad = payload["auth_date"] as? Int64 { auth_date = ad }
        else { throw GatewayError.network("invalid_telegram_auth_date") }
        guard let h = payload["hash"] as? String, !h.isEmpty else {
            throw GatewayError.network("invalid_telegram_hash")
        }
        hash = h
    }
}
