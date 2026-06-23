import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @State private var rails: [DiscoverRail] = []
    @State private var likes: [TrackItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if isLoading && rails.isEmpty && likes.isEmpty {
                        ProgressView()
                            .tint(EarflowTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    }

                    if let errorMessage, rails.isEmpty {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(EarflowTheme.danger)
                            .padding(.horizontal, 16)
                    }

                    if !likes.isEmpty {
                        HorizontalTrackRail(title: "Любимое", tracks: likes) { track in
                            Task { await dependencies.playbackCoordinator.play(track) }
                        }
                    }

                    ForEach(rails) { rail in
                        let tracks = rail.flatTracks
                        if !tracks.isEmpty {
                            HorizontalTrackRail(title: rail.displayTitle, tracks: Array(tracks.prefix(20))) { track in
                                Task { await dependencies.playbackCoordinator.play(track) }
                            }
                        }
                    }
                }
                .padding(.vertical, 16)
            }
            .background(EarflowTheme.background)
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Earflow")
                        .font(EarflowFont.unbounded(size: 17, weight: .black))
                        .foregroundStyle(EarflowTheme.textPrimary)
                }
            }
            .navigationTitle("")
            .refreshable { await loadContent() }
            .task { await loadContent() }
        }
    }

    private func loadContent() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            async let railsTask = dependencies.catalog.fetchDiscoverRails()
            async let likesTask = dependencies.catalog.fetchLikes()
            let (discover, liked) = try await (railsTask, likesTask)
            rails = discover.rails ?? []
            likes = liked
        } catch {
            errorMessage = "Не удалось загрузить каталог."
            await EarflowLog.shared.error("home", error.localizedDescription)
        }
    }
}
