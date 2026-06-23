import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var dependencies: AppDependencies

    var body: some View {
        List {
            Section("Сессия") {
                Button("Выйти", role: .destructive) {
                    Task { await dependencies.auth.logout() }
                }
            }
            Section("Диагностика") {
                NavigationLink("Журнал отладки") {
                    DebugLogView()
                }
            }
            Section("О приложении") {
                LabeledContent("API", value: AppConfiguration.current.gatewayBaseURL.host ?? "api.earflow.ru")
                LabeledContent("Версия", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0")
            }
        }
        .scrollContentBackground(.hidden)
        .background(EarflowTheme.background)
        .navigationTitle("Настройки")
    }
}

struct DebugLogView: View {
    @State private var entries: [LogEntry] = []
    @State private var exportText = ""
    @State private var showShare = false

    var body: some View {
        List {
            Section {
                Button("Обновить") { Task { await refresh() } }
                Button("Экспорт") {
                    Task {
                        exportText = await EarflowLog.shared.exportText()
                        showShare = true
                    }
                }
                Button("Очистить", role: .destructive) {
                    Task {
                        await EarflowLog.shared.clear()
                        await refresh()
                    }
                }
            }
            Section("Последние записи") {
                if entries.isEmpty {
                    Text("Журнал пуст")
                        .foregroundStyle(EarflowTheme.textMuted)
                } else {
                    ForEach(entries.reversed()) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("[\(entry.level.rawValue.uppercased())] \(entry.category)")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(levelColor(entry.level))
                            Text(entry.message)
                                .font(.caption)
                                .foregroundStyle(EarflowTheme.textPrimary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(EarflowTheme.background)
        .navigationTitle("Журнал")
        .task { await refresh() }
        .sheet(isPresented: $showShare) {
            ShareSheet(items: [exportText])
        }
    }

    private func refresh() async {
        entries = await EarflowLog.shared.recent(limit: 200)
    }

    private func levelColor(_ level: LogLevel) -> Color {
        switch level {
        case .error: return EarflowTheme.danger
        case .warning: return .orange
        case .info: return EarflowTheme.accent
        case .debug: return EarflowTheme.textMuted
        }
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
