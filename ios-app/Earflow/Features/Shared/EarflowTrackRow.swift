import SwiftUI

/// Единый ряд трека — главная, плейлист, альбом (без обводок).
struct EarflowTrackRow: View {
    enum Style {
        case homeQueue
    }

    let track: TrackItem
    var isCurrent: Bool = false
    var style: Style = .homeQueue
    let onPlay: () -> Void

    private var coverWidth: CGFloat {
        EarflowTheme.homeForYouCoverWidth
    }

    var body: some View {
        Button(action: onPlay) {
            HStack(spacing: 12) {
                PortraitCoverView(
                    url: MediaURLResolver.trackCover(track),
                    width: coverWidth,
                    cornerRadius: 8
                )
                VStack(alignment: .leading, spacing: 3) {
                    Text(track.displayTitle)
                        .font(EarflowFont.unbounded(size: 13, weight: .semibold))
                        .foregroundStyle(isCurrent ? Color.white : EarflowTheme.textPrimary)
                        .lineLimit(1)
                    if !track.displayArtist.isEmpty {
                        Text(track.displayArtist)
                            .font(EarflowFont.unbounded(size: 11, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.5))
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                playAffordance
            }
            .frame(minHeight: max(EarflowTheme.trackRowHeight, 44))
            .padding(.vertical, 8)
            .padding(.horizontal, 4)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(isCurrent ? Color.white.opacity(0.06) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var playAffordance: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.06))
                .frame(width: 36, height: 36)
            Image(systemName: isCurrent ? "waveform" : "play.fill")
                .font(.system(size: isCurrent ? 12 : 11, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.leading, isCurrent ? 0 : 2)
        }
    }
}

/// Web `PlaylistPage` → `PlaylistTrackRow` — номер, обложка 38×48, без play-круга справа.
struct EarflowPlaylistTrackRow: View {
    let index: Int
    let track: TrackItem
    var isCurrent: Bool = false
    var isPlaying: Bool = false
    let onPlay: () -> Void

    var body: some View {
        Button(action: onPlay) {
            HStack(spacing: 10) {
                Group {
                    if isCurrent {
                        Image(systemName: isPlaying ? "waveform" : "play.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.85))
                    } else {
                        Text("\(index)")
                            .font(EarflowFont.unbounded(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.4))
                    }
                }
                .frame(width: 24, alignment: .center)

                PortraitCoverView(
                    url: MediaURLResolver.trackCover(track),
                    width: 38,
                    cornerRadius: 8
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.displayTitle)
                        .font(EarflowFont.unbounded(size: 13, weight: .semibold))
                        .foregroundStyle(EarflowTheme.textPrimary)
                        .lineLimit(1)
                    Text(track.displayArtist)
                        .font(EarflowFont.unbounded(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.5))
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
            }
            .frame(minHeight: 48)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(isCurrent ? Color.white.opacity(0.12) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Ряд трека на странице альбома — web `AlbumPage` TrackRow (номер + название + длительность).
struct AlbumTrackRow: View {
    let index: Int
    let track: TrackItem
    var isActive: Bool
    var isPlaying: Bool
    let onPlay: () -> Void

    var body: some View {
        Button(action: onPlay) {
            HStack(spacing: 12) {
                Group {
                    if isActive {
                        Image(systemName: isPlaying ? "waveform" : "play.fill")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.85))
                    } else {
                        Text("\(index)")
                            .font(EarflowFont.unbounded(size: 12, weight: .medium))
                            .foregroundStyle(EarflowTheme.textMuted)
                    }
                }
                .frame(width: 28, alignment: .center)

                Text(track.displayTitle)
                    .font(EarflowFont.unbounded(size: 13, weight: .medium))
                    .foregroundStyle(isActive ? Color.white : EarflowTheme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(PlaybackTimeFormat.mmss(Double(track.duration ?? 0)))
                    .font(EarflowFont.unbounded(size: 11, weight: .medium))
                    .foregroundStyle(EarflowTheme.textMuted)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 8)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isActive ? Color.white.opacity(0.06) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Заголовок секции главной — web `HomeSectionTitle` (~12.5px).
struct HomeSectionTitle: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(EarflowFont.unbounded(size: 12.5, weight: .semibold))
            .foregroundStyle(EarflowTheme.textPrimary)
            .padding(.bottom, 2)
    }
}

struct HomeSectionBlock<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(.bottom, EarflowTheme.homeRailSpacing)
    }
}
