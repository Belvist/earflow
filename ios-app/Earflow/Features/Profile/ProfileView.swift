import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @State private var profile: UserProfile?

    var body: some View {
        NavigationStack {
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
            .background(EarflowTheme.background)
            .navigationTitle("Профиль")
            .task {
                profile = await dependencies.auth.currentProfile()
            }
        }
    }
}
