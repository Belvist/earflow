import SwiftUI

// MARK: - Portrait cover (web 4:5)

struct PortraitCoverView: View {
    let url: URL?
    var width: CGFloat
    var cornerRadius: CGFloat = 8

    private var height: CGFloat { width * EarflowTheme.portraitCoverRatio }

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }

    private var placeholder: some View {
        ZStack {
            Color.white.opacity(0.08)
            Image(systemName: "music.note")
                .foregroundStyle(EarflowTheme.textMuted)
        }
    }
}

extension TrackCoverView {
    /// Square thumb — list rows.
    static func square(track: TrackItem, size: CGFloat) -> some View {
        TrackCoverView(track: track, size: size)
    }

    /// Portrait 4:5 — playlist cards, rails.
    static func portrait(track: TrackItem, width: CGFloat, cornerRadius: CGFloat = 10) -> some View {
        PortraitCoverView(url: MediaURLResolver.trackCover(track), width: width, cornerRadius: cornerRadius)
    }
}
