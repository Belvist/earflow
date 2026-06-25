import SwiftUI

// MARK: - Web mobile home parity (`MusicPlayer.js` MobileHomeRoot v3)

enum HomeCategory: String, CaseIterable, Identifiable {
    case forYou
    case liked
    case newReleases

    var id: String { rawValue }

    var title: String {
        switch self {
        case .forYou: return "Для тебя"
        case .liked: return "Нравится"
        case .newReleases: return "Новинки"
        }
    }
}

enum HomeQueueSource {
    case recommendations
    case liked
}

/// `CategoryTabs` — web allows all tabs for guests (login on action).
struct HomeCategoryTabs: View {
    @Binding var selection: HomeCategory

    var body: some View {
        HStack(spacing: 8) {
            ForEach(HomeCategory.allCases) { tab in
                let active = selection == tab
                Button {
                    selection = tab
                } label: {
                    Text(tab.title.uppercased())
                        .font(EarflowFont.unbounded(size: 11, weight: .medium))
                        .kerning(0.44)
                        .foregroundStyle(active ? Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255) : Color.white.opacity(0.72))
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(
                            Capsule()
                                .fill(active ? Color.white.opacity(0.96) : Color.white.opacity(0.06))
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 22)
    }
}

/// `HomeQueueStatus` — exact web copy matrix (`resolveHomeQueueEmptyCopy`).
struct HomeQueueStatusCard: View {
    enum Kind: Equatable {
        case sessionLoading
        case guestLogin
        case recommendationsLoading
        case likedEmpty
        case tracksEmpty
        case loadError(String)

        var title: String {
            switch self {
            case .sessionLoading: return "Проверяем сессию…"
            case .guestLogin: return "Войдите, чтобы слушать"
            case .recommendationsLoading: return "Загружаем рекомендации"
            case .likedEmpty: return "В избранном пока пусто"
            case .tracksEmpty: return "Пока нет треков"
            case .loadError: return "Не удалось загрузить треки"
            }
        }

        var text: String {
            switch self {
            case .sessionLoading: return "Подождите, пока загрузится ваш профиль."
            case .guestLogin: return "Рекомендации и плеер доступны после авторизации."
            case .recommendationsLoading: return "Подбираем треки для очереди воспроизведения."
            case .likedEmpty: return "Отмечайте треки сердечком — они появятся в этом разделе."
            case .tracksEmpty: return "Очередь пуста. Проверьте backend и попробуйте обновить рекомендации."
            case .loadError(let msg): return msg
            }
        }

        var actionLabel: String? {
            switch self {
            case .guestLogin: return "Войти"
            case .likedEmpty, .tracksEmpty: return "Обновить"
            case .loadError: return "Повторить"
            case .sessionLoading, .recommendationsLoading: return nil
            }
        }

        var showsSpinner: Bool {
            switch self {
            case .sessionLoading, .recommendationsLoading: return true
            default: return false
            }
        }
    }

    let kind: Kind
    var onAction: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            if kind.showsSpinner {
                ProgressView()
                    .tint(.white.opacity(0.85))
                    .scaleEffect(1.1)
                    .padding(.bottom, 16)
            }
            Text(kind.title)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.95))
                .multilineTextAlignment(.center)
                .padding(.bottom, 10)
            Text(kind.text)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(Color.white.opacity(0.62))
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .frame(maxWidth: 384)
            if let label = kind.actionLabel, let onAction {
                Button(action: onAction) {
                    Text(label)
                        .font(.system(size: 14, weight: .bold))
                        .kerning(0.28)
                        .foregroundStyle(Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255))
                        .padding(.horizontal, 18)
                        .padding(.vertical, 11)
                        .background(Capsule().fill(Color.white))
                }
                .buttonStyle(.plain)
                .padding(.top, 18)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 28)
        .frame(maxWidth: 280, minHeight: 280)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(
                    LinearGradient(
                        colors: [Color.white.opacity(0.06), Color.white.opacity(0.02)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .frame(maxWidth: .infinity)
        .padding(.bottom, 36)
    }
}

// MARK: - Hero (`HomeMobileHeroV3`)

struct HomeMobileHeroView: View {
    let track: TrackItem
    var isPlaying: Bool
    var progressFraction: Double = 0
    var showReason: Bool = true
    var onOpenPlayer: () -> Void
    var onTogglePlay: () -> Void
    var onTitleNavigate: (() -> Void)?
    var onSwipePrevious: (() -> Void)?
    var onSwipeNext: (() -> Void)?

    @State private var dragOffset: CGFloat = 0

    private var heroTags: [String] {
        HomeHeroTags.labels(for: track, showReason: showReason)
    }

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let heroHeight = width * EarflowTheme.portraitCoverRatio
            ZStack(alignment: .bottom) {
                ZStack {
                    coverBackground
                        .offset(x: dragOffset * 0.42)
                    LinearGradient(
                        stops: [
                            .init(color: Color.black.opacity(0.35), location: 0),
                            .init(color: Color.black.opacity(0.55), location: 0.45),
                            .init(color: Color.black.opacity(0.88), location: 1),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
                .allowsHitTesting(false)

                Button(action: onOpenPlayer) {
                    Color.clear
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                .frame(height: max(0, heroHeight - 46))
                .frame(maxHeight: .infinity, alignment: .top)
                .simultaneousGesture(heroSwipeGesture)

                HStack(alignment: .bottom, spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        Button {
                            onTitleNavigate?()
                        } label: {
                            Text(track.displayTitle.uppercased())
                                .font(EarflowFont.unbounded(size: 17, weight: .bold))
                                .kerning(0.34)
                                .foregroundStyle(Color.white)
                                .lineLimit(2)
                                .minimumScaleFactor(0.85)
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .disabled(onTitleNavigate == nil)

                        Text(track.displayArtist.uppercased())
                            .font(EarflowFont.unbounded(size: 11, weight: .regular))
                            .kerning(0.66)
                            .foregroundStyle(Color.white.opacity(0.62))
                            .lineLimit(1)
                            .padding(.top, 6)

                        HStack(spacing: 6) {
                            ForEach(heroTags, id: \.self) { heroTag($0) }
                        }
                        .padding(.top, 8)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button(action: onTogglePlay) {
                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255))
                            .symbolRenderingMode(.monochrome)
                            .frame(width: 56, height: 56)
                            .background(Circle().fill(Color.white.opacity(0.96)))
                            .shadow(color: .black.opacity(0.45), radius: 12, y: 4)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
                .padding(.bottom, 46)

                EarflowPlaybackProgressBar(
                    fraction: progressFraction,
                    height: 3,
                    trackColor: Color.white.opacity(0.22),
                    fillColor: Color.white.opacity(0.92)
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
                .allowsHitTesting(false)
            }
            .frame(width: width, height: heroHeight)
            .background(Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255))
            .clipShape(RoundedRectangle(cornerRadius: EarflowTheme.homeHeroRadius))
        }
        .aspectRatio(4 / 5, contentMode: .fit)
        .padding(.bottom, 22)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Трек дня, \(track.displayTitle)")
    }

    private var heroSwipeGesture: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { dragOffset = $0.translation.width }
            .onEnded { value in
                let dx = value.translation.width
                withAnimation(.easeOut(duration: 0.2)) { dragOffset = 0 }
                if dx > 48 { onSwipePrevious?() }
                else if dx < -48 { onSwipeNext?() }
            }
    }

    @ViewBuilder
    private var coverBackground: some View {
        if let url = MediaURLResolver.trackCover(track) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255)
                }
            }
        } else {
            Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255)
        }
    }

    private func heroTag(_ label: String) -> some View {
        Text(label)
            .font(EarflowFont.unbounded(size: 10, weight: .medium))
            .foregroundStyle(Color.white.opacity(0.82))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.white.opacity(0.12)))
    }
}

