import SwiftUI

/// Mobile home — parity with web `MusicPlayer.js` → `MobileHomeRoot`.
struct HomeView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var playbackCoordinator: PlaybackCoordinator
    @EnvironmentObject private var authPresentation: AppAuthPresentation
    @Environment(\.appShellMode) private var shellMode
    @Environment(\.shellChromeMetrics) private var shellChromeMetrics

    @State private var category: HomeCategory = .forYou
    @State private var queueSource: HomeQueueSource = .recommendations
    @State private var rails: [DiscoverRail] = []
    @State private var likes: [TrackItem] = []
    @State private var userPlaylists: [DiscoverPlaylist] = []
    @State private var popularArtists: [PopularArtistItem] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var deferredSectionsReady = false
    @State private var catalogPath = NavigationPath()

    private var coordinator: PlaybackCoordinator { playbackCoordinator }

    var body: some View {
        NavigationStack(path: $catalogPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HomeCategoryTabs(selection: $category)
                        .padding(.top, 4)
                        .onChange(of: category) { _, newValue in
                            handleCategoryChange(newValue)
                        }

                    content
                }
                .padding(.horizontal, 12)
                .padding(.bottom, shellChromeMetrics.bottomInset)
            }
            .background(EarflowTheme.surfaceMain)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Earflow")
                        .font(EarflowFont.unbounded(size: 17, weight: .black))
                        .foregroundStyle(EarflowTheme.textPrimary)
                }
            }
            .navigationDestination(for: CatalogNavigationRoute.self) { route in
                switch route {
                case .playlist(let preview):
                    PlaylistPageView(preview: preview)
                        .environmentObject(dependencies)
                        .environmentObject(playbackCoordinator)
                        .environmentObject(authPresentation)
                case .album(let seed):
                    AlbumPageView(seed: seed)
                        .environmentObject(dependencies)
                        .environmentObject(playbackCoordinator)
                        .environmentObject(authPresentation)
                }
            }
            .refreshable { await loadContent() }
            .task {
                await loadContent()
                scheduleDeferredSections()
            }
            .onChange(of: shellMode) { _, _ in
                Task { await loadContent() }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if shellMode.isGuest {
            HomeQueueStatusCard(kind: .guestLogin) {
                authPresentation.presentLogin(reason: "Рекомендации и плеер доступны после авторизации.")
            }
        } else if isLoading && queueSource == .recommendations {
            HomeQueueStatusCard(kind: .recommendationsLoading, onAction: nil)
        } else if let loadError {
            HomeQueueStatusCard(kind: .loadError(loadError)) {
                Task { await loadContent() }
            }
        } else if queueSource == .liked {
            likedSection
        } else if recommendationTracks.isEmpty {
            HomeQueueStatusCard(kind: .tracksEmpty) {
                Task { await loadContent() }
            }
        } else {
            forYouSection
        }
    }

    @ViewBuilder
    private var forYouSection: some View {
        VStack(alignment: .leading, spacing: EarflowTheme.homeRailSpacing) {
            if let heroTrack = coordinator.nowPlaying ?? recommendationTracks.first {
                HomeMobileHeroView(
                    track: heroTrack,
                    isPlaying: isPlayingState,
                    progressFraction: coordinator.progress.fraction,
                    showReason: shellMode.isAuthenticated,
                    onOpenPlayer: { coordinator.sheetExpanded = true },
                    onTogglePlay: { Task { await coordinator.togglePlayPause() } },
                    onTitleNavigate: albumSeed(for: heroTrack).map { seed in
                        { catalogPath.append(CatalogNavigationRoute.album(seed)) }
                    },
                    onSwipePrevious: { Task { await coordinator.playPrevious() } },
                    onSwipeNext: { Task { await coordinator.playNext() } }
                )
            }

            if recommendationTracks.count > 1 {
                HomeForYouTrackList(
                    tracks: recommendationTracks,
                    currentTrackId: coordinator.nowPlaying?.id,
                    onPlay: { track in Task { await playTrack(track) } }
                )
            }

            HomeMoodChipsSection()

            if !deferredSectionsReady {
                HomeDeferredRailSkeleton()
            } else {
                ForEach(rails) { rail in
                    if let playlists = rail.playlists, !playlists.isEmpty {
                        HorizontalPlaylistRail(
                            title: HomeDiscoverFormat.railTitle(rail.displayTitle),
                            playlists: Array(playlists.prefix(10))
                        )
                    } else {
                        let tracks = rail.flatTracks
                        if !tracks.isEmpty {
                            HorizontalTrackRail(
                                title: HomeDiscoverFormat.railTitle(rail.displayTitle),
                                tracks: Array(tracks.prefix(20))
                            ) { track in
                                Task { await playTrack(track) }
                            }
                        }
                    }
                }

                if !popularArtists.isEmpty {
                    HomePopularArtistsSection(artists: popularArtists)
                }

                if !userPlaylists.isEmpty {
                    HorizontalPlaylistRail(
                        title: "Мои плейлисты",
                        playlists: Array(userPlaylists.prefix(10)),
                        compactTop: true
                    )
                }
            }
        }
        .padding(.top, 8)
    }

    @ViewBuilder
    private var likedSection: some View {
        if likes.isEmpty {
            HomeQueueStatusCard(kind: .likedEmpty) {
                Task { await loadContent() }
            }
        } else {
            HomeForYouTrackList(
                tracks: likes,
                currentTrackId: coordinator.nowPlaying?.id,
                onPlay: { track in Task { await playTrack(track) } }
            )
        }
    }

    private var recommendationTracks: [TrackItem] {
        var seen = Set<Int>()
        var ordered: [TrackItem] = []
        if let current = coordinator.nowPlaying {
            ordered.append(current)
            seen.insert(current.id)
        }
        for track in likes + rails.flatMap(\.flatTracks) {
            guard !seen.contains(track.id) else { continue }
            seen.insert(track.id)
            ordered.append(track)
        }
        return ordered
    }

    private var isPlayingState: Bool {
        switch coordinator.state {
        case .playing, .buffering: return true
        default: return false
        }
    }

    private func handleCategoryChange(_ tab: HomeCategory) {
        switch tab {
        case .forYou:
            queueSource = .recommendations
        case .liked:
            if shellMode.isGuest {
                authPresentation.presentLogin(reason: "Войдите, чтобы открыть избранное.")
                category = .forYou
            } else {
                queueSource = .liked
            }
        case .newReleases:
            dependencies.shellNavigation.openSearch()
            category = .forYou
        }
    }

    private func scheduleDeferredSections() {
        deferredSectionsReady = false
        Task {
            try? await Task.sleep(for: .milliseconds(900))
            deferredSectionsReady = true
        }
    }

    private func loadContent() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }

        guard !shellMode.isGuest else {
            rails = []
            likes = []
            userPlaylists = []
            popularArtists = []
            coordinator.setLikedTrackIds([])
            return
        }

        guard NetworkMonitor.isReachable else {
            loadError = "Нет интернета. Проверьте сеть и повторите."
            return
        }

        do {
            async let railsTask = dependencies.catalog.fetchDiscoverRails()
            async let likesTask = dependencies.catalog.fetchLikes()
            async let playlistsTask = dependencies.catalog.fetchUserPlaylists()
            async let artistsTask = dependencies.catalog.fetchPopularArtists(limit: 12)

            let discover = try await railsTask
            rails = discover.rails ?? []

            do {
                likes = try await likesTask
                coordinator.setLikedTrackIds(Set(likes.map(\.id)))
            } catch {
                likes = []
                await EarflowLog.shared.warning("home", "likes load failed: \(error)")
            }

            do {
                userPlaylists = try await playlistsTask
            } catch {
                userPlaylists = []
            }

            do {
                popularArtists = try await artistsTask
            } catch {
                popularArtists = []
            }

            coordinator.syncQueue(recommendationTracks)
        } catch {
            loadError = Self.loadErrorMessage(for: error)
            await EarflowLog.shared.error("home", String(describing: error))
        }
    }

    private static func loadErrorMessage(for error: Error) -> String {
        guard let gateway = error as? GatewayError else {
            return "Не удалось загрузить рекомендации."
        }
        switch gateway {
        case .unauthorized, .forbidden:
            return "Сессия истекла. Войдите снова."
        case .network, .maxRetriesExceeded:
            return "Нет связи с сервером. Проверьте сеть и повторите."
        case .decodingFailed:
            return "Не удалось разобрать ответ сервера."
        case .invalidURL:
            return "Ошибка адреса API. Обновите приложение."
        default:
            return "Не удалось загрузить рекомендации."
        }
    }

    private func playTrack(_ track: TrackItem) async {
        guard await authPresentation.guardAuthenticated(
            auth: dependencies.auth,
            reason: "Войдите, чтобы слушать."
        ) else { return }
        let queue = queueSource == .liked ? likes : recommendationTracks
        await coordinator.replaceQueue(queue.isEmpty ? [track] : queue, startAt: track)
    }

    private func albumSeed(for track: TrackItem) -> AlbumNavigationSeed? {
        AlbumNavigationSeed.from(track: track)
    }
}
