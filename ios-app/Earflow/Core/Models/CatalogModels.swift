import Foundation

struct TrackItem: Codable, Sendable, Identifiable, Hashable {
    let id: Int
    let title: String?
    let artist: String?
    let album: String?
    let coverUrl: String?
    let coverPath: String?
    let duration: Int?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Без названия" : t
    }

    var displayArtist: String {
        let a = artist?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return a.isEmpty ? "Неизвестный артист" : a
    }

    var resolvedCoverPath: String? {
        let u = coverUrl?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !u.isEmpty { return u }
        let p = coverPath?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return p.isEmpty ? nil : p
    }

    enum CodingKeys: String, CodingKey {
        case id, title, artist, album, duration
        case coverUrl
        case cover_url
        case coverPath = "cover_path"
    }

    init(id: Int, title: String?, artist: String?, album: String? = nil, coverUrl: String? = nil, coverPath: String? = nil, duration: Int? = nil) {
        self.id = id
        self.title = title
        self.artist = artist
        self.album = album
        self.coverUrl = coverUrl
        self.coverPath = coverPath
        self.duration = duration
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let intId = try? c.decode(Int.self, forKey: .id) {
            id = intId
        } else if let strId = try? c.decode(String.self, forKey: .id), let parsed = Int(strId) {
            id = parsed
        } else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "missing id")
        }
        title = try c.decodeIfPresent(String.self, forKey: .title)
        artist = try c.decodeIfPresent(String.self, forKey: .artist)
        album = try c.decodeIfPresent(String.self, forKey: .album)
        duration = try c.decodeIfPresent(Int.self, forKey: .duration)
        coverUrl = try c.decodeIfPresent(String.self, forKey: .coverUrl)
            ?? c.decodeIfPresent(String.self, forKey: .cover_url)
        coverPath = try c.decodeIfPresent(String.self, forKey: .coverPath)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(artist, forKey: .artist)
        try c.encodeIfPresent(album, forKey: .album)
        try c.encodeIfPresent(duration, forKey: .duration)
        try c.encodeIfPresent(coverUrl, forKey: .coverUrl)
        try c.encodeIfPresent(coverPath, forKey: .coverPath)
    }
}

struct DiscoverPlaylist: Codable, Sendable, Identifiable {
    let playlistId: String
    let title: String?
    let name: String?
    let tracks: [TrackItem]?

    var id: String { playlistId }

    var displayTitle: String {
        let t = (title ?? name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "Плейлист" : t
    }

    enum CodingKeys: String, CodingKey {
        case playlistId = "id"
        case title, name, tracks
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let s = try? c.decode(String.self, forKey: .playlistId) {
            playlistId = s
        } else if let i = try? c.decode(Int.self, forKey: .playlistId) {
            playlistId = String(i)
        } else {
            playlistId = UUID().uuidString
        }
        title = try c.decodeIfPresent(String.self, forKey: .title)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        tracks = try c.decodeIfPresent([TrackItem].self, forKey: .tracks)
    }
}

struct DiscoverRail: Codable, Sendable, Identifiable {
    let railId: String?
    let key: String?
    let title: String?
    let playlists: [DiscoverPlaylist]?
    let tracks: [TrackItem]?

    var id: String { railId ?? key ?? title ?? UUID().uuidString }

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Подборка" : t
    }

    var flatTracks: [TrackItem] {
        if let tracks, !tracks.isEmpty { return tracks }
        return playlists?.flatMap { $0.tracks ?? [] } ?? []
    }

    enum CodingKeys: String, CodingKey {
        case railId = "id"
        case key, title, playlists, tracks
    }
}

struct DiscoverRailsResponse: Codable, Sendable {
    let seed: String?
    let rails: [DiscoverRail]?
}

struct SearchResponse: Codable, Sendable {
    let tracks: [TrackItem]?
    let artists: [SearchArtist]?
    let albums: [SearchAlbum]?

    init(tracks: [TrackItem]? = nil, artists: [SearchArtist]? = nil, albums: [SearchAlbum]? = nil) {
        self.tracks = tracks
        self.artists = artists
        self.albums = albums
    }
}

struct SearchArtist: Codable, Sendable, Identifiable {
    let artistId: String?
    let name: String?
    var id: String { artistId ?? name ?? UUID().uuidString }

    enum CodingKeys: String, CodingKey {
        case artistId = "id"
        case name
    }
}

struct SearchAlbum: Codable, Sendable, Identifiable {
    let albumId: String?
    let title: String?
    var id: String { albumId ?? title ?? UUID().uuidString }

    enum CodingKeys: String, CodingKey {
        case albumId = "id"
        case title
    }
}

struct SocialFeedResponse: Codable, Sendable {
    let posts: [SocialPostDTO]?
    let page: SocialFeedPage?
}

struct SocialFeedPage: Codable, Sendable {
    let nextCursor: String?
    let hasMore: Bool?
}

struct SocialPostDTO: Codable, Sendable, Identifiable {
    let id: String
    let title: String?
    let body: String?
    let createdAtLabel: String?
    let author: SocialAuthorDTO?
    let metrics: SocialMetricsDTO?
    let viewer: SocialViewerDTO?

    var displayText: String {
        let b = body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !b.isEmpty { return b }
        return title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}

struct SocialAuthorDTO: Codable, Sendable {
    let displayName: String?
    let avatarUrl: String?
    let initials: String?
}

struct SocialMetricsDTO: Codable, Sendable {
    let likes: Int?
}

struct SocialViewerDTO: Codable, Sendable {
    let liked: Bool?
    let canManage: Bool?
}
