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
    @State private var selectedTab: AppTab = .home

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch selectedTab {
                case .home: HomeView()
                case .social: SocialView()
                case .search: SearchView()
                case .profile: ProfileView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .safeAreaInset(edge: .bottom) {
                shellChrome
            }
        }
        .background(EarflowTheme.background.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .earflowTypography()
        .sheet(
            isPresented: Binding(
                get: { dependencies.playbackCoordinator.sheetExpanded },
                set: { dependencies.playbackCoordinator.sheetExpanded = $0 }
            )
        ) {
            PlayerSheetView()
                .environmentObject(dependencies)
        }
    }

    private var shellChrome: some View {
        VStack(spacing: 6) {
            if dependencies.playbackCoordinator.nowPlaying != nil {
                MiniPlayerBar()
                    .environmentObject(dependencies)
                    .padding(.horizontal, 6)
            }
            EarflowBottomBar(selection: $selectedTab)
                .padding(.horizontal, 6)
        }
        .padding(.bottom, 0)
        .background(EarflowTheme.navBackground)
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
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.label)
            }
        }
        .frame(height: EarflowTheme.navHeight)
        .background(EarflowTheme.navBackground)
    }
}
