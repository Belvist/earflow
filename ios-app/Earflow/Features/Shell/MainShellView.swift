import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case home
    case social
    case search
    case profile

    var id: String { rawValue }

    var label: String {
        switch self {
        case .home: return "Главная"
        case .social: return "Соцсеть"
        case .search: return "Поиск"
        case .profile: return "Аккаунт"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house"
        case .social: return "person.2"
        case .search: return "magnifyingglass"
        case .profile: return "person"
        }
    }
}

struct MainShellView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var playbackCoordinator: PlaybackCoordinator
    @EnvironmentObject private var authPresentation: AppAuthPresentation
    let mode: AppShellMode
    let authState: AuthState

    @State private var showMfaStepUp = false

    private var selectedTab: Binding<AppTab> {
        Binding(
            get: { dependencies.shellNavigation.selectedTab },
            set: { dependencies.shellNavigation.selectedTab = $0 }
        )
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                if let sessionBannerMessage {
                    SessionEndedBanner(message: sessionBannerMessage) {
                        authPresentation.presentLogin(reason: sessionBannerMessage)
                    }
                }
                Group {
                    switch dependencies.shellNavigation.selectedTab {
                    case .home: HomeView()
                    case .social: SocialView()
                    case .search: SearchView()
                    case .profile: ProfileView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .environment(\.shellChromeMetrics, shellChromeMetrics)
            }
            .safeAreaInset(edge: .bottom) {
                shellChrome
            }

            if playbackCoordinator.playerSheet.isModalVisible {
                PlayerChromeOverlay()
                    .environmentObject(dependencies)
                    .environmentObject(playbackCoordinator)
                    .zIndex(50)
                    .transition(.opacity)
            }
        }
        .background(EarflowTheme.surfaceMain.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .earflowTypography()
        .sheet(isPresented: $showMfaStepUp) {
            MfaStepUpView()
                .environmentObject(dependencies)
        }
        .task {
            guard mode.isAuthenticated else { return }
            await dependencies.auth.refreshDiagnostics()
            await dependencies.deviceSync.connectIfAuthenticated()
            if await dependencies.auth.needsMfaStepUp() {
                showMfaStepUp = true
            }
        }
        .onChange(of: mode) { newMode in
            if newMode.isGuest {
                showMfaStepUp = false
                Task { await dependencies.deviceSync.disconnect() }
            } else if newMode.isAuthenticated {
                Task { await dependencies.deviceSync.connectIfAuthenticated() }
            }
        }
    }

    private var sessionBannerMessage: String? {
        switch authState {
        case .degraded:
            return "Слабая связь — работаем с кэшем. Некоторые действия могут быть недоступны."
        case .expired:
            return "Сессия истекла. Войдите снова."
        case .revoked:
            return "Вы вышли из аккаунта."
        case .error:
            return "Ошибка сессии. Войдите снова."
        default:
            return nil
        }
    }

    private var shellChrome: some View {
        VStack(spacing: EarflowTheme.miniPlayerFloatGap) {
            if mode.isAuthenticated, playbackCoordinator.nowPlaying != nil {
                MiniPlayerBar()
                    .environmentObject(dependencies)
                    .environmentObject(playbackCoordinator)
                    .padding(.horizontal, EarflowTheme.miniPlayerSideInset)
            }
            EarflowBottomBar(selection: selectedTab)
                .padding(.horizontal, EarflowTheme.miniPlayerSideInset)
        }
        .padding(.bottom, 0)
        .background(EarflowTheme.navBackground)
    }

    private var shellChromeMetrics: ShellChromeMetrics {
        let hasTrack = mode.isAuthenticated && playbackCoordinator.nowPlaying != nil
        let sheetOpen = playbackCoordinator.playerSheet.sheetProgress > 0.88
        return ShellChromeMetrics(hasMiniPlayer: hasTrack && !sheetOpen)
    }
}

/// Web `MobileBottomNav` — icon-only, 48px, #0D0D0D
struct EarflowBottomBar: View {
    @Binding var selection: AppTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                Button {
                    selection = tab
                } label: {
                    Image(systemName: tab.icon)
                        .font(.system(size: 22, weight: .regular))
                        .symbolVariant(selection == tab ? .fill : .none)
                        .foregroundStyle(
                            selection == tab
                                ? Color.white.opacity(0.98)
                                : Color.white.opacity(0.45)
                        )
                        .frame(maxWidth: .infinity)
                        .frame(height: EarflowTheme.navHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.label)
            }
        }
        .frame(height: EarflowTheme.navHeight)
        .background(EarflowTheme.navBackground)
    }
}
