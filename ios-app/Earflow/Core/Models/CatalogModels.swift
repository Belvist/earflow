import Foundation

struct TrackItem: Codable, Sendable, Identifiable, Hashable {
    let id: Int
    let title: String?
    let artist: String?
    let album: String?
    let albumPublicId: String?
    let coverUrl: String?
    let coverPath: String?
    let duration: Int?
    let reason: String?

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
        case albumPublicId
        case album_public_id
        case reason
    }

    init(id: Int, title: String?, artist: String?, album: String? = nil, albumPublicId: String? = nil, coverUrl: String? = nil, coverPath: String? = nil, duration: Int? = nil, reason: String? = nil) {
        self.id = id
        self.title = title
        self.artist = artist
        self.album = album
        self.albumPublicId = albumPublicId
        self.coverUrl = coverUrl
        self.coverPath = coverPath
        self.duration = duration
        self.reason = reason
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
        albumPublicId = try c.decodeIfPresent(String.self, forKey: .albumPublicId)
            ?? c.decodeIfPresent(String.self, forKey: .album_public_id)
        duration = try c.decodeIfPresent(Int.self, forKey: .duration)
        coverUrl = try c.decodeIfPresent(String.self, forKey: .coverUrl)
            ?? c.decodeIfPresent(String.self, forKey: .cover_url)
        coverPath = try c.decodeIfPresent(String.self, forKey: .coverPath)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(artist, forKey: .artist)
        try c.encodeIfPresent(album, forKey: .album)
        try c.encodeIfPresent(albumPublicId, forKey: .albumPublicId)
        try c.encodeIfPresent(duration, forKey: .duration)
        try c.encodeIfPresent(coverUrl, forKey: .coverUrl)
        try c.encodeIfPresent(coverPath, forKey: .coverPath)
        try c.encodeIfPresent(reason, forKey: .reason)
    }
}

struct DiscoverPlaylist: Codable, Sendable, Identifiable, Hashable {
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

enum DiscoverSeed {
    /// Web `useDiscoverRails` — 6-hour UTC bucket.
    static func current() -> String {
        let bucket = Int(Date().timeIntervalSince1970) / (6 * 3600)
        return "bucket-\(bucket)"
    }
}

enum HomeDiscoverFormat {
    static func railTitle(_ title: String?) -> String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if t.isEmpty { return "Подборки" }
        if t.range(of: #"^для\s+вас$"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "Открытия для вас"
        }
        return t
    }
}

struct AlbumMeta: Codable, Sendable {
    let albumPublicId: String?
    let albumName: String?
    let artistName: String?
    let trackCount: Int?
    let year: Int?
    let heroCoverPath: String?

    var displayAlbumName: String {
        let n = (albumName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? "Альбом" : n
    }

    var displayArtistName: String {
        let n = (artistName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? "" : n
    }
}

struct AlbumResolveResponse: Codable, Sendable {
    let albumPublicId: String?
    let album_public_id: String?

    var resolvedId: String? {
        let a = albumPublicId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !a.isEmpty { return a.lowercased() }
        let b = album_public_id?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return b.isEmpty ? nil : b.lowercased()
    }
}

struct PopularArtistItem: Decodable, Sendable, Identifiable, Hashable {
    let artistName: String?
    let name: String?
    let coverUrl: String?
    let coverPath: String?
    let avatarCoverPath: String?
    let heroCoverPath: String?
    let isVerified: Bool?

    var id: String { displayName }

    var displayName: String {
        let n = (artistName ?? name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? "Артист" : n
    }

    var resolvedCoverPath: String? {
        [avatarCoverPath, heroCoverPath, coverPath, coverUrl]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
    }

    enum CodingKeys: String, CodingKey {
        case artistName, name, coverUrl, coverPath
        case avatarCoverPath = "avatar_cover_path"
        case heroCoverPath = "hero_cover_path"
        case isVerified
        case isVerifiedSnake = "is_verified"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        artistName = try c.decodeIfPresent(String.self, forKey: .artistName)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        coverUrl = try c.decodeIfPresent(String.self, forKey: .coverUrl)
        coverPath = try c.decodeIfPresent(String.self, forKey: .coverPath)
        avatarCoverPath = try c.decodeIfPresent(String.self, forKey: .avatarCoverPath)
        heroCoverPath = try c.decodeIfPresent(String.self, forKey: .heroCoverPath)
        isVerified = try c.decodeIfPresent(Bool.self, forKey: .isVerified)
            ?? c.decodeIfPresent(Bool.self, forKey: .isVerifiedSnake)
    }
}

struct PopularArtistsResponse: Decodable, Sendable {
    let artists: [PopularArtistItem]?
    let items: [PopularArtistItem]?

    var resolved: [PopularArtistItem] { artists ?? items ?? [] }
}

struct UserPlaylistsResponse: Decodable, Sendable {
    let playlists: [DiscoverPlaylist]?
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

    init(
        id: String,
        title: String? = nil,
        body: String? = nil,
        createdAtLabel: String? = nil,
        author: SocialAuthorDTO? = nil,
        metrics: SocialMetricsDTO? = nil,
        viewer: SocialViewerDTO? = nil
    ) {
        self.id = id
        self.title = title
        self.body = body
        self.createdAtLabel = createdAtLabel
        self.author = author
        self.metrics = metrics
        self.viewer = viewer
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let stringId = try? c.decode(String.self, forKey: .id) {
            id = stringId
        } else if let intId = try? c.decode(Int.self, forKey: .id) {
            id = String(intId)
        } else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "missing post id")
        }
        title = try c.decodeIfPresent(String.self, forKey: .title)
        body = try c.decodeIfPresent(String.self, forKey: .body)
        createdAtLabel = try c.decodeIfPresent(String.self, forKey: .createdAtLabel)
        author = try c.decodeIfPresent(SocialAuthorDTO.self, forKey: .author)
        metrics = try c.decodeIfPresent(SocialMetricsDTO.self, forKey: .metrics)
        viewer = try c.decodeIfPresent(SocialViewerDTO.self, forKey: .viewer)
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, body, createdAtLabel, author, metrics, viewer
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
