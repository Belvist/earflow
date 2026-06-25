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

    func fetchDiscoverRails(seed: String = DiscoverSeed.current(), publicOnly: Bool = false) async throws -> DiscoverRailsResponse {
        var path = "/api/playlists/discover"
        if !seed.isEmpty {
            path += "?seed=\(seed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? seed)"
        }
        await EarflowLog.shared.info("catalog", "GET \(path) publicOnly=\(publicOnly)")
        return try await gateway.request(
            method: .get,
            path: path,
            skipAuth: publicOnly
        )
    }

    func fetchLikes() async throws -> [TrackItem] {
        await EarflowLog.shared.debug("catalog", "GET /api/likes")
        let data = try await gateway.requestData(method: .get, path: "/api/likes")
        return try Self.decodeLikesPayload(data)
    }

    /// Backend returns a JSON array (same as web `apiClient.getLikes()`).
    private static func decodeLikesPayload(_ data: Data) throws -> [TrackItem] {
        let decoder = JSONDecoder()
        if let array = try? decoder.decode([TrackItem].self, from: data) {
            return array
        }
        struct LikesEnvelope: Decodable {
            let songs: [TrackItem]?
            let tracks: [TrackItem]?
        }
        if let envelope = try? decoder.decode(LikesEnvelope.self, from: data) {
            return envelope.songs ?? envelope.tracks ?? []
        }
        throw GatewayError.decodingFailed
    }

    func fetchPopularArtists(limit: Int = 12) async throws -> [PopularArtistItem] {
        let safe = min(max(limit, 1), 48)
        let path = "/api/artists/popular?limit=\(safe)&offset=0"
        await EarflowLog.shared.debug("catalog", "GET \(path)")
        let response: PopularArtistsResponse = try await gateway.request(method: .get, path: path)
        return response.resolved
    }

    func fetchUserPlaylists() async throws -> [DiscoverPlaylist] {
        await EarflowLog.shared.debug("catalog", "GET /api/playlists")
        let response: UserPlaylistsResponse = try await gateway.request(method: .get, path: "/api/playlists")
        return response.playlists ?? []
    }

    func fetchPlaylist(id: String) async throws -> DiscoverPlaylist {
        let path = "/api/playlists/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
        await EarflowLog.shared.debug("catalog", "GET \(path)")
        return try await gateway.request(method: .get, path: path)
    }

    func resolveAlbumPublicId(artist: String, albumName: String) async throws -> String? {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "artist", value: artist),
            URLQueryItem(name: "albumName", value: albumName),
        ]
        let qs = components.percentEncodedQuery.map { "?\($0)" } ?? ""
        let path = "/api/albums/resolve\(qs)"
        await EarflowLog.shared.debug("catalog", "GET \(path)")
        let response: AlbumResolveResponse = try await gateway.request(method: .get, path: path)
        return response.resolvedId
    }

    func fetchAlbum(publicId: String) async throws -> AlbumMeta {
        let encoded = publicId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? publicId
        let path = "/api/albums/\(encoded)"
        await EarflowLog.shared.debug("catalog", "GET \(path)")
        return try await gateway.request(method: .get, path: path)
    }

    func fetchAlbumTracks(publicId: String, limit: Int = 500) async throws -> [TrackItem] {
        let encoded = publicId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? publicId
        let path = "/api/albums/\(encoded)/tracks?limit=\(min(max(limit, 1), 500))"
        await EarflowLog.shared.debug("catalog", "GET \(path)")
        return try await gateway.request(method: .get, path: path)
    }

    func likeTrack(id: Int) async throws {
        let path = "/api/likes/\(id)"
        await EarflowLog.shared.debug("catalog", "POST \(path)")
        _ = try await gateway.requestData(method: .post, path: path)
    }

    func unlikeTrack(id: Int) async throws {
        let path = "/api/likes/\(id)"
        await EarflowLog.shared.debug("catalog", "DELETE \(path)")
        _ = try await gateway.requestData(method: .delete, path: path)
    }
}
