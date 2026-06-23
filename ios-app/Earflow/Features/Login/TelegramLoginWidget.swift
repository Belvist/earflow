import SwiftUI
import WebKit

struct TelegramLoginWidget: UIViewRepresentable {
    let botUsername: String
    let onAuth: ([String: Any]) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onAuth: onAuth)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "telegramAuth")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        context.coordinator.loadWidget(botUsername: botUsername)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        if context.coordinator.loadedBot != botUsername {
            context.coordinator.loadWidget(botUsername: botUsername)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var onAuth: ([String: Any]) -> Void
        weak var webView: WKWebView?
        var loadedBot = ""

        init(onAuth: @escaping ([String: Any]) -> Void) {
            self.onAuth = onAuth
        }

        func loadWidget(botUsername: String) {
            let bot = Self.normalizeBotUsername(botUsername)
            guard !bot.isEmpty else { return }
            loadedBot = bot
            let html = """
            <!DOCTYPE html>
            <html><head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>body{margin:0;background:transparent;display:flex;justify-content:center;min-height:48px;}</style>
            <script>
            function onTelegramAuth(user) {
              window.webkit.messageHandlers.telegramAuth.postMessage(user);
            }
            </script>
            <script async src="https://telegram.org/js/telegram-widget.js?22"
              data-telegram-login="\(bot)"
              data-size="large"
              data-userpic="false"
              data-radius="14"
              data-lang="ru"
              data-request-access="write"
              data-onauth="onTelegramAuth(user)"></script>
            </head><body></body></html>
            """
            webView?.loadHTMLString(html, baseURL: URL(string: "https://earflow.ru"))
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "telegramAuth", let dict = message.body as? [String: Any] else { return }
            onAuth(dict)
        }

        static func normalizeBotUsername(_ raw: String) -> String {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let cleaned = trimmed.hasPrefix("@") ? String(trimmed.dropFirst()) : trimmed
            guard cleaned.range(of: #"^[A-Za-z0-9_]{5,64}$"#, options: .regularExpression) != nil else {
                return ""
            }
            return cleaned
        }
    }
}
