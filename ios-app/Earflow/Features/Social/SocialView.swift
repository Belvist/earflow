import SwiftUI

struct SocialView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var authPresentation: AppAuthPresentation
    @Environment(\.appShellMode) private var shellMode
    @State private var posts: [SocialPostDTO] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if shellMode.isGuest {
                    GuestAuthPromptView(
                        title: "Соцсеть Earflow",
                        message: "Лента и взаимодействия доступны после входа.",
                        buttonTitle: "Войти"
                    ) {
                        authPresentation.presentLogin(reason: "Войдите, чтобы открыть соцсеть.")
                    }
                } else if isLoading && posts.isEmpty {
                    ProgressView("Загрузка ленты…")
                        .tint(EarflowTheme.accent)
                } else if posts.isEmpty {
                    ContentUnavailableView(
                        "Пока пусто",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text(errorMessage ?? "В ленте пока нет постов.")
                    )
                } else {
                    List(posts) { post in
                        SocialPostCard(post: post)
                            .listRowSeparator(.hidden)
                            .listRowBackground(EarflowTheme.background)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(EarflowTheme.background)
            .navigationTitle("Соцсеть")
            .refreshable { await loadFeed() }
            .task { await loadFeed() }
        }
    }

    private func loadFeed() async {
        guard !shellMode.isGuest else {
            posts = []
            isLoading = false
            return
        }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await dependencies.social.fetchFeed()
            posts = response.posts ?? []
        } catch {
            errorMessage = "Не удалось загрузить ленту."
            if let gateway = error as? GatewayError, case .unauthorized(let detail) = gateway, detail.status == 404 {
                errorMessage = "Соцсеть пока недоступна на сервере (404)."
            } else if let gateway = error as? GatewayError {
                await EarflowLog.shared.error("social", "\(gateway)")
            } else {
                await EarflowLog.shared.error("social", error.localizedDescription)
            }
        }
    }
}

private struct SocialPostCard: View {
    let post: SocialPostDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                avatar
                VStack(alignment: .leading, spacing: 2) {
                    Text(post.author?.displayName ?? "Слушатель")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(EarflowTheme.textPrimary)
                    if let label = post.createdAtLabel, !label.isEmpty {
                        Text(label)
                            .font(.caption2)
                            .foregroundStyle(EarflowTheme.textMuted)
                    }
                }
                Spacer()
            }
            if !post.displayText.isEmpty {
                Text(post.displayText)
                    .font(.body)
                    .foregroundStyle(EarflowTheme.textPrimary)
            }
            HStack(spacing: 6) {
                Image(systemName: post.viewer?.liked == true ? "heart.fill" : "heart")
                    .foregroundStyle(post.viewer?.liked == true ? EarflowTheme.danger : EarflowTheme.textMuted)
                Text("\(post.metrics?.likes ?? 0)")
                    .font(.caption)
                    .foregroundStyle(EarflowTheme.textSecondary)
            }
        }
        .padding(14)
        .background(EarflowTheme.cardTop.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var avatar: some View {
        if let urlString = post.author?.avatarUrl, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                if case .success(let image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    initialsAvatar
                }
            }
            .frame(width: 40, height: 40)
            .clipShape(Circle())
        } else {
            initialsAvatar
        }
    }

    private var initialsAvatar: some View {
        ZStack {
            Circle().fill(Color.white.opacity(0.1))
            Text(post.author?.initials ?? "?")
                .font(.caption.weight(.bold))
                .foregroundStyle(EarflowTheme.textPrimary)
        }
        .frame(width: 40, height: 40)
    }
}
