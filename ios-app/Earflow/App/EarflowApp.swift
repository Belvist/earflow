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
                .environmentObject(dependencies.playbackCoordinator)
                .environmentObject(dependencies.authPresentation)
                .earflowTypography()
                .onAppear {
                    if !EarflowFontRegistrar.bundledFontPresent() {
                        Task { await EarflowLog.shared.warning("ui", "Unbounded.ttf missing from app bundle — run: cd ios-app && xcodegen generate, then Clean Build") }
                    } else if !EarflowFontRegistrar.verifyLoaded() {
                        Task { await EarflowLog.shared.warning("ui", "Unbounded font not loaded — check UIAppFonts / CTFontManager") }
                    }
                }
        }
    }
}

/// Guest-first shell: MainShell before login; LoginView is a sheet, not root.
struct RootView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var authPresentation: AppAuthPresentation
    @Environment(\.scenePhase) private var scenePhase
    @State private var authState: AuthState = .unknown
    @State private var cachedProfile: UserProfile?
    @State private var revalidateTask: Task<Void, Never>?

    private var shellMode: AppShellMode {
        AppShellMode(authState: authState, profile: cachedProfile)
    }

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
            default:
                MainShellView(mode: shellMode, authState: authState)
                    .environment(\.appShellMode, shellMode)
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $authPresentation.showLoginSheet) {
            NavigationStack {
                LoginView(authState: authState)
                    .environmentObject(dependencies)
                    .environmentObject(authPresentation)
            }
        }
        .task {
            for await state in dependencies.auth.stateStream() {
                authState = state
                cachedProfile = await dependencies.auth.currentProfile()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            guard authState == .authenticated || authState == .degraded else { return }
            // Profile-only revalidate — no POST /api/auth/refresh on every lock-screen unlock.
            Task { await dependencies.auth.revalidateSession(preferRefresh: false) }
        }
        .onChange(of: authState) { _, newState in
            if newState == .authenticated || newState == .degraded {
                authPresentation.dismissLogin()
                startPeriodicRevalidation()
            } else {
                stopPeriodicRevalidation()
            }
        }
    }

    private func startPeriodicRevalidation() {
        revalidateTask?.cancel()
        revalidateTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 12 * 60 * 1_000_000_000)
                guard !Task.isCancelled else { return }
                await dependencies.auth.revalidateSession()
            }
        }
    }

    private func stopPeriodicRevalidation() {
        revalidateTask?.cancel()
        revalidateTask = nil
    }

    private func bootstrap() async {
        await EarflowLog.shared.info("app", "bootstrap")
        await dependencies.auth.bootstrap()
    }
}
