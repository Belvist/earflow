import Foundation

/// Push-навигация как web `react-router` `/playlist/:id` и `/album/:pid`.
enum CatalogNavigationRoute: Hashable {
    case playlist(DiscoverPlaylist)
    case album(AlbumNavigationSeed)
}

/// Seed для `AlbumPage` — public id или artist+name (web `navigateToAlbumFromTrack`).
struct AlbumNavigationSeed: Hashable {
    var albumPublicId: String?
    var artist: String
    var albumName: String

    static func from(track: TrackItem) -> AlbumNavigationSeed? {
        let artist = track.displayArtist
        let album = (track.album ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !album.isEmpty, artist != "Неизвестный артист" else { return nil }
        let pid = track.albumPublicId?.trimmingCharacters(in: .whitespacesAndNewlines)
        return AlbumNavigationSeed(
            albumPublicId: pid?.isEmpty == false ? pid : nil,
            artist: artist,
            albumName: album
        )
    }
}
