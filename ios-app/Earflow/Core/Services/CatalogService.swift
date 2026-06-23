import Foundation

actor CatalogService {
    private let gateway: GatewayClient

    init(gateway: GatewayClient) {
        self.gateway = gateway
    }

    func fetchPublicConfig() async throws -> PublicConfigResponse {
        await EarflowLog.shared.debug("catalog", "GET /api/public-config")
        return try await gateway.request(method: .get, path: "/api/public-config", skipAuth: true)
    }

    func fetchDiscoverRails(seed: String = "") async throws -> DiscoverRailsResponse {
        var path = "/api/playlists/discover"
        if !seed.isEmpty {
            path += "?seed=\(seed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? seed)"
        }
        await EarflowLog.shared.info("catalog", "GET \(path)")
        return try await gateway.request(method: .get, path: path)
    }

    func fetchLikes() async throws -> [TrackItem] {
        struct LikesResponse: Decodable { let songs: [TrackItem]?; let tracks: [TrackItem]? }
        await EarflowLog.shared.debug("catalog", "GET /api/likes")
        let response: LikesResponse = try await gateway.request(method: .get, path: "/api/likes")
        return response.songs ?? response.tracks ?? []
    }
}
