import SwiftUI

/// Earflow listener visual tokens — pixel-aligned with web `EmailAuth` / `index.css` / `MobileBottomNav`.
enum EarflowTheme {
    static let background = Color.black
    static let backgroundGradientTop = Color(red: 12 / 255, green: 12 / 255, blue: 12 / 255)
    static let cardTop = Color(red: 28 / 255, green: 28 / 255, blue: 28 / 255)
    static let cardBottom = Color(red: 12 / 255, green: 12 / 255, blue: 12 / 255)
    static let border = Color.white.opacity(0.14)
    static let borderSoft = Color.white.opacity(0.11)
    static let textPrimary = Color.white.opacity(0.96)
    static let textSecondary = Color.white.opacity(0.58)
    static let textMuted = Color.white.opacity(0.42)
    static let textFieldPlaceholder = Color.white.opacity(0.38)
    static let accent = Color(red: 0.42, green: 0.75, blue: 1.0)
    static let danger = Color(red: 1.0, green: 0.42, blue: 0.48) // #ff6b7a
    static let success = Color(red: 0.18, green: 0.83, blue: 0.49) // #2fd37c
    static let navBackground = Color(red: 13 / 255, green: 13 / 255, blue: 13 / 255) // #0D0D0D
    static let fieldBackground = Color.white.opacity(0.065)
    static let tabTrackBackground = Color.white.opacity(0.045)
    static let cornerRadius: CGFloat = 18
    static let cardCornerRadius: CGFloat = 18
    static let fieldRadius: CGFloat = 14
    static let buttonRadius: CGFloat = 14
    static let navHeight: CGFloat = 48

    static var authBackground: Color { background }

    /// Solid card — web uses near-flat dark gray, no visible gradient on mobile.
    static let cardSolid = Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255)

    static var cardBackground: Color { cardSolid }

    static func passwordToneColor(_ tone: AuthValidators.PasswordTone) -> Color {
        switch tone {
        case .idle: return Color.white.opacity(0.15)
        case .weak: return Color(red: 1, green: 0.42, blue: 0.48)
        case .medium: return Color(red: 0.94, green: 0.72, blue: 0.25)
        case .good: return Color(red: 0.45, green: 0.82, blue: 0.48)
        case .strong: return Color(red: 0.18, green: 0.83, blue: 0.49)
        }
    }
}

// MARK: - Auth card shell

struct EarflowAuthCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background(EarflowTheme.cardSolid)
            .overlay(
                RoundedRectangle(cornerRadius: EarflowTheme.cardCornerRadius)
                    .stroke(EarflowTheme.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: EarflowTheme.cardCornerRadius))
            .shadow(color: .black.opacity(0.55), radius: 24, y: 12)
    }
}

struct EarflowBrandView: View {
    var size: CGFloat = 24

    private let logoSources = [
        "https://earflow.ru/logo0.png?v=4",
        "https://earflow.ru/logo.png?v=4",
        "https://earflow.ru/logo.svg?v=4",
    ]
    @State private var sourceIndex = 0

    var body: some View {
        Group {
            if sourceIndex < logoSources.count, let url = URL(string: logoSources[sourceIndex]) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFit()
                    case .failure:
                        Text("Earflow")
                            .font(EarflowFont.brand)
                            .foregroundStyle(Color.white.opacity(0.95))
                            .onAppear { sourceIndex += 1 }
                    default:
                        ProgressView().tint(.white)
                    }
                }
            } else {
                Text("Earflow")
                    .font(EarflowFont.brand)
                    .foregroundStyle(Color.white.opacity(0.95))
            }
        }
        .frame(height: size)
    }
}

struct EarflowSecureBadge: View {
    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "lock.fill")
                .font(.system(size: 10, weight: .bold))
            Text("защищенный вход")
                .font(EarflowFont.unbounded(size: 10, weight: .bold))
                .textCase(.uppercase)
        }
        .foregroundStyle(Color.white.opacity(0.68))
        .padding(.horizontal, 10)
        .frame(minHeight: 28)
        .background(Color.white.opacity(0.055))
        .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 1))
        .clipShape(Capsule())
    }
}

// MARK: - Auth tabs (pill switcher — not UISegmentedControl)

struct EarflowAuthTabs: View {
    @Binding var isRegister: Bool

    var body: some View {
        HStack(spacing: 4) {
            authTab(title: "Вход", active: !isRegister) { isRegister = false }
            authTab(title: "Регистрация", active: isRegister) { isRegister = true }
        }
        .padding(4)
        .background(EarflowTheme.tabTrackBackground)
        .overlay(Capsule().stroke(Color.white.opacity(0.11), lineWidth: 1))
        .clipShape(Capsule())
    }

    private func authTab(title: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title.uppercased())
                .font(EarflowFont.authTab)
                .kerning(0.4)
                .foregroundStyle(active ? Color.black : Color.white.opacity(0.7))
                .frame(maxWidth: .infinity)
                .frame(minHeight: 38)
                .background(active ? Color.white.opacity(0.94) : Color.clear)
                .clipShape(Capsule())
                .shadow(color: active ? .black.opacity(0.28) : .clear, radius: 10, y: 4)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Inputs

struct EarflowAuthInput: View {
    enum Icon {
        case envelope, lock, person

        var systemName: String {
            switch self {
            case .envelope: return "envelope.fill"
            case .lock: return "lock.fill"
            case .person: return "person.fill"
            }
        }
    }

    let placeholder: String
    @Binding var text: String
    var icon: Icon
    var isSecure = false
    var keyboard: UIKeyboardType = .default
    var textContentType: UITextContentType?
    var autocapitalization: TextInputAutocapitalization = .never
    var errorMessage: String?

