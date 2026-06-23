import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @State private var query = ""
    @State private var results = SearchResponse(tracks: [], artists: [], albums: [])
    @State private var isSearching = false
    @State private var errorMessage: String?

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
                            Task { await performSearch(newValue) }
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
                                    Task { await dependencies.playbackCoordinator.play(track) }
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

    private func performSearch(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            results = SearchResponse(tracks: [], artists: [], albums: [])
            return
        }
        isSearching = true
        errorMessage = nil
        defer { isSearching = false }
        do {
            results = try await dependencies.search.search(query: trimmed)
        } catch {
            errorMessage = "Ошибка поиска."
            await EarflowLog.shared.error("search", error.localizedDescription)
        }
    }
}
