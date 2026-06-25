import SwiftUI

/// Profile / empty states — CTA to open login sheet (guest mode only).
struct GuestAuthPromptView: View {
    let title: String
    let message: String
    let buttonTitle: String
    var onLogin: () -> Void

    var body: some View {
        HomeQueueStatusCard(kind: .guestLogin, onAction: onLogin)
            .padding(.horizontal, 12)
    }
}

/// Compact banner when session expired / revoked — guest shell stays visible.
struct SessionEndedBanner: View {
    let message: String
    let onLogin: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(EarflowTheme.accent)
            Text(message)
                .font(EarflowFont.unbounded(size: 11, weight: .medium))
                .foregroundStyle(EarflowTheme.textSecondary)
            Spacer(minLength: 8)
            Button("Войти", action: onLogin)
                .font(EarflowFont.unbounded(size: 11, weight: .bold))
                .foregroundStyle(EarflowTheme.accent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(EarflowTheme.cardTop.opacity(0.9))
    }
}
