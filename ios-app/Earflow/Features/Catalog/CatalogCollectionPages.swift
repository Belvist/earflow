import SwiftUI

/// Отдельная страница плейлиста — web `PlaylistPage.js` (`/playlist/:id`), не sheet.
struct PlaylistPageView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var playbackCoordinator: PlaybackCoordinator
    @EnvironmentObject private var authPresentation: AppAuthPresentation
    @Environment(\.shellChromeMetrics) private var shellChromeMetrics

    let preview: DiscoverPlaylist

    @State private var playlist: DiscoverPlaylist?
    @State private var tracks: [TrackItem] = []
    @State private var isLoading = true
    @State private var loadError: String?

    private var displayTitle: String {
        (playlist ?? preview).displayTitle
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                heroHeader
                if isLoading {
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                } else if let loadError {
                    CatalogPageError(message: loadError) {
                        Task { await load() }
                    }
                } else if tracks.isEmpty {
                    Text("В плейлисте пока нет треков")
                        .font(EarflowFont.caption)
                        .foregroundStyle(EarflowTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                } else {
                    trackSection
                }
            }
            .padding(.bottom, shellChromeMetrics.bottomInset)
        }
        .background(EarflowTheme.surfaceMain)
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle("Плейлист")
        .task { await load() }
    }

    private var heroHeader: some View {
        VStack(spacing: 16) {
            Group {
                if let first = tracks.first ?? preview.tracks?.first {
                    TrackCoverView.portrait(track: first, width: 170, cornerRadius: 14)
                } else {
                    RoundedRectangle(cornerRadius: 14)
                        .fill(Color.white.opacity(0.08))
                        .frame(width: 170, height: 170 * EarflowTheme.portraitCoverRatio)
                }
            }

            VStack(spacing: 6) {
                Text("Плейлист")
                    .font(EarflowFont.unbounded(size: 12, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .textCase(.uppercase)
                Text(displayTitle)
                    .font(EarflowFont.unbounded(size: 22, weight: .black))
                    .foregroundStyle(EarflowTheme.textPrimary)
                    .multilineTextAlignment(.center)
                if !tracks.isEmpty {
                    Text("\(tracks.count) треков")
                        .font(EarflowFont.caption)
                        .foregroundStyle(EarflowTheme.textSecondary)
                }
            }

            if let first = tracks.first {
                Button {
                    Task { await play(track: first, queue: tracks) }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "play.fill")
                        Text("Слушать")
                            .font(EarflowFont.unbounded(size: 13, weight: .bold))
                    }
                    .foregroundStyle(.black)
                    .padding(.horizontal, 22)
                    .frame(height: 44)
                    .background(Capsule().fill(Color.white))
                }
                .buttonStyle(.plain)
                .disabled(tracks.isEmpty)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
    }

    private var trackSection: some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                EarflowPlaylistTrackRow(
                    index: index + 1,
                    track: track,
                    isCurrent: playbackCoordinator.nowPlaying?.id == track.id,
                    isPlaying: isPlaylistTrackPlaying(track)
                ) {
                    Task { await playFrom(index: index) }
                }
            }
        }
        .padding(.horizontal, 4)
    }

    private func isPlaylistTrackPlaying(_ track: TrackItem) -> Bool {
        guard playbackCoordinator.nowPlaying?.id == track.id else { return false }
        switch playbackCoordinator.state {
        case .playing, .buffering: return true
        default: return false
        }
    }

    private func load() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }

        if let embedded = preview.tracks, !embedded.isEmpty {
            playlist = preview
            tracks = embedded
            return
        }

        do {
            let detail = try await dependencies.catalog.fetchPlaylist(id: preview.playlistId)
            playlist = detail
            tracks = detail.tracks ?? []
        } catch {
            loadError = "Не удалось загрузить плейлист"
            await EarflowLog.shared.warning("playlist", "load \(preview.playlistId): \(error)")
        }
    }

    private func playFrom(index: Int) async {
        guard !tracks.isEmpty else { return }
        let start = max(0, min(tracks.count - 1, index))
        let queue = Array(tracks[start...]) + Array(tracks[..<start])
        await play(track: queue[0], queue: queue)
    }

    private func play(track: TrackItem, queue: [TrackItem]) async {
        guard await authPresentation.guardAuthenticated(
            auth: dependencies.auth,
            reason: "Войдите, чтобы слушать."
        ) else { return }
        await playbackCoordinator.replaceQueue(queue, startAt: track)
    }
}

