import Foundation

/// Cross-tab navigation from feature screens (e.g. Home «Новинки» → Search).
@MainActor
final class AppShellNavigation: ObservableObject {
    @Published var selectedTab: AppTab = .home

    func openSearch() {
        selectedTab = .search
    }
}
