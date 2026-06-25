import SwiftUI

struct TrackRowView: View {
    let track: TrackItem
    var onPlay: (() -> Void)?

    var body: some View {
        Button {
            onPlay?()
        } label: {
            HStack(spacing: 12) {
                TrackCoverView(track: track, size: 48)
                VStack(alignment: .leading, spacing: 4) {
                    Text(track.displayTitle)
                        .font(EarflowFont.miniTitle)
                        .foregroundStyle(EarflowTheme.textPrimary)
                        .lineLimit(1)
                    Text(track.displayArtist)
                        .font(.caption)
                        .foregroundStyle(EarflowTheme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "play.fill")
                    .font(.caption)
                    .foregroundStyle(EarflowTheme.textMuted)
            }
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
    }
}

struct TrackCoverView: View {
    let track: TrackItem
    var size: CGFloat = 48

    var body: some View {
        Group {
            if let url = MediaURLResolver.trackCover(track) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        coverPlaceholder
                    }
                }
            } else {
                coverPlaceholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var coverPlaceholder: some View {
        ZStack {
            Color.white.opacity(0.08)
            Image(systemName: "music.note")
                .foregroundStyle(EarflowTheme.textMuted)
        }
    }
}
