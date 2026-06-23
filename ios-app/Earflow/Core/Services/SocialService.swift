import Foundation

actor SocialService {
    private let gateway: GatewayClient

    init(gateway: GatewayClient) {
        self.gateway = gateway
    }

    func fetchFeed(limit: Int = 20) async throws -> SocialFeedResponse {
        let path = "/api/social/feed?limit=\(min(limit, 50))"
        await EarflowLog.shared.info("social", "GET \(path)")
        return try await gateway.request(method: .get, path: path)
    }
}
