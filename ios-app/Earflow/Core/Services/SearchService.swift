import Foundation

actor SearchService {
    private let gateway: GatewayClient
    private var debounceTask: Task<SearchResponse, Error>?
    private var lastQuery = ""

    init(gateway: GatewayClient) {
        self.gateway = gateway
    }

    func search(query: String, publicOnly: Bool = false) async throws -> SearchResponse {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        let clipped = String(q.prefix(120))
        guard !clipped.isEmpty else {
            return SearchResponse(tracks: [], artists: [], albums: [])
        }

        if let existing = debounceTask, lastQuery == clipped, !existing.isCancelled {
            return try await existing.value
        }

        debounceTask?.cancel()
        lastQuery = clipped
        let task = Task<SearchResponse, Error> {
            try await Task.sleep(nanoseconds: 280_000_000)
            try Task.checkCancellation()
            var components = URLComponents()
            components.path = "/api/search/v1"
            components.queryItems = [
                URLQueryItem(name: "q", value: clipped),
                URLQueryItem(name: "limit", value: "20"),
                URLQueryItem(name: "offset", value: "0"),
            ]
            let path = components.percentEncodedPath + (components.percentEncodedQuery.map { "?\($0)" } ?? "")
            await EarflowLog.shared.info("search", "GET \(path)")
            return try await self.gateway.request(method: .get, path: path, skipAuth: publicOnly)
        }
        debounceTask = task
        return try await task.value
    }
}
