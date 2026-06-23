import CryptoKit
import Foundation

/// ECDSA P-256 device proof — canonical string must match `device_proof_crypto.go` / web `authDeviceCrypto.js`.
enum DeviceProofSigner {
    // MARK: - Canonical string (gateway contract)

    static func buildCanonicalProofString(
        method: String,
        url: String,
        timestamp: String,
        nonce: String,
        sidHash: String
    ) -> String {
        let path = proofPath(from: url)
        let query = proofQuery(from: url)
        return [
            "v1",
            method.uppercased(),
            path,
            query,
            timestamp,
            nonce,
            sidHash,
        ].joined(separator: "\n")
    }

    static func proofPath(from urlOrPath: String) -> String {
        let raw = urlOrPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return "/" }

        if raw.hasPrefix("http://") || raw.hasPrefix("https://"),
           let url = URL(string: raw) {
            return normalizePath(url.path)
        }

        let withoutQuery = raw.split(separator: "?", maxSplits: 1).first.map(String.init) ?? raw
        return normalizePath(withoutQuery)
    }

    static func proofQuery(from urlOrPath: String) -> String {
        let raw = urlOrPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let queryString: String
        if raw.hasPrefix("http://") || raw.hasPrefix("https://"),
           let url = URL(string: raw) {
            queryString = url.query ?? ""
        } else if let idx = raw.firstIndex(of: "?") {
            queryString = String(raw[raw.index(after: idx)...])
        } else {
            return ""
        }
        return normalizeQuery(queryString)
    }

    // MARK: - Identity

    static func generateAuthDeviceId() -> String {
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let b64 = Data(bytes).base64URLEncodedString()
        return String("adev_\(b64)".prefix(64))
    }

    static func generateNonce() -> String {
        generateAuthDeviceId().replacingOccurrences(of: "adev_", with: "nonce_")
    }

    static func generateKeyPair() throws -> (privateKey: P256.Signing.PrivateKey, publicKeySpki: String) {
        let privateKey = P256.Signing.PrivateKey()
        let spki = privateKey.publicKey.derRepresentation.base64URLEncodedString()
        return (privateKey, spki)
    }

    static func importPrivateKey(pkcs8: Data) throws -> P256.Signing.PrivateKey {
        try P256.Signing.PrivateKey(derRepresentation: pkcs8)
    }

    static func exportPrivateKeyPKCS8(_ privateKey: P256.Signing.PrivateKey) -> Data {
        privateKey.derRepresentation
    }

    // MARK: - Signing

    static func sign(
        privateKey: P256.Signing.PrivateKey,
        method: String,
        url: String,
        sidHash: String
    ) throws -> DeviceProofHeaders {
        let ts = String(Int(Date().timeIntervalSince1970))
        let nonce = generateNonce()
        let canonical = buildCanonicalProofString(
            method: method,
            url: url,
            timestamp: ts,
            nonce: nonce,
            sidHash: sidHash
        )
        let signature = try privateKey.signature(for: Data(canonical.utf8))
        return DeviceProofHeaders(
            deviceId: "",
            proof: signature.rawRepresentation.base64URLEncodedString(),
            timestamp: ts,
            nonce: nonce
        )
    }

    // MARK: - Helpers

    private static func normalizePath(_ path: String) -> String {
        var p = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if p.isEmpty { return "/" }
        if !p.hasPrefix("/") { p = "/\(p)" }
        return p
    }

    private static func normalizeQuery(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: CharacterSet(charactersIn: "?"))
        guard !trimmed.isEmpty else { return "" }

        var items: [(String, String)] = []
        for pair in trimmed.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard let key = parts.first else { continue }
            let value = parts.count > 1 ? parts[1] : ""
            items.append((key, value))
        }
        items.sort { lhs, rhs in
            if lhs.0 != rhs.0 { return lhs.0 < rhs.0 }
            return lhs.1 < rhs.1
        }
        return items.map { key, value in
            "\(key.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? key)=\(value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value)"
        }.joined(separator: "&")
    }
}

struct DeviceProofHeaders: Sendable {
    var deviceId: String
    let proof: String
    let timestamp: String
    let nonce: String

    func asHTTPHeaders() -> [String: String] {
        [
            "X-Auth-Device-Id": deviceId,
            "X-Auth-Device-Proof": proof,
            "X-Auth-Device-Proof-Ts": timestamp,
            "X-Auth-Device-Proof-Nonce": nonce,
        ]
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
