import SwiftUI
import WebKit

/// Same login surface as web: https://auth.earflow.ru/login (EmailAuth SPA).
struct AuthWebLoginView: View {
    @Environment(\.dismiss) private var dismiss
    let onComplete: () async -> Void
    let onFailure: (String) -> Void

    private static let loginURL = URL(
        string: "https://auth.earflow.ru/login?return_to=https%3A%2F%2Fearflow.ru%2F&reason=login"
    )!

    var body: some View {
        NavigationStack {
            AuthWebLoginWebView(
                startURL: Self.loginURL,
                onLoginRedirect: {
                    await SessionCookieStore.syncFromWebKit()
                    await onComplete()
                    dismiss()
                },
                onFailure: onFailure
            )
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle("Вход Earflow")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

private struct AuthWebLoginWebView: UIViewRepresentable {
    let startURL: URL
    let onLoginRedirect: () async -> Void
    let onFailure: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onLoginRedirect: onLoginRedirect, onFailure: onFailure)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        context.coordinator.webView = webView
        webView.load(URLRequest(url: startURL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onLoginRedirect: () async -> Void
        let onFailure: (String) -> Void
        weak var webView: WKWebView?
        private var didComplete = false

        init(onLoginRedirect: @escaping () async -> Void, onFailure: @escaping (String) -> Void) {
            self.onLoginRedirect = onLoginRedirect
            self.onFailure = onFailure
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard !didComplete, let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            if isPostLoginRedirect(url) {
                didComplete = true
                decisionHandler(.cancel)
                Task {
                    await EarflowLog.shared.info("auth", "web login redirect: \(url.host ?? "")")
                    await onLoginRedirect()
                }
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            onFailure("Не удалось открыть auth.earflow.ru: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            onFailure("Не удалось открыть auth.earflow.ru: \(error.localizedDescription)")
        }

        private func isPostLoginRedirect(_ url: URL) -> Bool {
            let host = url.host?.lowercased() ?? ""
            guard url.scheme == "https", host != "auth.earflow.ru" else { return false }
            return host == "earflow.ru" || host.hasSuffix(".earflow.ru")
        }
    }
}
