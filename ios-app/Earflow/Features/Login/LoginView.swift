import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var dependencies: AppDependencies
    @StateObject private var viewModel = AuthScreenViewModel()
    @State private var showWebLogin = false
    var authState: AuthState = .unauthenticated

    private var isAuthInFlight: Bool {
        viewModel.isLoading || authState == .authenticating
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                EarflowTheme.authBackground.ignoresSafeArea()
                ScrollView(showsIndicators: false) {
                    EarflowAuthCard {
                        VStack(alignment: .leading, spacing: 12) {
                            authHeader
                            connectionStatus
                            EarflowAuthTabs(isRegister: $viewModel.isRegister)
                                .onChange(of: viewModel.isRegister) { _, _ in
                                    viewModel.onModeChanged()
                                }

                            if !viewModel.isRegister && viewModel.showTelegram {
                                TelegramLoginWidget(botUsername: viewModel.telegramBotUsername) { payload in
                                    Task { await viewModel.signInTelegram(payload: payload, auth: dependencies.auth) }
                                }
                                .frame(minHeight: 52)
                                EarflowAuthDivider()
                            }

                            registerStepsIfNeeded
                            formFields
                            messages
                            webLoginButton
                            actionRow
                        }
                    }
                    .frame(maxWidth: 456)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 24)
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .center)
                }
            }
        }
        .preferredColorScheme(.dark)
        .earflowTypography()
        .task {
            await viewModel.prepare(dependencies: dependencies)
        }
        .sheet(isPresented: $showWebLogin) {
            AuthWebLoginView(
                onComplete: {
                    do {
                        try await dependencies.auth.resumeSessionAfterWebLogin()
                        viewModel.successMessage = "Вход выполнен!"
                        viewModel.errorMessage = nil
                    } catch {
                        viewModel.errorMessage = AuthScreenViewModel.userMessage(for: error)
                    }
                },
                onFailure: { message in
                    viewModel.errorMessage = message
                }
            )
        }
    }

    private var authHeader: some View {
        VStack(alignment: .center, spacing: 7) {
            Text(viewModel.isRegister ? "Создать аккаунт" : "Войти в Earflow")
                .font(EarflowFont.authTitle)
                .foregroundStyle(EarflowTheme.textPrimary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
            Text(viewModel.subtitle)
                .font(EarflowFont.unbounded(size: 11, weight: .medium))
                .foregroundStyle(EarflowTheme.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
                .frame(maxWidth: .infinity)
        }
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private var connectionStatus: some View {
        VStack(spacing: 6) {
            #if DEBUG
            Text("API: \(AppConfiguration.current.gatewayDisplayURL)")
                .font(EarflowFont.unbounded(size: 9, weight: .medium))
                .foregroundStyle(EarflowTheme.textSecondary)
                .frame(maxWidth: .infinity, alignment: .center)
            #endif
            if let status = viewModel.serverStatusMessage {
                Text(status)
                    .font(EarflowFont.unbounded(size: 10, weight: .medium))
                    .foregroundStyle(viewModel.serverReachable ? EarflowTheme.success : EarflowTheme.danger)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            #if DEBUG
            if !viewModel.serverReachable, !AppConfiguration.current.isLocalDev {
                Text(viewModel.localDevHint)
                    .font(EarflowFont.unbounded(size: 9, weight: .medium))
                    .foregroundStyle(EarflowTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            #endif
        }
    }

    @ViewBuilder
    private var registerStepsIfNeeded: some View {
        if viewModel.isRegister {
            EarflowRegisterSteps(step: viewModel.registerStep)
        }
    }

    @ViewBuilder
    private var formFields: some View {
        if viewModel.isRegister && viewModel.registerStep == 1 {
            VStack(alignment: .leading, spacing: 10) {
                sectionLabel("Профиль")
                EarflowAuthInput(
                    placeholder: "Имя",
                    text: $viewModel.firstName,
                    icon: .person,
                    textContentType: .givenName,
                    autocapitalization: .words,
                    errorMessage: viewModel.showValidation ? viewModel.firstNameError : nil
                )
                EarflowAuthInput(
                    placeholder: "Username",
                    text: $viewModel.username,
                    icon: .person,
                    textContentType: .username,
                    errorMessage: viewModel.showValidation ? viewModel.usernameError : nil
                )
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if viewModel.isRegister {
                    sectionLabel("Email и пароль")
                }
                EarflowAuthInput(
                    placeholder: "Email",
                    text: $viewModel.email,
                    icon: .envelope,
                    keyboard: .emailAddress,
                    textContentType: .emailAddress,
                    errorMessage: viewModel.showValidation ? viewModel.emailError : nil
                )
                VStack(alignment: .leading, spacing: 6) {
                    EarflowAuthInput(
                        placeholder: viewModel.isRegister ? "Пароль (минимум 8)" : "Пароль",
                        text: $viewModel.password,
                        icon: .lock,
                        isSecure: true,
                        textContentType: viewModel.isRegister ? .newPassword : .password,
                        errorMessage: viewModel.showValidation ? viewModel.passwordError : nil
                    )
                    if viewModel.isRegister && !viewModel.password.isEmpty {
                        EarflowPasswordStrengthView(strength: AuthValidators.evaluatePassword(viewModel.password))
                    }
                }
                if viewModel.isRegister {
                    EarflowAuthInput(
                        placeholder: "Подтвердите пароль",
                        text: $viewModel.confirmPassword,
                        icon: .lock,
                        isSecure: true,
                        textContentType: .newPassword,
                        errorMessage: viewModel.showValidation ? viewModel.confirmPasswordError : nil
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var messages: some View {
        if let error = viewModel.errorMessage {
            HStack(spacing: 8) {
                Image(systemName: "xmark.circle.fill")
                Text(error)
            }
            .font(EarflowFont.unbounded(size: 12, weight: .medium))
            .foregroundStyle(EarflowTheme.danger)
        }
        if let success = viewModel.successMessage {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                Text(success)
            }
            .font(EarflowFont.unbounded(size: 12, weight: .medium))
            .foregroundStyle(EarflowTheme.success)
        }
    }

    private var webLoginButton: some View {
        Button {
            showWebLogin = true
        } label: {
            Text("Войти как на сайте (auth.earflow.ru)")
                .font(EarflowFont.unbounded(size: 11, weight: .medium))
                .foregroundStyle(EarflowTheme.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
        }
        .disabled(isAuthInFlight)
    }

    private var actionRow: some View {
        HStack(spacing: 8) {
            if viewModel.isRegister && viewModel.registerStep == 2 {
                EarflowAuthBackButton {
                    viewModel.goBackRegisterStep()
                }
            }
            EarflowAuthPrimaryButton(
                title: viewModel.primaryButtonTitle,
                loading: isAuthInFlight,
                disabled: !viewModel.canSubmit || isAuthInFlight
            ) {
                Task { await viewModel.submit(dependencies: dependencies) }
            }
        }
        .padding(.top, 4)
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(EarflowFont.unbounded(size: 9, weight: .bold))
            .kerning(0.5)
            .foregroundStyle(Color.white.opacity(0.48))
    }
}

@MainActor
final class AuthScreenViewModel: ObservableObject {
    @Published var isRegister = false
    @Published var registerStep = 1
    @Published var email = ""
    @Published var password = ""
    @Published var confirmPassword = ""
    @Published var firstName = ""
    @Published var username = ""
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var successMessage: String?
    @Published var telegramBotUsername = ""
    @Published var showTelegram = false
    @Published var showValidation = false
    @Published var serverReachable = false
    @Published var serverStatusMessage: String?

    var subtitle: String {
        if isRegister {
            return registerStep == 1
                ? "Сначала имя и username. Потом email и пароль."
                : "Email и пароль защищают вход в аккаунт."
        }
        return "Продолжайте слушать с того места, где остановились."
    }

    var primaryButtonTitle: String {
        if isRegister && registerStep == 1 { return "Продолжить" }
        if isRegister { return "Создать аккаунт" }
        return "Войти"
    }

    var canSubmit: Bool {
        if isLoading { return false }
        if isRegister && registerStep == 1 {
            return !firstName.trimmingCharacters(in: .whitespaces).isEmpty
                && AuthValidators.isValidUsername(AuthValidators.normalizeUsername(username))
        }
        let strength = AuthValidators.evaluatePassword(password)
        if isRegister {
            return AuthValidators.isValidEmail(email)
                && strength.meetsPolicy
                && password == confirmPassword
        }
        return AuthValidators.isValidEmail(email) && !password.isEmpty
    }

    var emailError: String? {
        AuthValidators.isValidEmail(email) ? nil : "Неверный формат email"
    }

    var passwordError: String? {
        guard isRegister else { return nil }
        return AuthValidators.evaluatePassword(password).meetsPolicy
            ? nil
            : "Минимум 8 символов, буква и цифра"
    }

    var confirmPasswordError: String? {
        guard isRegister else { return nil }
        return password == confirmPassword ? nil : "Пароли не совпадают"
    }

    var firstNameError: String? {
        firstName.trimmingCharacters(in: .whitespaces).isEmpty ? "Введите имя" : nil
    }

    var usernameError: String? {
        AuthValidators.isValidUsername(AuthValidators.normalizeUsername(username))
            ? nil
            : "Username: 3–32 символа, буквы, цифры, ._-"
    }

    func onModeChanged() {
        registerStep = 1
        showValidation = false
        errorMessage = nil
        successMessage = nil
    }

    func goBackRegisterStep() {
        registerStep = 1
        showValidation = false
        errorMessage = nil
    }

    private var isProbing = false

    var localDevHint: String {
        "Симулятор не находит сервер? Проверьте DNS на Mac (System Settings → Network → Wi‑Fi → DNS → 8.8.8.8) и отключите VPN, затем перезапустите симулятор."
    }

    func prepare(dependencies: AppDependencies) async {
        if isProbing { return }
        isProbing = true
        defer { isProbing = false }
        let host = AppConfiguration.current.gatewayBaseURL.host ?? "api.earflow.ru"
        do {
            let config = try await dependencies.catalog.fetchPublicConfig()
            let bot = TelegramLoginWidget.Coordinator.normalizeBotUsername(config.telegramBotUsername ?? "")
            telegramBotUsername = bot
            showTelegram = !bot.isEmpty
            serverReachable = true
            serverStatusMessage = nil
            await EarflowLog.shared.info("auth", "gateway reachable")
            await dependencies.auth.prepareAuthSession()
        } catch {
            serverReachable = false
            serverStatusMessage = AuthScreenViewModel.reachabilityMessage(for: error, host: host)
            await EarflowLog.shared.error("auth", "gateway unreachable: \(error)")
            showTelegram = false
        }
    }

    func submit(dependencies: AppDependencies) async {
        showValidation = true

        if isRegister && registerStep == 1 {
            if firstNameError != nil || usernameError != nil {
                errorMessage = firstNameError ?? usernameError
                return
            }
            registerStep = 2
            showValidation = false
            errorMessage = nil
            return
        }

        guard canSubmit else {
            errorMessage = emailError ?? passwordError ?? confirmPasswordError ?? "Проверьте поля формы"
            return
        }

        if !serverReachable {
            await prepare(dependencies: dependencies)
            guard serverReachable else {
                errorMessage = serverStatusMessage
                return
            }
        }

        isLoading = true
        errorMessage = nil
        successMessage = nil
        defer { isLoading = false }

        do {
            if isRegister {
                try await dependencies.auth.register(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password,
                    firstName: firstName.trimmingCharacters(in: .whitespaces),
                    username: AuthValidators.normalizeUsername(username)
                )
                successMessage = "Регистрация успешна!"
            } else {
                try await dependencies.auth.login(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password
                )
                successMessage = "Вход выполнен!"
            }
        } catch {
            errorMessage = AuthScreenViewModel.describe(error)
        }
    }

    func signInTelegram(payload: [String: Any], auth: AuthActor) async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            try await auth.loginWithTelegram(payload: payload)
            successMessage = "Вход выполнен!"
        } catch {
            errorMessage = AuthScreenViewModel.describe(error)
        }
    }

    private static func reachabilityMessage(for error: Error, host: String) -> String {
        if let gateway = error as? GatewayError, case let .network(code) = gateway {
            switch code {
            case GatewayNetworkCode.dnsLookupFailed.rawValue:
                #if DEBUG
                return "Нет DNS для \(host). Симулятор без интернета — включите локальный API (см. подсказку ниже)."
                #else
                return "Не удалось найти \(host) (DNS). Отключите VPN и откройте https://\(host)/api/public-config в Safari на этом устройстве."
                #endif
            case GatewayNetworkCode.offline.rawValue:
                return "Нет интернета. Проверьте Wi‑Fi или мобильную сеть."
            case GatewayNetworkCode.timeout.rawValue:
                return "Таймаут при подключении к \(host). Попробуйте снова."
            default:
                break
            }
        }
        return "Нет связи с \(host). Проверьте интернет."
    }

    static func userMessage(for error: Error) -> String {
        describe(error)
    }

    private static func describe(_ error: Error) -> String {
        if let gateway = error as? GatewayError {
            switch gateway {
            case .unauthorized(let code):
                if code == "INVALID_CREDENTIALS" || code == nil {
                    return "Неверный email или пароль."
                }
                return "Сессия отклонена (\(code ?? "401"))."
            case .forbidden(let code):
                if code == "DEVICE_REVOKED" { return "Устройство отозвано. Войдите снова." }
                return code ?? "Доступ запрещён."
            case .rateLimited: return "Слишком много попыток. Подождите."
            case .serverError: return "Ошибка сервера Earflow. Попробуйте позже."
            case .blockedHost: return "Заблокированный хост. Разрешён только api.earflow.ru."
            case .network(let msg):
                if msg == GatewayNetworkCode.dnsLookupFailed.rawValue {
                    return "DNS не находит api.earflow.ru. Отключите VPN или проверьте DNS на устройстве."
                }
                if msg == GatewayNetworkCode.offline.rawValue {
                    return "Нет интернета."
                }
                if msg.contains("session_not_established") {
                    return "Сервер не выдал сессию. Проверьте аккаунт или попробуйте позже."
                }
                return "Нет связи с api.earflow.ru: \(msg)"
            default: return "Не удалось войти. См. журнал в Настройках."
            }
        }
        return error.localizedDescription
    }
}
