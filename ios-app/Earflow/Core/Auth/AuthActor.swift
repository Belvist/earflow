import Foundation

/// Auth orchestration — login, device register, proof token, session lifecycle.
actor AuthActor {
    private let gateway: GatewayClient
    private let proofTokenCache = ProofAccessTokenCache()
    private var state: AuthState = .unknown
    private var stateContinuations: [UUID: AsyncStream<AuthState>.Continuation] = [:]
    private var deviceIdentity: DeviceIdentity?
    private var privateKeyPKCS8: Data?
    private var profile: UserProfile?
    private var pendingMfaStepUp = false
    private var refreshInFlight: Task<RefreshSessionResult, Never>?
    private var bootstrapInFlight: Task<AuthBootstrapResult, Never>?
    private var hooksInstalled = false
    private var lifecycleHooks = SessionLifecycleHooks()

    private let proofSkipPaths: Set<String> = [
        "/api/auth/email/login",
        "/api/auth/email/register",
        "/api/auth/telegram/login",
        "/api/auth/csrf",
        "/api/auth/device/register",
        "/api/auth/native/exchange",
        "/api/public-config",
    ]

    private let proofSensitivePaths: Set<String> = [
        "/api/auth/logout",
        "/api/auth/refresh",
        "/api/auth/proof/token",
        "/api/auth/device/register",
        "/api/auth/telegram/unlink",
        "/api/auth/2fa/step-up",
        "/api/auth/2fa/step-up/status",
    ]

    private let proofSensitivePrefixes = [
        "/api/auth/sessions",
        "/api/auth/devices",
        "/api/auth/password",
        "/api/auth/security",
        "/api/auth/2fa",
        "/api/auth/stream-ticket",
    ]

    init(gateway: GatewayClient) {
        self.gateway = gateway
    }

    // MARK: - Public API

    func stateStream() -> AsyncStream<AuthState> {
        AsyncStream { continuation in
            let id = UUID()
            continuation.yield(state)
            stateContinuations[id] = continuation
            continuation.onTermination = { _ in
                Task { await self.removeContinuation(id) }
            }
        }
    }

    func currentState() -> AuthState { state }
    func currentProfile() -> UserProfile? { profile }
    func currentAuthDeviceId() -> String? { deviceIdentity?.authDeviceId }
    func needsMfaStepUp() -> Bool { pendingMfaStepUp }

    func refreshDiagnostics() async {
        let proofActive = await proofTokenCache.hasActiveToken()
        await AuthDiagnostics.shared.refreshFromEnvironment(
            authState: state,
            proofTokenActive: proofActive,
            profile: profile
        )
    }

    /// Best-effort CSRF priming — may 403 without session (same as web; login skips CSRF).
    func bindLifecycleHooks(_ hooks: SessionLifecycleHooks) {
        lifecycleHooks = hooks
    }

    func prepareAuthSession() async {
        let probe = await gateway.probeAuthEndpoint()
        await AuthDiagnostics.shared.recordAuthEndpointProbe(
            reachable: probe.reachable,
            statusCode: probe.statusCode
        )
        do {
            _ = try await gateway.requestData(method: .get, path: "/api/auth/csrf", skipAuth: true)
            await EarflowLog.shared.debug("auth", "csrf cookie primed")
        } catch {
            await EarflowLog.shared.debug("auth", "csrf prefetch skipped (expected before login)")
        }
    }

    /// Cold start — mirrors web `bootstrapAuthState` (device + profile + refresh, degraded on transient).
    func bootstrap() async {
        guard state == .unknown else { return }
        await installGatewayHooksIfNeeded()
        await prepareAuthSession()
        if let cached = SessionProfileCache.load() {
            profile = cached
        }
        await transition(to: .refreshing)
        let result = await runBootstrapAuthState(preferRefresh: false, softRevalidate: false)
        await applyBootstrapResult(result)
        await refreshDiagnostics()
    }

    /// Foreground / periodic revalidation — mirrors web `revalidateSession`.
    func revalidateSession(preferRefresh: Bool = true) async {
        guard state == .authenticated || state == .degraded else { return }
        let result = await runBootstrapAuthState(preferRefresh: preferRefresh, softRevalidate: true)
        await applyBootstrapResult(result)
        await refreshDiagnostics()
    }

    /// After native web login (ASWebAuthenticationSession + PKCE): exchange the one-time code for a
    /// device-bound session. The gateway binds this device's public key and sets session cookies;
    /// no separate device-register round trip is needed.
    func completeNativeWebLogin(code: String, codeVerifier: String) async throws {
        await installGatewayHooksIfNeeded()
        await transition(to: .authenticating)
        let path = "/api/auth/native/exchange"
        do {
            try loadOrCreateIdentity()
            guard let identity = deviceIdentity, let pkcs8 = privateKeyPKCS8 else {
                throw GatewayError.network("device_identity_missing")
            }
            await EarflowLog.shared.info("auth", "native web login: exchanging code")
            let response: NativeAuthExchangeResponse = try await gateway.request(
                method: .post,
                path: path,
                body: NativeAuthExchangeRequest(
                    code: code,
                    codeVerifier: codeVerifier,
                    authDeviceId: identity.authDeviceId,
                    publicKeySpki: identity.publicKeySpki
                ),
                skipAuth: true
            )
            guard SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL) else {
                let err = GatewayError.network("session_not_established")
                await AuthDiagnostics.shared.recordAuthAttempt(path: path, statusCode: nil, error: err)
                throw err
            }
            var updated = identity
            updated.sidHash = response.sidHash
            deviceIdentity = updated
            try KeychainStore.saveDeviceIdentity(updated, privateKeyPKCS8: pkcs8)
            if let user = response.user {
                profile = user
                SessionProfileCache.save(user)
            }
            _ = try await fetchProfile()
            await updateMfaFlagsAfterLogin()
            await transition(to: .authenticated)
            await AuthDiagnostics.shared.recordAuthAttempt(path: path, statusCode: 200, error: nil)
            await EarflowLog.shared.info("auth", "native web login complete")
        } catch {
            await transition(to: .unauthenticated)
            await recordAuthFailure(path: path, error: error)
            await logFailure("native web login", error: error)
            throw error
        }
        await refreshDiagnostics()
    }

    func login(email: String, password: String) async throws {
        await installGatewayHooksIfNeeded()
        await transition(to: .authenticating)
        let path = "/api/auth/email/login"
        do {
            await prepareAuthSession()
            await EarflowLog.shared.info("auth", "login email")
            let response: LoginResponse = try await gateway.request(
                method: .post,
                path: path,
                body: LoginRequest(email: email, password: password),
                skipAuth: true
            )
            try await completeLoginAfterCookies(loginResponse: response, path: path, statusCode: 200)
        } catch is CancellationError {
            await EarflowLog.shared.warning("auth", "login cancelled")
            if state == .authenticating {
                await transition(to: .unauthenticated)
            }
            throw CancellationError()
        } catch {
            await transition(to: .unauthenticated)
            await recordAuthFailure(path: path, error: error)
            await logFailure("login", error: error)
            throw error
        }
    }

    func register(email: String, password: String, firstName: String, username: String) async throws {
        await transition(to: .authenticating)
        let path = "/api/auth/email/register"
        do {
            await prepareAuthSession()
            await EarflowLog.shared.info("auth", "register email")
            let response: LoginResponse = try await gateway.request(
                method: .post,
                path: path,
                body: RegisterRequest(email: email, password: password, firstName: firstName, username: username),
                skipAuth: true
            )
            try await completeLoginAfterCookies(loginResponse: response, path: path, statusCode: 200)
        } catch {
            await transition(to: .unauthenticated)
            await recordAuthFailure(path: path, error: error)
            await logFailure("register", error: error)
            throw error
        }
    }

    func loginWithTelegram(payload: [String: Any]) async throws {
        await transition(to: .authenticating)
        let path = "/api/auth/telegram/login"
        do {
            await prepareAuthSession()
            await EarflowLog.shared.info("auth", "login telegram")
            let body = try TelegramLoginRequest(from: payload)
            let response: LoginResponse = try await gateway.request(
                method: .post,
                path: path,
                body: body,
                skipAuth: true
            )
            try await completeLoginAfterCookies(loginResponse: response, path: path, statusCode: 200)
        } catch {
            await transition(to: .unauthenticated)
            await recordAuthFailure(path: path, error: error)
            await logFailure("telegram login", error: error)
            throw error
        }
    }

    func logout() async {
        do {
            _ = try await gateway.requestData(method: .post, path: "/api/auth/logout", body: EmptyBody())
        } catch {
            GatewayLogger.debug("logout failed — clearing local session")
        }
        await clearSession(reason: .revoked)
        pendingMfaStepUp = false
        await refreshDiagnostics()
    }

    /// Renew gateway session cookies (same contract as web `POST /api/auth/refresh`).
    func refreshSession() async -> Bool {
        let result = await refreshSessionDetailed()
        return result.ok
    }

    func refreshSessionDetailed() async -> RefreshSessionResult {
        if let inFlight = refreshInFlight {
            return await inFlight.value
        }
        let task = Task { await self.performRefreshSessionDetailed() }
        refreshInFlight = task
        defer { refreshInFlight = nil }
        return await task.value
    }

    private func performRefreshSessionDetailed() async -> RefreshSessionResult {
        guard SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL) else {
            return RefreshSessionResult(
                ok: false,
                status: 401,
                code: BackendAuthCode.noSession,
                recoverable: false,
                reauthRequired: true
            )
        }
        do {
            _ = try await gateway.requestData(
                method: .post,
                path: "/api/auth/refresh",
                body: EmptyBody(),
                allowRefreshOnUnauthorized: false
            )
            await EarflowLog.shared.debug("auth", "session refreshed")
            return RefreshSessionResult(ok: true, status: 200, code: nil, recoverable: false, reauthRequired: false)
        } catch let error as GatewayError {
            await EarflowLog.shared.warning("auth", "session refresh failed: \(error)")
            return refreshResult(from: error)
        } catch {
            await EarflowLog.shared.warning("auth", "session refresh failed: \(error)")
            return RefreshSessionResult(ok: false, status: 0, code: nil, recoverable: true, reauthRequired: false)
        }
    }

    private func refreshResult(from error: GatewayError) -> RefreshSessionResult {
        switch error {
        case .unauthorized(let detail), .forbidden(let detail):
            return RefreshSessionResult(
                ok: false,
                status: detail.status,
                code: detail.code,
                recoverable: detail.recoverable,
                reauthRequired: detail.reauthRequired
            )
        case .serverError(let detail):
            return RefreshSessionResult(
                ok: false,
                status: detail.status,
                code: detail.code ?? BackendAuthCode.serverError,
                recoverable: detail.recoverable,
                reauthRequired: detail.reauthRequired
            )
        case .rateLimited:
            return RefreshSessionResult(
                ok: false,
                status: 429,
                code: BackendAuthCode.rateLimited,
                recoverable: true,
                reauthRequired: false
            )
        case .network:
            return RefreshSessionResult(ok: false, status: 0, code: nil, recoverable: true, reauthRequired: false)
        default:
            return RefreshSessionResult(ok: false, status: 0, code: nil, recoverable: false, reauthRequired: false)
        }
    }

    /// POST /api/auth/2fa/step-up — same contract as web (no bypass).
    func submitMfaStepUp(totpCode: String? = nil, recoveryCode: String? = nil) async throws {
        let body: MfaStepUpRequest
        if let totpCode, !totpCode.isEmpty {
            body = MfaStepUpRequest(totpCode: totpCode)
        } else if let recoveryCode, !recoveryCode.isEmpty {
            body = MfaStepUpRequest(recoveryCode: recoveryCode)
        } else {
            throw GatewayError.network("mfa_code_required")
        }
        let _: MfaStepUpResponse = try await gateway.request(
            method: .post,
            path: "/api/auth/2fa/step-up",
            body: body
        )
        pendingMfaStepUp = false
        await AuthDiagnostics.shared.recordMfaStepUp(active: true)
        await EarflowLog.shared.info("auth", "mfa step-up ok")
        await refreshDiagnostics()
    }

    func fetchMfaStepUpStatus() async -> Bool {
        do {
            let status: MfaStepUpStatusResponse = try await gateway.request(
                method: .get,
                path: "/api/auth/2fa/step-up/status"
            )
            let active = status.ok == true || status.active == true
            await AuthDiagnostics.shared.recordMfaStepUp(active: active)
            if active { pendingMfaStepUp = false }
            return active
        } catch {
            return false
        }
    }

    /// Post-login gate checks — profile from gateway, refresh, identity.
    func verifyAuthenticatedSession() async -> SessionVerificationReport {
        var report = SessionVerificationReport()
        do {
            let user = try await fetchProfile()
            report.profileOk = user.resolvedId != nil
            report.profileUserId = user.resolvedId
            report.identityFromGateway = true
            report.mfaEnabled = user.mfaEnabled == true
            await AuthDiagnostics.shared.recordProfile(user, fromGateway: true)
        } catch {
            report.profileOk = false
            report.identityFromGateway = false
        }
        report.hasMpSid = SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL)
        report.refreshOk = await refreshSession()
        report.proofTokenActive = await proofTokenCache.hasActiveToken()
        if profile?.mfaEnabled == true {
            report.mfaStepUpActive = await fetchMfaStepUpStatus()
        }
        await refreshDiagnostics()
        return report
    }

    #if DEBUG
    /// Dev-only: simulate expired session (cookies cleared, Keychain kept).
    func debugSimulateExpiredSession() async {
        await gateway.clearCookies()
        await proofTokenCache.clear()
        await transition(to: .expired)
        await refreshDiagnostics()
    }
    #endif

    // MARK: - Gateway hooks

    func gatewayAuthHeaders(method: HTTPMethod, path: String) async throws -> [String: String] {
        let normalizedPath = endpointPath(path)
        if proofSkipPaths.contains(normalizedPath) { return [:] }
        if isSensitiveProofPath(normalizedPath) {
            return try await fullProofHeaders(method: method, path: path)
        }
        if let cached = await proofTokenCache.getValid() {
            return [
                "X-Auth-Device-Id": cached.authDeviceId,
                "X-Auth-Proof-Access-Token": cached.token,
            ]
        }
        let entry = try await exchangeProofAccessToken()
        return [
            "X-Auth-Device-Id": entry.authDeviceId,
            "X-Auth-Proof-Access-Token": entry.token,
        ]
    }

    func handleUnauthorizedResponse(statusCode: Int, body: Data?) async {
        if state == .authenticating || state == .unknown || state == .unauthenticated || state == .refreshing {
            return
        }

        let bodyParsed = body.flatMap { try? JSONDecoder().decode(APIErrorBody.self, from: $0) }
        let code = BackendAuthCode.normalize(rawCode: bodyParsed?.code, message: bodyParsed?.error)

        if bodyParsed?.reauthRequired == true {
            await clearSession(reason: .expired)
            return
        }

        if let code, BackendAuthCode.isRevoked(code) {
            await clearSession(reason: .revoked)
            return
        }

        if statusCode == 403, code == BackendAuthCode.deviceRevoked {
            await clearSession(reason: .revoked)
            return
        }

        if let code, BackendAuthCode.isStepUpRequired(code) {
            pendingMfaStepUp = true
            await AuthDiagnostics.shared.recordMfaStepUp(active: false)
            return
        }

        if bodyParsed?.recoverable == true {
            return
        }

        if let code, BackendAuthCode.isDeviceProof(code) || BackendAuthCode.isCsrf(code) {
            return
        }

        if statusCode == 401, let code, BackendAuthCode.isSessionExpired(code) {
            await clearSession(reason: .expired)
            return
        }

        // Generic 401 without fatal code — do not logout (web: auth lost only after refresh retry).
    }

    /// Invalidate stale device binding and re-register — web `invalidateAuthDeviceBinding` + `ensureAuthDeviceRegistered({ force: true })`.
    func recoverDeviceBinding() async -> Bool {
        do {
            try loadOrCreateIdentity()
            guard var identity = deviceIdentity, let pkcs8 = privateKeyPKCS8 else { return false }
            identity.sidHash = ""
            deviceIdentity = identity
            try KeychainStore.saveDeviceIdentity(identity, privateKeyPKCS8: pkcs8)
            await proofTokenCache.clear()
            try await ensureDeviceRegistered(force: true)
            await EarflowLog.shared.info("auth", "device binding recovered")
            return true
        } catch {
            await EarflowLog.shared.warning("auth", "device binding recovery failed: \(error)")
            return false
        }
    }

    // MARK: - Private

    private func installGatewayHooksIfNeeded() async {
        guard !hooksInstalled else { return }
        hooksInstalled = true
        await installGatewayHooks()
    }

    private func installGatewayHooks() async {
        await gateway.bindAuthHooks(GatewayAuthHooks(
            authHeaders: { [self] method, path in
                try await self.gatewayAuthHeaders(method: method, path: path)
            },
            csrfToken: {
                SessionCookieStore.csrfToken(for: AppConfiguration.current.gatewayBaseURL)
            },
            refreshSession: { [self] in
                await self.refreshSession()
            },
            recoverDeviceProof: { [self] in
                await self.recoverDeviceBinding()
            },
            unauthorized: { [self] status, body in
                await self.handleUnauthorizedResponse(statusCode: status, body: body)
            }
        ))
    }

    private func completeLoginAfterCookies(
        loginResponse: LoginResponse,
        path: String,
        statusCode: Int
    ) async throws {
        guard SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL) else {
            let err = GatewayError.network("session_not_established")
            await AuthDiagnostics.shared.recordAuthAttempt(path: path, statusCode: statusCode, error: err)
            throw err
        }
        profile = loginResponse.user
        await EarflowLog.shared.info("auth", "login: session cookie ok, registering device")
        try await ensureDeviceRegistered(force: true)
        _ = try await fetchProfile()
        await updateMfaFlagsAfterLogin()
        await transition(to: .authenticated)
        await AuthDiagnostics.shared.recordAuthAttempt(path: path, statusCode: statusCode, error: nil)
        await refreshDiagnostics()
        await logLoginPipelineComplete(loginPath: path)
    }

    private func logLoginPipelineComplete(loginPath: String) async {
        let hasSid = SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL)
        let userId = profile?.resolvedId
        let deviceOk = deviceIdentity?.needsRegister == false
        let mfa = profile?.mfaEnabled == true
        let stepUp = mfa ? !pendingMfaStepUp : false
        await EarflowLog.shared.info(
            "auth",
            "pipeline ok login=\(loginPath) mp_sid=\(hasSid) device=\(deviceOk) profile=\(userId != nil) userId=\(userId.map(String.init) ?? "nil") mfa=\(mfa) stepUpClear=\(stepUp) state=authenticated"
        )
    }

    private func updateMfaFlagsAfterLogin() async {
        guard profile?.mfaEnabled == true else {
            pendingMfaStepUp = false
            await AuthDiagnostics.shared.recordMfaStepUp(active: false)
            return
        }
        let active = await fetchMfaStepUpStatus()
        pendingMfaStepUp = !active
        await AuthDiagnostics.shared.recordMfaStepUp(active: active)
    }

    private func recordAuthFailure(path: String, error: Error) async {
        let status: Int?
        if let gateway = error as? GatewayError {
            switch gateway {
            case .unauthorized(let detail), .forbidden(let detail):
                status = detail.status
            case .serverError(let detail):
                status = detail.status
            default:
                status = nil
            }
        } else {
            status = nil
        }
        await AuthDiagnostics.shared.recordAuthAttempt(path: path, statusCode: status, error: error)
        await refreshDiagnostics()
    }

    private func removeContinuation(_ id: UUID) {
        stateContinuations.removeValue(forKey: id)
    }

    private func transition(to newState: AuthState) async {
        state = newState
        await AuthDiagnostics.shared.recordAuthState(newState)
        for continuation in stateContinuations.values {
            continuation.yield(newState)
        }
    }

    private func clearSession(reason: AuthState) async {
        await proofTokenCache.clear()
        profile = nil
        pendingMfaStepUp = false
        SessionProfileCache.clear()
        try? KeychainStore.clear()
        deviceIdentity = nil
        privateKeyPKCS8 = nil
        await gateway.clearCookies()
        await lifecycleHooks.onSessionCleared?()
        await transition(to: reason)
    }

    private func ensureDeviceRegistered(force: Bool = false) async throws {
        try loadOrCreateIdentity()
        guard let identity = deviceIdentity, let pkcs8 = privateKeyPKCS8 else {
            throw GatewayError.network("device_identity_missing")
        }
        if !force, !identity.needsRegister { return }

        await EarflowLog.shared.info("auth", "device register force=\(force)")
        let response: DeviceRegisterResponse = try await gateway.request(
            method: .post,
            path: "/api/auth/device/register",
            body: DeviceRegisterRequest(
                authDeviceId: identity.authDeviceId,
                publicKeySpki: identity.publicKeySpki
            )
        )
        var updated = identity
        updated.sidHash = response.sidHash
        deviceIdentity = updated
        try KeychainStore.saveDeviceIdentity(updated, privateKeyPKCS8: pkcs8)
    }

    private func loadOrCreateIdentity() throws {
        if let loaded = try KeychainStore.loadDeviceIdentity() {
            deviceIdentity = loaded.identity
            privateKeyPKCS8 = loaded.privateKeyPKCS8
            return
        }
        let (privateKey, spki) = try DeviceProofSigner.generateKeyPair()
        let pkcs8 = DeviceProofSigner.exportPrivateKeyPKCS8(privateKey)
        let identity = DeviceIdentity(
            authDeviceId: DeviceProofSigner.generateAuthDeviceId(),
            sidHash: "",
            publicKeySpki: spki,
            createdAt: Date()
        )
        deviceIdentity = identity
        privateKeyPKCS8 = pkcs8
        try KeychainStore.saveDeviceIdentity(identity, privateKeyPKCS8: pkcs8)
    }

    @discardableResult
    private func fetchProfile() async throws -> UserProfile {
        let user: UserProfile = try await gateway.request(method: .get, path: "/api/profile")
        profile = user
        SessionProfileCache.save(user)
        await AuthDiagnostics.shared.recordProfile(user, fromGateway: true)
        return user
    }

    // MARK: - Bootstrap (web AuthContext parity)

    private func runBootstrapAuthState(preferRefresh: Bool, softRevalidate: Bool) async -> AuthBootstrapResult {
        if !softRevalidate, let inFlight = bootstrapInFlight {
            return await inFlight.value
        }
        if softRevalidate {
            return await bootstrapAuthState(preferRefresh: preferRefresh, softRevalidate: true)
        }
        let task = Task { await self.bootstrapAuthState(preferRefresh: preferRefresh, softRevalidate: false) }
        bootstrapInFlight = task
        let result = await task.value
        bootstrapInFlight = nil
        return result
    }

    private func bootstrapAuthState(preferRefresh: Bool, softRevalidate: Bool) async -> AuthBootstrapResult {
        if preferRefresh {
            return await refreshThenProfile(softRevalidate: softRevalidate)
        }

        let deviceReady = await ensureDeviceProofReady()
        if !deviceReady {
            if softRevalidate, let cached = cachedAuthUser(), AuthSessionPolicy.hasResolvableUser(cached) {
                return degradedAuthResult(code: "device_register_pending")
            }
            await clearSession(reason: .unauthenticated)
            return AuthBootstrapResult(outcome: .guest, profile: nil, diagnosticCode: "device_register_pending")
        }

        do {
            let user = try await fetchProfile()
            if AuthSessionPolicy.hasResolvableUser(user) {
                return AuthBootstrapResult(outcome: .authenticated, profile: user, diagnosticCode: nil)
            }
            return AuthBootstrapResult(outcome: .guest, profile: nil, diagnosticCode: "profile_empty")
        } catch {
            let projection = AuthErrorProjection.from(error: error, path: "/api/profile")
            let status = projection.httpStatus ?? 0
            let code = projection.backendCode

            if status == 401 {
                if code == BackendAuthCode.deviceProofRequired || code == BackendAuthCode.deviceRevoked {
                    if let recovered = await recoverDeviceProofAndProfile(),
                       AuthSessionPolicy.hasResolvableUser(recovered) {
                        return AuthBootstrapResult(outcome: .authenticated, profile: recovered, diagnosticCode: nil)
                    }
                    if softRevalidate, let cached = cachedAuthUser(), AuthSessionPolicy.hasResolvableUser(cached) {
                        return degradedAuthResult(code: code)
                    }
                    await clearSession(reason: .unauthenticated)
                    return AuthBootstrapResult(outcome: .guest, profile: nil, diagnosticCode: code)
                }
                return await refreshThenProfile(softRevalidate: softRevalidate)
            }

            if AuthSessionPolicy.isTransientHTTPStatus(status) {
                return degradedAuthResult(code: code ?? "profile_failed")
            }
            return degradedAuthResult(code: code ?? "profile_failed")
        }
    }

    private func refreshThenProfile(softRevalidate: Bool) async -> AuthBootstrapResult {
        let refreshed = await refreshSessionDetailed()
        if refreshed.ok {
            let deviceReady = await ensureDeviceProofReady()
            if !deviceReady {
                if softRevalidate, let cached = cachedAuthUser(), AuthSessionPolicy.hasResolvableUser(cached) {
                    return degradedAuthResult(code: "device_register_pending")
                }
                await clearSession(reason: .unauthenticated)
                return AuthBootstrapResult(outcome: .guest, profile: nil, diagnosticCode: "device_register_pending")
            }
            do {
                let user = try await fetchProfile()
                if AuthSessionPolicy.hasResolvableUser(user) {
                    return AuthBootstrapResult(outcome: .authenticated, profile: user, diagnosticCode: nil)
                }
                return degradedAuthResult(code: "profile_empty_after_refresh")
            } catch {
                let projection = AuthErrorProjection.from(error: error, path: "/api/profile")
                if isReauthFromError(error) {
                    await clearSession(reason: .unauthenticated)
                    return AuthBootstrapResult(outcome: .guest, profile: nil, diagnosticCode: projection.backendCode)
                }
                return degradedAuthResult(code: projection.backendCode ?? "profile_after_refresh_failed")
            }
        }

        if AuthSessionPolicy.isBackendReauthRequired(code: refreshed.code, reauthRequired: refreshed.reauthRequired) {
            if softRevalidate, let cached = cachedAuthUser(), AuthSessionPolicy.hasResolvableUser(cached) {
                return degradedAuthResult(code: refreshed.code ?? "session_unverified")
            }
            await clearSession(reason: .unauthenticated)
            return AuthBootstrapResult(outcome: .guest, profile: nil, diagnosticCode: refreshed.code)
        }

        if refreshed.status == 401 || AuthSessionPolicy.isBackendRecoverable(code: refreshed.code, recoverable: refreshed.recoverable) {
            if let cached = cachedAuthUser(), AuthSessionPolicy.hasResolvableUser(cached) {
                return degradedAuthResult(code: refreshed.code ?? "session_unverified")
            }
            await clearSession(reason: .unauthenticated)
            return AuthBootstrapResult(outcome: .guest, profile: nil, diagnosticCode: refreshed.code)
        }

        return degradedAuthResult(code: refreshed.code ?? "refresh_failed")
    }

    private func ensureDeviceProofReady() async -> Bool {
        do {
            try loadOrCreateIdentity()
            try await ensureDeviceRegistered(force: false)
            return true
        } catch {
            return false
        }
    }

    private func recoverDeviceProofAndProfile() async -> UserProfile? {
        guard await recoverDeviceBinding() else { return nil }
        do {
            let user = try await fetchProfile()
            return AuthSessionPolicy.hasResolvableUser(user) ? user : nil
        } catch {
            return nil
        }
    }

    private func cachedAuthUser() -> UserProfile? {
        profile ?? SessionProfileCache.load()
    }

    private func degradedAuthResult(code: String?) -> AuthBootstrapResult {
        AuthBootstrapResult(outcome: .degraded, profile: cachedAuthUser(), diagnosticCode: code)
    }

    private func applyBootstrapResult(_ result: AuthBootstrapResult) async {
        switch result.outcome {
        case .authenticated:
            if let user = result.profile {
                profile = user
                SessionProfileCache.save(user)
            }
            await updateMfaFlagsAfterLogin()
            await transition(to: .authenticated)
            await prewarmProofAccessToken()
            await EarflowLog.shared.info(
                "auth",
                "bootstrap authenticated userId=\(profile?.resolvedId.map(String.init) ?? "nil")"
            )
        case .degraded:
            if let user = result.profile {
                profile = user
            }
            await transition(to: .degraded)
            await EarflowLog.shared.warning(
                "auth",
                "bootstrap degraded code=\(result.diagnosticCode ?? "nil") userId=\(profile?.resolvedId.map(String.init) ?? "nil")"
            )
        case .guest:
            await clearSession(reason: .unauthenticated)
            await EarflowLog.shared.info("auth", "bootstrap guest code=\(result.diagnosticCode ?? "nil")")
        }
    }

    private func prewarmProofAccessToken() async {
        _ = try? await exchangeProofAccessToken()
    }

    private func isReauthFromError(_ error: Error) -> Bool {
        if let gateway = error as? GatewayError {
            switch gateway {
            case .unauthorized(let detail), .forbidden(let detail):
                return AuthSessionPolicy.isBackendReauthRequired(
                    code: detail.code,
                    reauthRequired: detail.reauthRequired
                )
            default:
                break
            }
        }
        let projection = AuthErrorProjection.from(error: error, path: "/api/profile")
        return AuthSessionPolicy.isBackendReauthRequired(code: projection.backendCode, reauthRequired: false)
    }

    private func exchangeProofAccessToken() async throws -> ProofAccessTokenCache.Entry {
        try await proofTokenCache.coalescedExchange {
            try await self.performProofTokenExchange()
        }
    }

    private func performProofTokenExchange() async throws -> ProofAccessTokenCache.Entry {
        guard let identity = deviceIdentity else {
            throw GatewayError.unauthorized(GatewayHTTPErrorDetail(status: 401, code: "device_identity_missing", message: nil, retryAfterSeconds: nil))
        }
        if identity.needsRegister { try await ensureDeviceRegistered() }

        let proof = try await fullProofHeaders(method: .post, path: "/api/auth/proof/token")
        let data = try await gateway.requestWithAdditionalHeaders(
            method: .post,
            path: "/api/auth/proof/token",
            body: EmptyBody(),
            additionalHeaders: proof
        )

        let body = try JSONDecoder().decode(ProofTokenResponse.self, from: data)
        let expiresAtMs: Int64
        if let parsed = body.expiresAt, let date = ISO8601DateFormatter().date(from: parsed) {
            expiresAtMs = Int64(date.timeIntervalSince1970 * 1000)
        } else {
            expiresAtMs = Int64(Date().timeIntervalSince1970 * 1000) + Int64(body.expiresIn ?? 90) * 1000
        }
        let entry = ProofAccessTokenCache.Entry(
            token: body.token,
            authDeviceId: identity.authDeviceId,
            expiresAtMs: expiresAtMs
        )
        await proofTokenCache.set(entry)
        await AuthDiagnostics.shared.recordProofTokenActive(true)
        return entry
    }

    private func fullProofHeaders(method: HTTPMethod, path: String) async throws -> [String: String] {
        guard let identity = deviceIdentity, let pkcs8 = privateKeyPKCS8 else {
            throw GatewayError.unauthorized(GatewayHTTPErrorDetail(status: 401, code: "DEVICE_PROOF_REQUIRED", message: nil, retryAfterSeconds: nil))
        }
        if identity.needsRegister { try await ensureDeviceRegistered() }
        guard let sidHash = deviceIdentity?.sidHash, !sidHash.isEmpty else {
            throw GatewayError.unauthorized(GatewayHTTPErrorDetail(status: 401, code: "DEVICE_PROOF_REQUIRED", message: nil, retryAfterSeconds: nil))
        }
        let privateKey = try DeviceProofSigner.importPrivateKey(pkcs8: pkcs8)
        let url = path.hasPrefix("http") ? path : fullURL(path: path)
        var headers = try DeviceProofSigner.sign(
            privateKey: privateKey,
            method: method.rawValue,
            url: url,
            sidHash: sidHash
        )
        headers.deviceId = identity.authDeviceId
        return headers.asHTTPHeaders()
    }

    private func isSensitiveProofPath(_ path: String) -> Bool {
        if proofSensitivePaths.contains(path) { return true }
        return proofSensitivePrefixes.contains { path.hasPrefix($0) }
    }

    private func endpointPath(_ endpoint: String) -> String {
        let raw = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("http"), let url = URL(string: raw) { return url.path }
        if let q = raw.firstIndex(of: "?") { return String(raw[..<q]) }
        return raw
    }

    private func fullURL(path: String) -> String {
        if path.hasPrefix("http") { return path }
        return AppConfiguration.current.gatewayBaseURL.appending(path: path).absoluteString
    }

    private func logFailure(_ context: String, error: Error) async {
        if let gateway = error as? GatewayError {
            await EarflowLog.shared.error("auth", "\(context) failed: \(gateway)")
        } else {
            await EarflowLog.shared.error("auth", "\(context) failed: \(error.localizedDescription)")
        }
    }
}

struct SessionVerificationReport: Sendable, Equatable {
    var profileOk = false
    var profileUserId: Int?
    var identityFromGateway = false
    var hasMpSid = false
    var refreshOk = false
    var proofTokenActive = false
    var mfaEnabled = false
    var mfaStepUpActive = false
}

private struct EmptyBody: Encodable {}
