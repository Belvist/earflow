import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @EnvironmentObject private var authPresentation: AppAuthPresentation
    @Environment(\.appShellMode) private var shellMode
    @State private var profile: UserProfile?

    var body: some View {
        NavigationStack {
            Group {
                if shellMode.isGuest {
                    GuestAuthPromptView(
                        title: "Войдите в Earflow",
                        message: "Профиль, настройки и библиотека доступны после входа.",
                        buttonTitle: "Войти"
                    ) {
                        authPresentation.presentLogin(reason: "Войдите, чтобы открыть профиль.")
                    }
                } else {
                    authenticatedProfile
                }
            }
            .background(EarflowTheme.background)
            .navigationTitle("Профиль")
        }
    }

    private var authenticatedProfile: some View {
        List {
            Section {
                if let profile {
                    LabeledContent("Email") {
                        Text(profile.email ?? "—").foregroundStyle(EarflowTheme.textSecondary)
                    }
                    LabeledContent("Имя") {
                        Text(profile.displayName ?? profile.username ?? "—")
                            .foregroundStyle(EarflowTheme.textSecondary)
                    }
                } else {
                    ProgressView()
                }
            }
            Section {
                NavigationLink("Настройки") {
                    SettingsView()
                }
            }
        }
        .scrollContentBackground(.hidden)
        .task {
            profile = await dependencies.auth.currentProfile()
        }
    }
}
