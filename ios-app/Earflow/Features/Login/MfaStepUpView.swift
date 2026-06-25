import SwiftUI

/// Minimal MFA step-up — POST /api/auth/2fa/step-up (same as web).
struct MfaStepUpView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var recoveryCode = ""
    @State private var useRecovery = false
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("На аккаунте включена двухфакторная аутентификация. Введите код из приложения-аутентификатора.")
                    .font(EarflowFont.unbounded(size: 12, weight: .medium))
                    .foregroundStyle(EarflowTheme.textSecondary)

                Toggle("Код восстановления", isOn: $useRecovery)
                    .font(EarflowFont.unbounded(size: 11, weight: .medium))

                if useRecovery {
                    EarflowAuthInput(
                        placeholder: "Recovery code",
                        text: $recoveryCode,
                        icon: .lock,
                        isSecure: true
                    )
                } else {
                    EarflowAuthInput(
                        placeholder: "6-digit code",
                        text: $code,
                        icon: .lock,
                        keyboard: .numberPad
                    )
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(EarflowFont.unbounded(size: 11, weight: .medium))
                        .foregroundStyle(EarflowTheme.danger)
                }

                EarflowAuthPrimaryButton(
                    title: "Подтвердить",
                    loading: isLoading,
                    disabled: isLoading || !canSubmit
                ) {
                    Task { await submit() }
                }

                Spacer()
            }
            .padding(20)
            .background(EarflowTheme.authBackground.ignoresSafeArea())
            .navigationTitle("2FA")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Позже") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var canSubmit: Bool {
        if useRecovery { return !recoveryCode.trimmingCharacters(in: .whitespaces).isEmpty }
        return code.trimmingCharacters(in: .whitespaces).count >= 6
    }

    private func submit() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            if useRecovery {
                try await dependencies.auth.submitMfaStepUp(recoveryCode: recoveryCode.trimmingCharacters(in: .whitespaces))
            } else {
                try await dependencies.auth.submitMfaStepUp(totpCode: code.trimmingCharacters(in: .whitespaces))
            }
            dismiss()
        } catch {
            errorMessage = AuthErrorClassifier.userMessage(for: error, path: "/api/auth/2fa/step-up")
        }
    }
}
