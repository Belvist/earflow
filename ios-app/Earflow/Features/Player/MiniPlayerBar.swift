import SwiftUI

struct MiniPlayerBar: View {
    @EnvironmentObject private var dependencies: AppDependencies

    var body: some View {
        if let track = dependencies.playbackCoordinator.nowPlaying {
            Button {
                dependencies.playbackCoordinator.sheetExpanded = true
            } label: {
                HStack(spacing: 12) {
                    TrackCoverView(track: track, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track.displayTitle)
                            .font(EarflowFont.miniTitle)
                            .foregroundStyle(EarflowTheme.textPrimary)
                            .lineLimit(1)
                        Text(track.displayArtist)
                            .font(.caption)
                            .foregroundStyle(EarflowTheme.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    Button {
                        Task { await dependencies.playbackCoordinator.togglePlayPause() }
                    } label: {
                        Image(systemName: playIcon)
                            .font(.title3)
                            .foregroundStyle(EarflowTheme.textPrimary)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
            .background(EarflowTheme.cardTop.opacity(0.95))
            .overlay(alignment: .top) {
                Rectangle().fill(EarflowTheme.border).frame(height: 1)
            }
        }
    }

    private var playIcon: String {
        switch dependencies.playbackCoordinator.state {
        case .playing, .buffering: return "pause.fill"
        default: return "play.fill"
        }
    }
}

struct PlayerSheetView: View {
    @EnvironmentObject private var dependencies: AppDependencies

    var body: some View {
        ZStack {
            EarflowTheme.authBackground.ignoresSafeArea()
            if let track = dependencies.playbackCoordinator.nowPlaying {
                VStack(spacing: 28) {
                    HStack {
                        Button {
                            dependencies.playbackCoordinator.sheetExpanded = false
                        } label: {
                            Image(systemName: "chevron.down")
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(EarflowTheme.textPrimary)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 20)

                    TrackCoverView(track: track, size: 280)
                        .shadow(color: .black.opacity(0.45), radius: 24, y: 12)

                    VStack(spacing: 8) {
                        Text(track.displayTitle)
                            .font(.title2.weight(.bold))
                            .foregroundStyle(EarflowTheme.textPrimary)
                            .multilineTextAlignment(.center)
                        Text(track.displayArtist)
                            .font(.title3)
                            .foregroundStyle(EarflowTheme.textSecondary)
                    }
                    .padding(.horizontal, 24)

                    Text(dependencies.playbackCoordinator.state.rawValue)
                        .font(.caption.monospaced())
                        .foregroundStyle(EarflowTheme.textMuted)

                    HStack(spacing: 36) {
                        Button {
                            Task { await dependencies.playbackCoordinator.stop() }
                        } label: {
                            Image(systemName: "stop.fill")
                                .font(.title2)
                        }
                        Button {
                            Task { await dependencies.playbackCoordinator.togglePlayPause() }
                        } label: {
                            Image(systemName: sheetPlayIcon)
                                .font(.system(size: 56))
                        }
                    }
                    .foregroundStyle(EarflowTheme.textPrimary)

                    Spacer()
                }
                .padding(.top, 12)
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var sheetPlayIcon: String {
        switch dependencies.playbackCoordinator.state {
        case .playing, .buffering: return "pause.circle.fill"
        default: return "play.circle.fill"
        }
    }
}
