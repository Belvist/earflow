import SwiftUI

#if DEBUG
/// Dev-only auth gate diagnostics — no secrets in UI.
struct AuthDiagnosticsView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @State private var snapshot = AuthDiagnosticsSnapshot.initial
    @State private var verification = SessionVerificationReport()
    @State private var isRefreshing = false

    var body: some View {
        List {
            Section("Reachability") {
                row("Gateway reachable", snapshot.gatewayReachable)
                row("Auth endpoint reachable", snapshot.authEndpointReachable)
            }
            Section("Last auth attempt") {
                LabeledContent("Path", value: snapshot.lastAuthPath ?? "—")
                LabeledContent("HTTP status", value: snapshot.lastAuthStatusCode.map(String.init) ?? "—")
                if let projection = snapshot.lastErrorProjection {
                    LabeledContent("Backend code", value: projection.backendCode ?? "—")
                    LabeledContent("Provenance", value: projection.provenance.rawValue)
                    LabeledContent("Category (projection)", value: projection.category.diagnosticKey)
                    if let msg = projection.backendMessage, !msg.isEmpty {
                        LabeledContent("Backend message", value: msg)
                    }
                } else {
                    LabeledContent("Error projection", value: "—")
                }
            }
            Section("Session cookies (client diagnostic only)") {
                row("mp_sid cookie", snapshot.hasMpSid)
                if let domain = snapshot.mpSidDomain {
                    LabeledContent("mp_sid domain", value: domain)
                }
                row("mp_csrf cookie", snapshot.hasMpCsrf)
                if let domain = snapshot.mpCsrfDomain {
                    LabeledContent("mp_csrf domain", value: domain)
                }
                row("Proof token in RAM", snapshot.proofTokenActive)
            }
            Section("Authenticated state (backend SoT)") {
                LabeledContent("Auth state", value: snapshot.authState.rawValue)
                LabeledContent("Profile user id (gateway)", value: snapshot.profileUserId.map(String.init) ?? "—")
                row("Profile from /api/profile", snapshot.profileFromGateway)
                Text("Cookies present ≠ authenticated. SoT: successful /api/profile.")
                    .font(.caption2)
                    .foregroundStyle(EarflowTheme.textMuted)
            }
            Section("MFA (backend flags)") {
                row("MFA enabled (profile)", snapshot.mfaEnabled)
                row("MFA step-up active", snapshot.mfaStepUpActive)
            }
            Section("Post-login verify") {
                row("Profile OK", verification.profileOk)
                LabeledContent("Gateway user id", value: verification.profileUserId.map(String.init) ?? "—")
                row("mp_sid after verify", verification.hasMpSid)
                row("Refresh OK", verification.refreshOk)
                row("Proof token", verification.proofTokenActive)
            }
            Section {
                Button(isRefreshing ? "Обновление…" : "Обновить диагностику") {
                    Task { await refresh() }
                }
                .disabled(isRefreshing)
                Button("Запустить session verify") {
                    Task {
                        verification = await dependencies.auth.verifyAuthenticatedSession()
                        await refreshSnapshot()
                    }
                }
                Button("Выйти", role: .destructive) {
                    Task { await dependencies.auth.logout() }
                }
                Button("Simulate expired (dev)") {
                    Task { await dependencies.auth.debugSimulateExpiredSession() }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(EarflowTheme.background)
        .navigationTitle("Auth Gate")
        .task { await refresh() }
    }

    private func row(_ title: String, _ value: Bool) -> some View {
        LabeledContent(title) {
            Text(value ? "yes" : "no")
                .foregroundStyle(value ? EarflowTheme.success : EarflowTheme.danger)
        }
    }

    private func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        await dependencies.auth.refreshDiagnostics()
        let probe = await dependencies.gateway.probeAuthEndpoint()
        await AuthDiagnostics.shared.recordAuthEndpointProbe(
            reachable: probe.reachable,
            statusCode: probe.statusCode
        )
        await refreshSnapshot()
    }

    private func refreshSnapshot() async {
        snapshot = await AuthDiagnostics.shared.current()
    }
}
#endif
