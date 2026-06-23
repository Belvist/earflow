import Foundation

actor SearchService {
    private let gateway: GatewayClient
    private var debounceTask: Task<SearchResponse, Error>?
    private var lastQuery = ""

    init(gateway: GatewayClient) {
        self.gateway = gateway
    }

    func search(query: String) async throws -> SearchResponse {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        let clipped = String(q.prefix(120))
        guard !clipped.isEmpty else {
            return SearchResponse(tracks: [], artists: [], albums: [])
        }

        if let existing = debounceTask, lastQuery == clipped {
            return try await existing.value
        }

        lastQuery = clipped
        let task = Task<SearchResponse, Error> {
            try await Task.sleep(nanoseconds: 280_000_000)
            let encoded = clipped.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? clipped
            let path = "/api/search/v1?q=\(encoded)&limit=20&offset=0"
            await EarflowLog.shared.info("search", "GET \(path)")
            return try await self.gateway.request(method: .get, path: path)
        }
        debounceTask = task
        return try await task.value
    }
}
