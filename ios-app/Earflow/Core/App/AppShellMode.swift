import Foundation
import SwiftUI

/// Guest vs signed-in shell — UI projection of `AuthState`, not a second auth SoT.
enum AppShellMode: Equatable, Sendable {
    case guest
    case authenticated

    init(authState: AuthState, profile: UserProfile? = nil) {
        switch authState {
        case .authenticated, .refreshing:
            self = .authenticated
        case .degraded:
            self = AuthSessionPolicy.hasResolvableUser(profile) ? .authenticated : .guest
        default:
            self = .guest
        }
    }

    var isGuest: Bool { self == .guest }
    var isAuthenticated: Bool { self == .authenticated }
}

/// Presents native login sheet over MainShell (never replaces root).
@MainActor
final class AppAuthPresentation: ObservableObject {
    @Published var showLoginSheet = false
    @Published var loginReason: String?

    func presentLogin(reason: String? = nil) {
        loginReason = reason
        showLoginSheet = true
    }

    func dismissLogin() {
        showLoginSheet = false
        loginReason = nil
    }

    /// Returns true when caller may proceed with a protected action.
    func guardAuthenticated(auth: AuthActor, reason: String) async -> Bool {
        let state = await auth.currentState()
        switch state {
        case .authenticated, .refreshing, .degraded:
            return true
        default:
            presentLogin(reason: reason)
            return false
        }
    }
}

private struct AppShellModeKey: EnvironmentKey {
    static let defaultValue: AppShellMode = .guest
}

extension EnvironmentValues {
    var appShellMode: AppShellMode {
        get { self[AppShellModeKey.self] }
        set { self[AppShellModeKey.self] = newValue }
    }
}