    @State private var reveal = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .leading) {
                HStack(spacing: 0) {
                    Image(systemName: icon.systemName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(focused ? Color.white.opacity(0.82) : Color.white.opacity(0.44))
                        .frame(width: 50, alignment: .center)
                    Group {
                        if isSecure && !reveal {
                            SecureField(placeholder, text: $text)
                        } else {
                            TextField(placeholder, text: $text)
                                .keyboardType(keyboard)
                                .textInputAutocapitalization(autocapitalization)
                        }
                    }
                    .textContentType(textContentType)
                    .font(EarflowFont.unbounded(size: 16, weight: .bold))
                    .foregroundStyle(EarflowTheme.textPrimary)
                    .autocorrectionDisabled()
                    if isSecure {
                        Spacer(minLength: 8)
                        Button {
                            reveal.toggle()
                        } label: {
                            Image(systemName: reveal ? "eye.slash.fill" : "eye.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(Color.white.opacity(0.62))
                                .frame(width: 32, height: 32)
                                .background(Color.white.opacity(0.06))
                                .clipShape(Circle())
                        }
                        .padding(.trailing, 10)
                    }
                }
            }
            .frame(height: 46)
            .background(focused ? Color.white.opacity(0.095) : EarflowTheme.fieldBackground)
            .overlay(
                RoundedRectangle(cornerRadius: EarflowTheme.fieldRadius)
                    .stroke(
                        errorMessage != nil
                            ? EarflowTheme.danger.opacity(0.55)
                            : (focused ? Color.white.opacity(0.34) : EarflowTheme.border),
                        lineWidth: 1
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: EarflowTheme.fieldRadius))
            .focused($focused)

            if let errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(EarflowFont.unbounded(size: 12, weight: .medium))
                    .foregroundStyle(EarflowTheme.danger)
                    .padding(.leading, 6)
            }
        }
    }
}

struct EarflowPasswordStrengthView: View {
    let strength: AuthValidators.PasswordStrength

    var body: some View {
        HStack(spacing: 10) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.08))
                    Capsule()
                        .fill(EarflowTheme.passwordToneColor(strength.tone))
                        .frame(width: geo.size.width * CGFloat(strength.percent) / 100)
                }
            }
            .frame(height: 4)
            Text(strength.label.isEmpty ? "Сложность" : strength.label.uppercased())
                .font(EarflowFont.unbounded(size: 11, weight: .semibold))
                .kerning(0.8)
                .foregroundStyle(EarflowTheme.passwordToneColor(strength.tone))
                .frame(minWidth: 56, alignment: .trailing)
        }
    }
}

struct EarflowAuthPrimaryButton: View {
    let title: String
    var loading = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if loading {
                    ProgressView().tint(.black)
                }
                Text(loading ? "Загрузка..." : title.uppercased())
                    .font(EarflowFont.authButton)
                    .kerning(0.9)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 46)
            .background(disabled ? Color.white.opacity(0.2) : Color.white.opacity(0.94))
            .foregroundStyle(disabled ? Color.white.opacity(0.38) : Color.black)
            .clipShape(RoundedRectangle(cornerRadius: EarflowTheme.buttonRadius))
            .shadow(color: disabled ? .clear : .black.opacity(0.3), radius: 10, y: 4)
        }
        .disabled(disabled || loading)
        .buttonStyle(.plain)
    }
}

struct EarflowAuthBackButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("Назад".uppercased())
                .font(EarflowFont.unbounded(size: 10, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.78))
                .frame(width: 92, height: 46)
                .background(Color.white.opacity(0.055))
                .overlay(
                    RoundedRectangle(cornerRadius: EarflowTheme.buttonRadius)
                        .stroke(Color.white.opacity(0.13), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: EarflowTheme.buttonRadius))
        }
        .buttonStyle(.plain)
    }
}

struct EarflowAuthDivider: View {
    var body: some View {
        HStack(spacing: 12) {
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
            Text("или")
                .font(EarflowFont.unbounded(size: 12, weight: .bold))
                .kerning(0.6)
                .textCase(.uppercase)
                .foregroundStyle(Color.white.opacity(0.42))
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
        }
        .padding(.vertical, 4)
    }
}

struct EarflowRegisterSteps: View {
    let step: Int

    var body: some View {
        HStack(spacing: 8) {
            stepPill("Профиль", active: step == 1)
            stepPill("Вход", active: step == 2)
        }
    }

    private func stepPill(_ title: String, active: Bool) -> some View {
        let fg = active ? Color.white.opacity(0.9) : Color.white.opacity(0.42)
        let bg = active ? Color.white.opacity(0.12) : Color.white.opacity(0.035)
        let stroke = active ? Color.white.opacity(0.28) : Color.white.opacity(0.09)
        return Text(title.uppercased())
            .font(EarflowFont.unbounded(size: 9, weight: .bold))
            .kerning(0.4)
            .foregroundStyle(fg)
            .frame(maxWidth: .infinity, minHeight: 24)
            .background(bg)
            .overlay(Capsule().stroke(stroke, lineWidth: 1))
            .clipShape(Capsule())
    }
}

// Compatibility wrapper for non-auth screens
struct EarflowTextField: View {
    let title: String
    @Binding var text: String
    var isSecure = false
    var keyboard: UIKeyboardType = .default
    var textContentType: UITextContentType?

    var body: some View {
        EarflowAuthInput(
            placeholder: title,
            text: $text,
            icon: isSecure ? .lock : .envelope,
            isSecure: isSecure,
            keyboard: keyboard,
            textContentType: textContentType
        )
    }
}

struct EarflowPrimaryButton: View {
    let title: String
    var loading = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        EarflowAuthPrimaryButton(title: title, loading: loading, disabled: disabled, action: action)
    }
}
