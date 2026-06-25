import Foundation

/// Opaque media/WS stream tickets — mirrors `frontend/src/auth/streamTicket.js` (RAM only).
actor StreamTicketService {
    private let gateway: GatewayClient
    private var mediaCache: [String: CachedTicket] = [:]
    private var wsCache: [String: CachedTicket] = [:]

    init(gateway: GatewayClient) {
        self.gateway = gateway
    }

    func clearCache() {
        mediaCache.removeAll()
        wsCache.removeAll()
    }

    /// Best-effort `?st=` on playback URLs when gateway mint is enabled (404 → skip).
    /// HLS (`/api/ebap-hls/`) uses signed `token` + `mp_hls` cookie only — web parity; `st` breaks adapter auth.
    func attachMediaTicketIfAvailable(
        masterURL: URL,
        sessionId: String,
        trackId: Int
    ) async -> URL {
        guard Self.mediaTicketApplies(to: masterURL) else {
            return masterURL
        }
        guard let ticket = await mintMediaTicket(sessionId: sessionId, trackId: trackId) else {
            return masterURL
        }
        return StreamTicketURL.attach(masterURL, ticket: ticket)
    }

    /// Direct stream / WS — not EBAP HLS manifests (see `frontend/src/api/client.js` getSongHlsSession).
    private static func mediaTicketApplies(to url: URL) -> Bool {
        let path = url.path.lowercased()
        if path.contains("/api/ebap-hls/") { return false }
        return true
    }

    func mintMediaTicket(sessionId: String, trackId: Int) async -> String? {
        let sid = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sid.isEmpty, trackId > 0 else { return nil }

        let cacheKey = "\(sid):\(trackId)"
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        if let cached = mediaCache[cacheKey], cached.expiresAtMs > now + 5000 {
            return cached.ticket
        }

        do {
            let body = StreamTicketMintRequest(
                kind: "media",
                scope: StreamTicketScope(sessionId: sid, trackId: String(trackId), deviceId: nil),
                client: "ios-native"
            )
            let response: StreamTicketMintResponse = try await gateway.request(
                method: .post,
                path: "/api/auth/stream-ticket",
                body: body
            )
            guard let ticket = response.ticket?.trimmingCharacters(in: .whitespacesAndNewlines), !ticket.isEmpty else {
                return nil
            }
            let expiresIn = response.expiresIn ?? 60
            let expiresAtMs = now + Int64(expiresIn) * 1000
            mediaCache[cacheKey] = CachedTicket(ticket: ticket, expiresAtMs: expiresAtMs)
            return ticket
        } catch let error as GatewayError {
            if case .unauthorized(let detail) = error, detail.status == 404 {
                return nil
            }
            return nil
        } catch {
            return nil
        }
    }

    private struct CachedTicket: Sendable {
        let ticket: String
        let expiresAtMs: Int64
    }
}

enum StreamTicketURL {
    static func attach(_ url: URL, ticket: String) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }
        var items = components.queryItems ?? []
        items.removeAll { $0.name == "st" }
        items.append(URLQueryItem(name: "st", value: ticket))
        components.queryItems = items
        return components.url ?? url
    }
}

struct StreamTicketScope: Encodable, Sendable {
    let sessionId: String?
    let trackId: String?
    let deviceId: String?
}

struct StreamTicketMintRequest: Encodable, Sendable {
    let kind: String
    let scope: StreamTicketScope
    let client: String
}

struct StreamTicketMintResponse: Decodable, Sendable {
    let ticket: String?
    let expiresIn: Int?
}
