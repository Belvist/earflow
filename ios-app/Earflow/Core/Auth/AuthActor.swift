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

    private let proofSkipPaths: Set<String> = [
        "/api/auth/email/login",
        "/api/auth/email/register",
        "/api/auth/telegram/login",
        "/api/auth/csrf",
        "/api/auth/device/register",
        "/api/public-config",
    ]

    private let proofSensitivePaths: Set<String> = [
        "/api/auth/logout",
        "/api/auth/refresh",
        "/api/auth/proof/token",
        "/api/auth/device/register",
        "/api/auth/telegram/unlink",
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
        Task { await installGatewayHooks() }
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

    /// Best-effort CSRF priming — may 403 without session (same as web; login skips CSRF).
    func prepareAuthSession() async {
        do {
            _ = try await gateway.requestData(method: .get, path: "/api/auth/csrf", skipAuth: true)
            await EarflowLog.shared.debug("auth", "csrf cookie primed")
        } catch {
            await EarflowLog.shared.debug("auth", "csrf prefetch skipped (expected before login)")
        }
    }

    func bootstrap() async {
        guard state == .unknown else { return }
        if SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL),
           (try? KeychainStore.loadDeviceIdentity()) != nil {
            await transition(to: .refreshing)
            do {
                try await ensureDeviceRegistered()
                _ = try await fetchProfile()
                await transition(to: .authenticated)
            } catch {
                await transition(to: .unauthenticated)
            }
        } else {
            await transition(to: .unauthenticated)
        }
    }

    /// After web login on auth.earflow.ru — cookies synced from WKWebView.
    func resumeSessionAfterWebLogin() async throws {
        await transition(to: .authenticating)
        do {
            guard SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL) else {
                throw GatewayError.network("session_not_established")
            }
            try await ensureDeviceRegistered()
            _ = try await fetchProfile()
            await transition(to: .authenticated)
            await EarflowLog.shared.info("auth", "web login complete")
        } catch {
            await transition(to: .unauthenticated)
            await EarflowLog.shared.error("auth", "web login failed: \(error.localizedDescription)")
            throw error
        }
    }

    func login(email: String, password: String) async throws {
        await transition(to: .authenticating)
        do {
            await prepareAuthSession()
            await EarflowLog.shared.info("auth", "login email")
            let response: LoginResponse = try await gateway.request(
                method: .post,
                path: "/api/auth/email/login",
                body: LoginRequest(email: email, password: password),
                skipAuth: true
            )
            guard SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL) else {
                await EarflowLog.shared.error("auth", "login: mp_sid cookie missing after response")
                throw GatewayError.network("session_not_established")
            }
            profile = response.user
            await EarflowLog.shared.info("auth", "login: session cookie ok, registering device")
            try await ensureDeviceRegistered()
            await EarflowLog.shared.info("auth", "login: device ok, fetching profile")
            _ = try await fetchProfile()
            await EarflowLog.shared.info("auth", "login: complete")
            await transition(to: .authenticated)
        } catch is CancellationError {
            await EarflowLog.shared.warning("auth", "login cancelled")
            if state == .authenticating {
                await transition(to: .unauthenticated)
            }
            throw CancellationError()
        } catch {
            await transition(to: .unauthenticated)
            await EarflowLog.shared.error("auth", "login failed: \(error.localizedDescription)")
            throw error
        }
    }

    func register(email: String, password: String, firstName: String, username: String) async throws {
        await transition(to: .authenticating)
        do {
            await prepareAuthSession()
            await EarflowLog.shared.info("auth", "register email")
            let response: LoginResponse = try await gateway.request(
                method: .post,
                path: "/api/auth/email/register",
                body: RegisterRequest(email: email, password: password, firstName: firstName, username: username),
                skipAuth: true
            )
            guard SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL) else {
                throw GatewayError.network("session_not_established")
            }
            profile = response.user
            try await ensureDeviceRegistered()
            _ = try await fetchProfile()
            await transition(to: .authenticated)
        } catch {
            await transition(to: .unauthenticated)
            await EarflowLog.shared.error("auth", "register failed: \(error.localizedDescription)")
            throw error
        }
    }

    func loginWithTelegram(payload: [String: Any]) async throws {
        await transition(to: .authenticating)
        do {
            await prepareAuthSession()
            await EarflowLog.shared.info("auth", "login telegram")
            let body = try TelegramLoginRequest(from: payload)
            let response: LoginResponse = try await gateway.request(
                method: .post,
                path: "/api/auth/telegram/login",
                body: body,
                skipAuth: true
            )
            guard SessionCookieStore.hasSessionCookie(for: AppConfiguration.current.gatewayBaseURL) else {
                throw GatewayError.network("session_not_established")
            }
            profile = response.user
            try await ensureDeviceRegistered()
            _ = try await fetchProfile()
            await transition(to: .authenticated)
        } catch {
            await transition(to: .unauthenticated)
            await EarflowLog.shared.error("auth", "telegram login failed: \(error.localizedDescription)")
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
    }

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
        let code = body.flatMap { try? JSONDecoder().decode(APIErrorBody.self, from: $0) }?.code
        if code == "DEVICE_REVOKED" || statusCode == 401 {
            await clearSession(reason: statusCode == 403 ? .revoked : .expired)
        }
    }

    // MARK: - Private

    private func installGatewayHooks() async {
        await gateway.bindAuthHooks(GatewayAuthHooks(
            authHeaders: { [self] method, path in
                try await self.gatewayAuthHeaders(method: method, path: path)
            },
            csrfToken: {
                SessionCookieStore.csrfToken(for: AppConfiguration.current.gatewayBaseURL)
            },
            unauthorized: { [self] status, body in
                await self.handleUnauthorizedResponse(statusCode: status, body: body)
            }
        ))
    }

    private func removeContinuation(_ id: UUID) {
        stateContinuations.removeValue(forKey: id)
    }

    private func transition(to newState: AuthState) async {
        state = newState
        for continuation in stateContinuations.values {
            continuation.yield(newState)
        }
    }

    private func clearSession(reason: AuthState) async {
        await proofTokenCache.clear()
        profile = nil
        try? KeychainStore.clear()
        deviceIdentity = nil
        privateKeyPKCS8 = nil
        await gateway.clearCookies()
        await transition(to: reason)
    }

    private func ensureDeviceRegistered() async throws {
        try loadOrCreateIdentity()
        guard let identity = deviceIdentity, let pkcs8 = privateKeyPKCS8 else {
            throw GatewayError.network("device_identity_missing")
        }
        if !identity.needsRegister { return }

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
        return user
    }

    private func exchangeProofAccessToken() async throws -> ProofAccessTokenCache.Entry {
        try await proofTokenCache.coalescedExchange {
            try await self.performProofTokenExchange()
        }
    }

    private func performProofTokenExchange() async throws -> ProofAccessTokenCache.Entry {
        guard let identity = deviceIdentity else {
            throw GatewayError.unauthorized(code: "device_identity_missing")
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
        return entry
    }

    private func fullProofHeaders(method: HTTPMethod, path: String) async throws -> [String: String] {
        guard let identity = deviceIdentity, let pkcs8 = privateKeyPKCS8 else {
            throw GatewayError.unauthorized(code: "DEVICE_PROOF_REQUIRED")
        }
        if identity.needsRegister { try await ensureDeviceRegistered() }
        guard let sidHash = deviceIdentity?.sidHash, !sidHash.isEmpty else {
            throw GatewayError.unauthorized(code: "DEVICE_PROOF_REQUIRED")
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
}

private struct EmptyBody: Encodable {}
