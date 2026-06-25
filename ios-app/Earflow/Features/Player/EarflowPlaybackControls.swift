import SwiftUI

// MARK: - Shared progress UI (mini + full sheet)

struct EarflowPlaybackProgressBar: View {
    let fraction: Double
    var height: CGFloat = EarflowTheme.miniProgressHeight
    var trackColor: Color = Color.white.opacity(0.14)
    var fillColor: Color = Color.white.opacity(0.92)

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(trackColor)
                Capsule()
                    .fill(fillColor)
                    .frame(width: max(0, geo.size.width * CGFloat(fraction)))
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

struct EarflowSeekSlider: View {
    let progress: PlaybackProgress
    let duration: Double
    var isBuffering: Bool = false
    var onSeek: (Double) -> Void

    @State private var dragFraction: Double?
    @State private var isDragging = false

    private var activeFraction: Double {
        if let dragFraction { return dragFraction }
        return progress.fraction
    }

    var body: some View {
        VStack(spacing: 8) {
            ZStack(alignment: .leading) {
                EarflowPlaybackProgressBar(
                    fraction: activeFraction,
                    height: 4,
                    trackColor: Color.white.opacity(0.22),
                    fillColor: Color.white.opacity(isBuffering ? 0.55 : 0.92)
                )
                if isBuffering {
                    EarflowPlaybackProgressBar(
                        fraction: activeFraction,
                        height: 4,
                        trackColor: .clear,
                        fillColor: Color.white.opacity(0.35)
                    )
                    .opacity(0.6)
                }
            }
            .overlay {
                GeometryReader { geo in
                    Color.clear
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    let travel = hypot(value.translation.width, value.translation.height)
                                    guard travel > 2 else { return }
                                    isDragging = true
                                    let f = min(1, max(0, value.location.x / max(geo.size.width, 1)))
                                    dragFraction = f
                                }
                                .onEnded { value in
                                    let f = min(1, max(0, value.location.x / max(geo.size.width, 1)))
                                    let travel = hypot(value.translation.width, value.translation.height)
                                    if duration > 0 {
                                        onSeek(f * duration)
                                    }
                                    dragFraction = nil
                                    isDragging = false
                                    _ = travel
                                }
                        )
                }
            }

            HStack {
                Text(PlaybackTimeFormat.mmss(isDragging && duration > 0 ? activeFraction * duration : progress.currentTime))
                Spacer()
                Text(PlaybackTimeFormat.mmss(duration))
            }
            .font(EarflowFont.caption)
            .foregroundStyle(EarflowTheme.textMuted)
            .monospacedDigit()
        }
        .onChange(of: progress.currentTime) { _, _ in
            if !isDragging { dragFraction = nil }
        }
    }
}