// MARK: - Vertical queue (`HomeForYouList`)

struct HomeForYouTrackList: View {
    let tracks: [TrackItem]
    let currentTrackId: Int?
    let onPlay: (TrackItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HomeSectionTitle("Для вас")
            VStack(spacing: 4) {
                ForEach(forYouTracks) { track in
                    EarflowTrackRow(
                        track: track,
                        isCurrent: track.id == currentTrackId,
                        style: .homeQueue,
                        onPlay: { onPlay(track) }
                    )
                }
            }
        }
    }

    /// Web `pickForYouTracks` — следующие треки после текущего, без дубля текущего в списке.
    private var forYouTracks: [TrackItem] {
        let list = tracks
        guard !list.isEmpty else { return [] }
        if list.count == 1 { return [list[0]] }

        let idx: Int
        if let currentTrackId,
           let found = list.firstIndex(where: { $0.id == currentTrackId }) {
            idx = found
        } else {
            idx = 0
        }

        var out: [TrackItem] = []
        let limit = EarflowTheme.homeForYouMaxTracks
        for offset in 1...limit where out.count < limit {
            out.append(list[(idx + offset) % list.count])
        }
        return out
    }
}

// MARK: - Mood chips (`HomeMoodChips`)

struct HomeMoodChipsSection: View {
    private let moods: [(label: String, mood: String)] = [
        ("Мрачный вайб", "dark"),
        ("Рэп", "energetic"),
        ("Атмосфера", "calm"),
        ("Грусть", "melancholic"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HomeSectionTitle("Настроения и жанры")
            FlowLayout(spacing: 10) {
                ForEach(moods, id: \.mood) { item in
                    Text(item.label)
                        .font(EarflowFont.unbounded(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.94))
                        .padding(.horizontal, 20)
                        .frame(minWidth: 132, minHeight: 48)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255))
                        )
                        .opacity(0.85)
                }
            }
        }
    }
}

