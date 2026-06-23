import Foundation

enum MediaURLResolver {
  static func coverURL(from path: String?) -> URL? {
    guard let raw = path?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
      return nil
    }
    if raw.lowercased().hasPrefix("http://") || raw.lowercased().hasPrefix("https://") {
      return URL(string: raw)
    }
    let filename = (raw as NSString).lastPathComponent
    guard !filename.isEmpty else { return nil }
    let encoded = filename.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? filename
    return URL(string: "https://earflow.ru/covers/\(encoded)")
  }

  static func trackCover(_ track: TrackItem) -> URL? {
    coverURL(from: track.resolvedCoverPath)
  }
}
