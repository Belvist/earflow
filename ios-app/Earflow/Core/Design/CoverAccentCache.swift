import UIKit

actor CoverAccentCache {
    static let shared = CoverAccentCache()

    private var cache: [String: CoverAccentColor.RGB?] = [:]
    private let cacheLimit = 64

    func load(from url: URL) async -> CoverAccentColor.RGB? {
        let key = url.absoluteString
        if let cached = cache[key] { return cached }

        let rgb: CoverAccentColor.RGB?
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let image = UIImage(data: data) else {
                rgb = nil
                store(key, rgb)
                return nil
            }
            rgb = CoverAccentColor.extractDominant(from: image)
        } catch {
            rgb = nil
        }
        store(key, rgb)
        return rgb
    }

    private func store(_ key: String, _ value: CoverAccentColor.RGB?) {
        if cache.count >= cacheLimit, let first = cache.keys.first {
            cache.removeValue(forKey: first)
        }
        cache[key] = value
    }
}
