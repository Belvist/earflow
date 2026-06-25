import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var authPresentation: AppAuthPresentation
    @Environment(\.appShellMode) private var shellMode
    @State private var query = ""
    @State private var results = SearchResponse(tracks: [], artists: [], albums: [])
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var searchGeneration = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(EarflowTheme.textMuted)
                    TextField("Треки, артисты, альбомы…", text: $query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .foregroundStyle(EarflowTheme.textPrimary)
                        .onChange(of: query) { _, newValue in
                            searchGeneration += 1
                            let generation = searchGeneration
                            searchTask?.cancel()
                            searchTask = Task {
                                await performSearch(newValue, generation: generation)
                            }
                        }
                }
                .padding(14)
                .background(EarflowTheme.fieldBackground)
                .clipShape(RoundedRectangle(cornerRadius: EarflowTheme.fieldRadius))
                .padding(.horizontal, 16)
                .padding(.vertical, 12)

                if isSearching {
                    ProgressView().padding()
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(EarflowTheme.danger)
                        .padding(.horizontal, 16)
                }

                List {
                    if let artists = results.artists, !artists.isEmpty {
                        Section("Артисты") {
                            ForEach(artists) { artist in
                                Text(artist.name ?? "—")
                                    .foregroundStyle(EarflowTheme.textPrimary)
                            }
                        }
                    }
                    if let albums = results.albums, !albums.isEmpty {
                        Section("Альбомы") {
                            ForEach(albums) { album in
                                Text(album.title ?? "—")
                                    .foregroundStyle(EarflowTheme.textPrimary)
                            }
                        }
                    }
                    if let tracks = results.tracks, !tracks.isEmpty {
                        Section("Треки") {
                            ForEach(tracks) { track in
                                TrackRowView(track: track) {
                                    Task { await playTrack(track) }
                                }
                                .listRowBackground(EarflowTheme.background)
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
            .background(EarflowTheme.background)
            .navigationTitle("Поиск")
        }
    }

    private func performSearch(_ text: String, generation: Int) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            guard generation == searchGeneration else { return }
            results = SearchResponse(tracks: [], artists: [], albums: [])
            isSearching = false
            return
        }
        isSearching = true
        errorMessage = nil
        defer {
            if generation == searchGeneration {
                isSearching = false
            }
        }
        do {
            let response = try await dependencies.search.search(query: trimmed, publicOnly: shellMode.isGuest)
            guard !Task.isCancelled, generation == searchGeneration else { return }
            results = response
        } catch is CancellationError {
            return
        } catch {
            guard generation == searchGeneration else { return }
            errorMessage = shellMode.isGuest
                ? "Поиск может требовать вход. Нажмите «Войти» в профиле."
                : "Ошибка поиска."
            await EarflowLog.shared.error("search", error.localizedDescription)
        }
    }

    private func playTrack(_ track: TrackItem) async {
        guard await authPresentation.guardAuthenticated(
            auth: dependencies.auth,
            reason: "Войдите, чтобы слушать треки."
        ) else { return }
        await dependencies.playbackCoordinator.play(track)
    }
}
