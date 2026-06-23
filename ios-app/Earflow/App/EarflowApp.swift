import SwiftUI

@main
struct EarflowApp: App {
    @StateObject private var dependencies = AppDependencies()

    init() {
        EarflowFont.registerFontsIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(dependencies)
                .earflowTypography()
                .onAppear {
                    if !EarflowFontRegistrar.verifyLoaded() {
                        Task { await EarflowLog.shared.warning("ui", "Unbounded font not loaded — check UIAppFonts") }
                    }
                }
        }
    }
}

/// Routes between login and main shell based on auth state.
struct RootView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @State private var authState: AuthState = .unknown

    var body: some View {
        Group {
            switch authState {
            case .unknown:
                ZStack {
                    EarflowTheme.background.ignoresSafeArea()
                    ProgressView("Earflow")
                        .tint(EarflowTheme.accent)
                }
                .task { await bootstrap() }
            case .authenticating, .unauthenticated, .expired, .revoked, .error:
                LoginView(authState: authState)
            case .authenticated, .refreshing:
                MainShellView()
            }
        }
        .preferredColorScheme(.dark)
        .task {
            for await state in dependencies.auth.stateStream() {
                authState = state
            }
        }
    }

    private func bootstrap() async {
        await EarflowLog.shared.info("app", "bootstrap")
        await dependencies.auth.bootstrap()
    }
}
