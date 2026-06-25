import SwiftUI

/// Web `MobilePlayerBar` — tap opens sheet; swipe up expands; horizontal skip on track zone only.
struct MiniPlayerBar: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var playbackCoordinator: PlaybackCoordinator
    @State private var trackSwipeX: CGFloat = 0
    @State private var expandPull: CGFloat = 0

    private var coordinator: PlaybackCoordinator { playbackCoordinator }
    private var sheet: PlayerSheetState { playbackCoordinator.playerSheet }

    var body: some View {
        if let track = coordinator.nowPlaying {
            let accent = coordinator.coverAccent.accentColor
                ?? Color(red: 18 / 255, green: 12 / 255, blue: 14 / 255)

            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    trackInfoButton(track: track)
                    likeButton
                    playButton
                }
                .padding(.horizontal, 14)
                .frame(height: EarflowTheme.miniPlayerHeight - EarflowTheme.miniProgressHeight - 8)
                .padding(.top, 4)

                EarflowPlaybackProgressBar(
                    fraction: coordinator.progress.fraction,
                    height: EarflowTheme.miniProgressHeight,
                    trackColor: Color.white.opacity(0.22),
                    fillColor: Color.white.opacity(0.92)
                )
                .padding(.horizontal, 14)
                .padding(.bottom, 6)
                .allowsHitTesting(false)

                if let error = coordinator.playbackError {
                    Text(error)
                        .font(EarflowFont.caption)
                        .foregroundStyle(EarflowTheme.danger)
                        .lineLimit(2)
                        .padding(.horizontal, 14)
                        .padding(.bottom, 8)
                }
            }
            .background(
                RoundedRectangle(cornerRadius: EarflowTheme.miniPlayerRadius)
                    .fill(accent)
            )
            .shadow(color: .black.opacity(0.35), radius: 12, y: 4)
            .scaleEffect(sheet.miniScale)
            .opacity(sheet.miniOpacity)
            .offset(x: trackSwipeX, y: min(0, expandPull * 0.12))
            .accessibilityElement(children: .contain)
        }
    }

    private func trackInfoButton(track: TrackItem) -> some View {
        Button {
            sheet.open()
        } label: {
            HStack(spacing: 10) {
                PortraitCoverView(url: MediaURLResolver.trackCover(track), width: 36, cornerRadius: 6)
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.displayTitle)
                        .font(EarflowFont.miniTitle)
                        .foregroundStyle(EarflowTheme.textPrimary)
                        .lineLimit(1)
                    Text(track.displayArtist)
                        .font(EarflowFont.miniArtist)
                        .foregroundStyle(EarflowTheme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .simultaneousGesture(trackZoneDragGesture)
    }

    private var likeButton: some View {
        Button {
            Task { await coordinator.toggleLikeCurrent(catalog: dependencies.catalog) }
        } label: {
            Image(systemName: coordinator.isCurrentTrackLiked ? "heart.fill" : "heart")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(coordinator.isCurrentTrackLiked ? EarflowTheme.danger : EarflowTheme.textPrimary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(coordinator.isCurrentTrackLiked ? "Убрать из избранного" : "В избранное")
    }

    private var playButton: some View {
        Button {
            Task { await coordinator.togglePlayPause() }
        } label: {
            ZStack {
                if coordinator.state == .loadingSession || coordinator.state == .loadingMedia {
                    ProgressView().tint(.white).scaleEffect(0.85)
                } else {
                    Image(systemName: playIcon)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .symbolRenderingMode(.monochrome)
                }
            }
            .frame(width: 44, height: 44)
            .background(Circle().fill(Color.white.opacity(0.14)))
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playIcon == "pause.fill" ? "Пауза" : "Воспроизведение")
    }

    private var playIcon: String {
        switch coordinator.state {
        case .playing, .buffering: return "pause.fill"
        default: return "play.fill"
        }
    }

    /// Swipe/expand only on track zone — `minimumDistance` 18 so taps hit Button first.
    private var trackZoneDragGesture: some Gesture {
        DragGesture(minimumDistance: 18)
            .onChanged { value in
                let dx = value.translation.width
                let dy = value.translation.height
                if abs(dx) > abs(dy) * 1.1 {
                    trackSwipeX = max(-72, min(72, dx * 0.35))
                    return
                }
                if dy < 0, !sheet.isOpen {
                    if expandPull == 0 { sheet.beginExpandPan() }
                    expandPull = dy
                    sheet.applyExpandPull(dy)
                }
            }
            .onEnded { value in
                let dx = value.translation.width
                let dy = value.translation.height
                withAnimation(.easeOut(duration: 0.18)) { trackSwipeX = 0 }
                expandPull = 0

                if abs(dx) > abs(dy) * 1.1 {
                    if dx > 52 { Task { await coordinator.playPrevious() } }
                    else if dx < -52 { Task { await coordinator.playNext() } }
                    return
                }
                if dy < 0, !sheet.isOpen {
                    sheet.settleExpand(
                        velocityY: value.predictedEndTranslation.height - value.translation.height,
                        travelY: dy
                    )
                }
            }
    }
}

// MARK: - Full player sheet (web `MobilePlayerModal`)

struct PlayerChromeOverlay: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var playbackCoordinator: PlaybackCoordinator

    private var coordinator: PlaybackCoordinator { playbackCoordinator }
    private var sheet: PlayerSheetState { playbackCoordinator.playerSheet }

    var body: some View {
        GeometryReader { geo in
            let height = geo.size.height
            let progress = sheet.sheetProgress
            let safeBottom = geo.safeAreaInsets.bottom

            ZStack(alignment: .bottom) {
                backdrop(progress: progress)
                    .opacity(Double(min(1, progress * 1.15)))
                    .allowsHitTesting(progress > 0.08)

                if let track = coordinator.nowPlaying {
                    sheetPanel(
                        track: track,
                        viewportHeight: height,
                        safeBottom: safeBottom,
                        screenWidth: geo.size.width,
                        progress: progress
                    )
                }
            }
        }
        .ignoresSafeArea()
    }

    private func backdrop(progress: CGFloat) -> some View {
        let accent = coordinator.coverAccent.accentColor ?? EarflowTheme.surfaceMain
        return ZStack {
            accent
            LinearGradient(
                colors: [
                    Color.black.opacity(0.12),
                    Color.black.opacity(0.28),
                    Color.black.opacity(0.52),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if sheet.isOpen { sheet.finishClosed() }
        }
    }

    private func sheetPanel(
        track: TrackItem,
        viewportHeight: CGFloat,
        safeBottom: CGFloat,
        screenWidth: CGFloat,
        progress: CGFloat
    ) -> some View {
        let y = max(0, sheet.sheetY)
        let dockOpacity = sheet.isOpen ? 1.0 : Double(max(0, (progress - 0.45) / 0.55))

        return VStack(spacing: 0) {
            dismissDragZone
            sheetHeader
            Spacer(minLength: 8)
            albumBody(track: track, screenWidth: screenWidth)
            Spacer(minLength: 12)
            controlsDock
                .opacity(dockOpacity)
            if let error = coordinator.playbackError {
                Text(error)
                    .font(EarflowFont.caption)
                    .foregroundStyle(EarflowTheme.danger)
                    .padding(.top, 8)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, max(12, safeBottom + 8))
        .frame(height: viewportHeight, alignment: .top)
        .offset(y: y)
        .allowsHitTesting(progress > 0.12)
    }

    private var dismissDragZone: some View {
        VStack(spacing: 8) {
            Capsule()
                .fill(Color.white.opacity(0.28))
                .frame(width: 36, height: 4)
            Color.clear.frame(height: 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
        .contentShape(Rectangle().inset(by: -12))
        .gesture(dismissDragGesture)
    }

    private var sheetHeader: some View {
        HStack(spacing: 0) {
            Button {
                sheet.finishClosed()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Color.white.opacity(0.1)))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Свернуть плеер")

            Text("СЕЙЧАС ИГРАЕТ")
                .font(EarflowFont.unbounded(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.8))
                .textCase(.uppercase)
                .frame(maxWidth: .infinity)

            Color.clear.frame(width: 40, height: 40)
        }
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private func albumBody(track: TrackItem, screenWidth: CGFloat) -> some View {
        let coverWidth = min(210, screenWidth * 0.54)
        let coverHeight = coverWidth * 1.25

        VStack(spacing: 16) {
            ZStack {
                PortraitCoverView(
                    url: MediaURLResolver.trackCover(track),
                    width: coverWidth,
                    cornerRadius: 14
                )
                .frame(width: coverWidth, height: coverHeight)
                .shadow(color: .black.opacity(0.22), radius: 14, y: 4)

                if coordinator.state == .buffering || coordinator.state == .loadingMedia {
                    ProgressView().tint(.white).scaleEffect(1.2)
                }
            }

            VStack(spacing: 8) {
                Text(track.displayTitle)
                    .font(EarflowFont.unbounded(size: 22, weight: .bold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                Text(track.displayArtist)
                    .font(EarflowFont.unbounded(size: 14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.62))
                    .lineLimit(1)
            }
            .padding(.horizontal, 8)
        }
        .frame(maxWidth: .infinity)
    }

    private var controlsDock: some View {
        VStack(spacing: 0) {
            seekSection
            mainTransportRow
                .padding(.top, 12)
            secondaryControlsRow
                .padding(.top, 18)
        }
    }

    private var seekSection: some View {
        VStack(spacing: 8) {
            EarflowSeekSlider(
                progress: coordinator.progress,
                duration: coordinator.displayDuration,
                isBuffering: coordinator.state == .buffering || coordinator.state == .loadingMedia
            ) { seconds in
                Task { await coordinator.seek(to: seconds) }
            }
        }
    }

    private var mainTransportRow: some View {
        HStack(spacing: 12) {
            sheetIconButton(
                systemName: "hand.thumbsdown",
                size: 20,
                label: "Не нравится",
                active: false
            ) { }

            sheetIconButton(
                systemName: "backward.fill",
                size: 19,
                label: "Предыдущий трек"
            ) {
                Task { await coordinator.playPrevious() }
            }

            Button {
                Task { await coordinator.togglePlayPause() }
            } label: {
                ZStack {
                    if coordinator.state == .loadingSession || coordinator.state == .loadingMedia {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: sheetPlayIcon)
                            .font(.system(size: 44, weight: .regular))
                            .foregroundStyle(.white)
                            .symbolRenderingMode(.monochrome)
                    }
                }
                .frame(width: 72, height: 72)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(sheetPlayIcon == "pause.fill" ? "Пауза" : "Воспроизведение")

            sheetIconButton(
                systemName: "forward.fill",
                size: 19,
                label: "Следующий трек"
            ) {
                Task { await coordinator.playNext() }
            }

            sheetIconButton(
                systemName: coordinator.isCurrentTrackLiked ? "heart.fill" : "heart",
                size: 20,
                label: coordinator.isCurrentTrackLiked ? "Убрать из избранного" : "Нравится",
                active: coordinator.isCurrentTrackLiked,
                activeColor: EarflowTheme.danger
            ) {
                Task { await coordinator.toggleLikeCurrent(catalog: dependencies.catalog) }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var secondaryControlsRow: some View {
        HStack(spacing: 20) {
            sheetIconButton(systemName: "repeat", size: 18, label: "Повтор", dimmed: true) { }
            sheetIconButton(systemName: "text.alignleft", size: 18, label: "Текст песни", dimmed: true) { }
            sheetIconButton(systemName: "list.bullet", size: 18, label: "Список треков", dimmed: true) { }
            sheetIconButton(systemName: "ellipsis", size: 18, label: "Ещё", dimmed: true) { }
        }
        .frame(maxWidth: .infinity)
    }

    private func sheetIconButton(
        systemName: String,
        size: CGFloat,
        label: String,
        active: Bool = false,
        activeColor: Color = .white,
        dimmed: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(active ? activeColor : Color.white.opacity(dimmed ? 0.75 : 0.6))
                .symbolRenderingMode(.monochrome)
                .frame(width: 46, height: 46)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var sheetPlayIcon: String {
        switch coordinator.state {
        case .playing, .buffering: return "pause.fill"
        default: return "play.fill"
        }
    }

    private var dismissDragGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                guard value.translation.height > 0 else { return }
                if sheet.phase != .dragging { sheet.beginDismissDrag() }
                sheet.applyDismissDelta(value.translation.height)
            }
            .onEnded { value in
                sheet.settleDismiss(
                    velocityY: value.predictedEndTranslation.height - value.translation.height,
                    travelY: value.translation.height
                )
            }
    }
}

struct PlayerSheetView: View {
    @EnvironmentObject private var dependencies: AppDependencies

    var body: some View {
        PlayerChromeOverlay().environmentObject(dependencies)
    }
}