/// Simple flow layout for mood chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, frame) in result.frames.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        let maxWidth = proposal.width ?? UIScreen.main.bounds.width
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var frames: [CGRect] = []

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(x: x, y: y, width: size.width, height: size.height))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }
        return (CGSize(width: maxWidth, height: y + rowHeight), frames)
    }
}

// MARK: - Popular artists

struct HomePopularArtistsSection: View {
    let artists: [PopularArtistItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                HomeSectionTitle("Популярные артисты")
                Spacer()
                Text("Смотреть все")
                    .font(EarflowFont.unbounded(size: 11, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.85))
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(Capsule().fill(Color.white.opacity(0.04)))
                    .opacity(0.7)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(artists) { artist in
                        VStack(spacing: 8) {
                            artistAvatar(artist)
                            Text(artist.displayName)
                                .font(EarflowFont.unbounded(size: 10, weight: .semibold))
                                .foregroundStyle(EarflowTheme.textPrimary)
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                                .frame(width: 108)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 4)
    }

    @ViewBuilder
    private func artistAvatar(_ artist: PopularArtistItem) -> some View {
        let path = artist.resolvedCoverPath
        let url = path.flatMap { MediaURLResolver.coverURL(from: $0) }
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Circle().fill(Color.white.opacity(0.08))
                    }
                }
            } else {
                Circle().fill(Color.white.opacity(0.08))
            }
        }
        .frame(width: 108, height: 108)
        .clipShape(Circle())
    }
}

// MARK: - Playlist rails

struct HorizontalPlaylistRail: View {
    let title: String
    let playlists: [DiscoverPlaylist]
    var compactTop: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HomeSectionTitle(title)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(playlists) { playlist in
                        NavigationLink(value: CatalogNavigationRoute.playlist(playlist)) {
                            PlaylistCardView(playlist: playlist)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .padding(.top, compactTop ? 0 : 4)
    }
}

private struct PlaylistCardView: View {
    let playlist: DiscoverPlaylist

    private var previewTracks: [TrackItem] {
        Array((playlist.tracks ?? []).prefix(4))
    }

    var body: some View {
        let width = EarflowTheme.playlistCardWidth
        VStack(alignment: .leading, spacing: 8) {
            Group {
                if let first = previewTracks.first {
                    TrackCoverView.portrait(track: first, width: width, cornerRadius: 10)
                } else {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.white.opacity(0.08))
                        .frame(width: width, height: width * EarflowTheme.portraitCoverRatio)
                        .overlay {
                            Image(systemName: "music.note")
                                .foregroundStyle(EarflowTheme.textMuted)
                        }
                }
            }
            Text(playlist.displayTitle)
                .font(EarflowFont.unbounded(size: 10.5, weight: .semibold))
                .foregroundStyle(EarflowTheme.textPrimary)
                .lineLimit(2)
                .frame(width: width, alignment: .leading)
        }
    }
}

struct HorizontalTrackRail: View {
    let title: String
    let tracks: [TrackItem]
    let onPlay: (TrackItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HomeSectionTitle(title)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(tracks) { track in
                        Button { onPlay(track) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                TrackCoverView.portrait(track: track, width: EarflowTheme.playlistCardWidth, cornerRadius: 10)
                                Text(track.displayTitle)
                                    .font(EarflowFont.unbounded(size: 10.5, weight: .semibold))
                                    .foregroundStyle(EarflowTheme.textPrimary)
                                    .lineLimit(2)
                                    .frame(width: EarflowTheme.playlistCardWidth, alignment: .leading)
                                Text(track.displayArtist)
                                    .font(EarflowFont.unbounded(size: 9, weight: .medium))
                                    .foregroundStyle(EarflowTheme.textSecondary)
                                    .lineLimit(1)
                                    .frame(width: EarflowTheme.playlistCardWidth, alignment: .leading)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }
}

/// Deferred rail skeleton — web `HomeSectionsSkeleton` (900ms).
struct HomeDeferredRailSkeleton: View {
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(0..<6, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.white.opacity(0.06))
                        .frame(width: 116, height: 116 * EarflowTheme.portraitCoverRatio)
                }
            }
        }
        .padding(.bottom, 20)
        .redacted(reason: .placeholder)
    }
}

struct HomeLoadingSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            RoundedRectangle(cornerRadius: EarflowTheme.homeHeroRadius)
                .fill(Color.white.opacity(0.06))
                .aspectRatio(4 / 5, contentMode: .fit)
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.white.opacity(0.05))
                    .frame(height: 52)
            }
        }
        .padding(.vertical, 8)
        .redacted(reason: .placeholder)
    }
}
