import SwiftUI

#if DEBUG
private let mockTrack = TrackItem(
    id: 1,
    title: "Midnight Drive",
    artist: "Echo Lane",
    album: nil,
    coverUrl: nil,
    coverPath: nil,
    duration: 240
)

private let mockTracks: [TrackItem] = (1...6).map { i in
    TrackItem(
        id: i,
        title: "Track \(i)",
        artist: "Artist \(i)",
        album: nil,
        coverUrl: nil,
        coverPath: nil,
        duration: 200 + i
    )
}

/// Вариант A — текущая реализация (компактная очередь + 28px между рельсами).
struct HomeLayoutMockupVariantA: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EarflowTheme.homeRailSpacing) {
                RoundedRectangle(cornerRadius: EarflowTheme.homeHeroRadius)
                    .fill(Color.white.opacity(0.08))
                    .aspectRatio(4 / 5, contentMode: .fit)
                    .overlay(alignment: .bottomLeading) {
                        Text("Hero 4:5")
                            .font(EarflowFont.caption)
                            .foregroundStyle(EarflowTheme.textMuted)
                            .padding(12)
                    }

                HomeForYouTrackList(
                    tracks: mockTracks,
                    currentTrackId: 2,
                    onPlay: { _ in }
                )

                HomeMoodChipsSection()

                HorizontalTrackRail(
                    title: "Подборка",
                    tracks: Array(mockTracks.prefix(4)),
                    onPlay: { _ in }
                )
            }
            .padding(.horizontal, 12)
            .padding(.bottom, ShellChromeMetrics(hasMiniPlayer: true).bottomInset)
        }
        .background(EarflowTheme.surfaceMain)
    }
}

/// Вариант B — плотнее: узкий hero, 3 трека в очереди.
struct HomeLayoutMockupVariantB: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.white.opacity(0.08))
                    .frame(maxWidth: .infinity)
                    .frame(height: 220)
                    .overlay {
                        Text("Hero ~88% width, h=220")
                            .font(EarflowFont.caption)
                            .foregroundStyle(EarflowTheme.textMuted)
                    }

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        HomeSectionTitle("Для вас")
                        Spacer()
                        Text("Ещё")
                            .font(EarflowFont.unbounded(size: 11, weight: .bold))
                            .foregroundStyle(EarflowTheme.accent)
                    }
                    ForEach(mockTracks.prefix(3)) { track in
                        EarflowTrackRow(track: track, onPlay: {})
                    }
                }

                HorizontalTrackRail(
                    title: "Рельса (карточки 102px)",
                    tracks: Array(mockTracks.prefix(5)),
                    onPlay: { _ in }
                )
            }
            .padding(.horizontal, 12)
        }
        .background(EarflowTheme.surfaceMain)
    }
}

/// Вариант C — «Для вас» в карточке-контейнере.
struct HomeLayoutMockupVariantC: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EarflowTheme.homeRailSpacing) {
                RoundedRectangle(cornerRadius: EarflowTheme.homeHeroRadius)
                    .fill(Color.white.opacity(0.08))
                    .aspectRatio(4 / 5, contentMode: .fit)

                VStack(alignment: .leading, spacing: 8) {
                    HomeSectionTitle("Для вас")
                    VStack(spacing: 2) {
                        ForEach(mockTracks.prefix(6)) { track in
                            EarflowTrackRow(track: track, onPlay: {})
                        }
                    }
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255))
                    )
                }

                Rectangle()
                    .fill(Color.white.opacity(0.06))
                    .frame(height: 1)
                    .padding(.vertical, 4)

                HorizontalTrackRail(
                    title: "После разделителя",
                    tracks: Array(mockTracks.prefix(4)),
                    onPlay: { _ in }
                )
            }
            .padding(.horizontal, 12)
        }
        .background(EarflowTheme.surfaceMain)
    }
}

#Preview("Home A — compact") {
    HomeLayoutMockupVariantA()
        .preferredColorScheme(.dark)
}

#Preview("Home B — dense") {
    HomeLayoutMockupVariantB()
        .preferredColorScheme(.dark)
}

#Preview("Home C — queue card") {
    HomeLayoutMockupVariantC()
        .preferredColorScheme(.dark)
}
#endif