/// Отдельная страница альбома — web `AlbumPage.js` (`/album/:pid`).
struct AlbumPageView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var playbackCoordinator: PlaybackCoordinator
    @EnvironmentObject private var authPresentation: AppAuthPresentation
    @Environment(\.shellChromeMetrics) private var shellChromeMetrics

    let seed: AlbumNavigationSeed

    @State private var meta: AlbumMeta?
    @State private var tracks: [TrackItem] = []
    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                heroHeader
                if isLoading {
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                } else if let loadError {
                    CatalogPageError(message: loadError) {
                        Task { await load() }
                    }
                } else if tracks.isEmpty {
                    Text("Альбом не найден")
                        .font(EarflowFont.caption)
                        .foregroundStyle(EarflowTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                } else {
                    trackSection
                }
            }
            .padding(.bottom, shellChromeMetrics.bottomInset)
        }
        .background(EarflowTheme.surfaceMain)
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle("Альбом")
        .task { await load() }
    }

    private var heroHeader: some View {
        VStack(spacing: 16) {
            Group {
                if let track = tracks.first {
                    TrackCoverView.portrait(track: track, width: 170, cornerRadius: 14)
                } else {
                    RoundedRectangle(cornerRadius: 14)
                        .fill(Color.white.opacity(0.08))
                        .frame(width: 170, height: 170 * EarflowTheme.portraitCoverRatio)
                }
            }

            VStack(spacing: 6) {
                Text("Альбом")
                    .font(EarflowFont.unbounded(size: 12, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .textCase(.uppercase)
                Text(meta?.displayAlbumName ?? seed.albumName)
                    .font(EarflowFont.unbounded(size: 22, weight: .black))
                    .foregroundStyle(EarflowTheme.textPrimary)
                    .multilineTextAlignment(.center)
                let artist = meta?.displayArtistName ?? seed.artist
                if !artist.isEmpty {
                    Text(artist)
                        .font(EarflowFont.unbounded(size: 12, weight: .medium))
                        .foregroundStyle(EarflowTheme.textSecondary)
                }
                if !tracks.isEmpty {
                    Text("\(tracks.count) треков")
                        .font(EarflowFont.caption)
                        .foregroundStyle(EarflowTheme.textSecondary)
                }
            }

            if !tracks.isEmpty {
                Button {
                    Task { await playAll() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "play.fill")
                        Text("Играть")
                            .font(EarflowFont.unbounded(size: 13, weight: .bold))
                    }
                    .foregroundStyle(.black)
                    .padding(.horizontal, 22)
                    .frame(height: 44)
                    .background(Capsule().fill(Color.white))
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
    }

    private var trackSection: some View {
        LazyVStack(spacing: 2) {
            ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                AlbumTrackRow(
                    index: index + 1,
                    track: track,
                    isActive: playbackCoordinator.nowPlaying?.id == track.id,
                    isPlaying: playbackCoordinator.state == .playing
                ) {
                    Task { await play(track: track) }
                }
            }
        }
        .padding(.horizontal, 12)
    }

    private func load() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }

        do {
            let publicId: String
            if let pid = seed.albumPublicId, !pid.isEmpty {
                publicId = pid
            } else if let resolved = try await dependencies.catalog.resolveAlbumPublicId(
                artist: seed.artist,
                albumName: seed.albumName
            ) {
                publicId = resolved
            } else {
                loadError = "Альбом не найден"
                return
            }

            async let metaTask = dependencies.catalog.fetchAlbum(publicId: publicId)
            async let tracksTask = dependencies.catalog.fetchAlbumTracks(publicId: publicId)
            meta = try await metaTask
            tracks = try await tracksTask
        } catch {
            loadError = "Не удалось загрузить альбом"
            await EarflowLog.shared.warning("album", "load: \(error)")
        }
    }

    private func playAll() async {
        guard let first = tracks.first else { return }
        await play(track: first, queue: tracks)
    }

    private func play(track: TrackItem) async {
        await play(track: track, queue: tracks)
    }

    private func play(track: TrackItem, queue: [TrackItem]) async {
        guard await authPresentation.guardAuthenticated(
            auth: dependencies.auth,
            reason: "Войдите, чтобы слушать."
        ) else { return }
        await playbackCoordinator.replaceQueue(queue, startAt: track)
    }
}

private struct CatalogPageError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text(message)
                .font(EarflowFont.caption)
                .foregroundStyle(EarflowTheme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Обновить", action: onRetry)
                .font(EarflowFont.unbounded(size: 12, weight: .bold))
                .foregroundStyle(EarflowTheme.textPrimary)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
    }
}
