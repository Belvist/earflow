import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

// Native web login — OAuth 2.0 Authorization Code + PKCE (S256) via ASWebAuthenticationSession.
//
// The system browser owns the login page: the app never sees the password, the DOM, or the web
// session cookies (Apple isolates the session). Success is delivered as a one-time `code` on the
// `earflow://auth/callback` redirect, which the app exchanges for a device-bound session
// (`AuthActor.completeNativeWebLogin`). This replaces the former WKWebView cookie-transplant flow
// (single control path — INV-ARCH-001).

enum NativeAuthError: LocalizedError, Equatable {
    case cancelled
    case invalidCallback
    case server(String)
    case session(String)

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "Вход отменён"
        case .invalidCallback:
            return "Некорректный ответ авторизации. Попробуйте снова."
        case .server(let code):
            switch code {
            case "login_required":
                return "Вход не завершён на сайте. Попробуйте снова."
            case "server_unavailable", "server_error":
                return "Сервис авторизации недоступен. Попробуйте позже."
            default:
                return "Ошибка авторизации (\(code))."
            }
        case .session(let message):
            return "Не удалось открыть окно входа: \(message)"
        }
    }
}

struct NativeAuthResult: Sendable {
    let code: String
    let codeVerifier: String
}

enum PKCE {
    struct Pair: Sendable {
        let verifier: String
        let challenge: String
    }

    /// RFC 7636: 43–128 char verifier; challenge = base64url(SHA256(verifier)).
    static func generate() -> Pair {
        let verifier = randomURLSafe(byteCount: 64)
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Pair(verifier: verifier, challenge: Data(digest).base64URLEncodedString())
    }

    static func randomState() -> String { randomURLSafe(byteCount: 24) }

    private static func randomURLSafe(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URLEncodedString()
    }
}

enum NativeAuthURL {
    static func authorizeURL(challenge: String, state: String) throws -> URL {
        let finalize = AppConfiguration.current.gatewayBaseURL.appending(path: "/api/auth/native/finalize")
        guard var finalizeComponents = URLComponents(url: finalize, resolvingAgainstBaseURL: false) else {
            throw NativeAuthError.invalidCallback
        }
        finalizeComponents.queryItems = [
            URLQueryItem(name: "redirect_uri", value: AppConfiguration.current.nativeAuthRedirectURI),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        guard let finalizeURL = finalizeComponents.url else { throw NativeAuthError.invalidCallback }

        let login = AppConfiguration.current.webLoginBaseURL.appending(path: "/login")
        guard var loginComponents = URLComponents(url: login, resolvingAgainstBaseURL: false) else {
            throw NativeAuthError.invalidCallback
        }
        loginComponents.queryItems = [
            URLQueryItem(name: "return_to", value: finalizeURL.absoluteString),
            URLQueryItem(name: "reason", value: "ios_login"),
        ]
        guard let url = loginComponents.url else { throw NativeAuthError.invalidCallback }
        return url
    }

    static func parseCallback(_ url: URL, expectedState: String, verifier: String) throws -> NativeAuthResult {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first(where: { $0.name == name })?.value }

        // Constant-time-ish state check (anti-CSRF/replay on the redirect).
        guard let returnedState = value("state"), returnedState == expectedState else {
            throw NativeAuthError.invalidCallback
        }
        if let error = value("error"), !error.isEmpty {
            throw NativeAuthError.server(error)
        }
        guard let code = value("code"), !code.isEmpty else {
            throw NativeAuthError.invalidCallback
        }
        return NativeAuthResult(code: code, codeVerifier: verifier)
    }
}

/// Drives a single ASWebAuthenticationSession login attempt. Retains the session for the flow's
/// lifetime; safe to create per attempt.
@MainActor
final class NativeWebLoginController: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func authenticate() async throws -> NativeAuthResult {
        let pkce = PKCE.generate()
        let state = PKCE.randomState()
        let authorizeURL = try NativeAuthURL.authorizeURL(challenge: pkce.challenge, state: state)
        let scheme = AppConfiguration.current.nativeAuthCallbackScheme

        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let webSession = ASWebAuthenticationSession(url: authorizeURL, callbackURLScheme: scheme) { url, error in
                if let error {
                    if let asError = error as? ASWebAuthenticationSessionError, asError.code == .canceledLogin {
                        continuation.resume(throwing: NativeAuthError.cancelled)
                    } else {
                        continuation.resume(throwing: NativeAuthError.session(error.localizedDescription))
                    }
                    return
                }
                guard let url else {
                    continuation.resume(throwing: NativeAuthError.invalidCallback)
                    return
                }
                continuation.resume(returning: url)
            }
            webSession.presentationContextProvider = self
            // Allow Safari SSO (seamless if already signed in on device). First use prompts once.
            webSession.prefersEphemeralWebBrowserSession = false
            session = webSession
            if !webSession.start() {
                continuation.resume(throwing: NativeAuthError.session("start_failed"))
            }
        }

        return try NativeAuthURL.parseCallback(callback, expectedState: state, verifier: pkce.verifier)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
        return windows.first(where: { $0.isKeyWindow }) ?? windows.first ?? ASPresentationAnchor()
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
