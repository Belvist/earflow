import SwiftUI
import UIKit
import CoreText

/// Typography — matches web `index.css` + `EmailAuth` (`Unbounded` from Google Fonts).
enum EarflowFont {
    static let family = "Unbounded"

    static func registerFontsIfNeeded() {
        guard UIFont(name: family, size: 14) == nil else { return }
        let candidates = [
            Bundle.main.url(forResource: "Unbounded[wght]", withExtension: "ttf"),
            Bundle.main.url(forResource: "Unbounded[wght]", withExtension: "ttf", subdirectory: "Resources/Fonts"),
            Bundle.main.url(forResource: "Unbounded[wght]", withExtension: "ttf", subdirectory: "Fonts"),
        ].compactMap { $0 }
        for url in candidates {
            var error: Unmanaged<CFError>?
            if CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
                return
            }
        }
    }

    static func unbounded(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom(family, size: size).weight(weight)
    }

    static var body: Font { unbounded(size: 13, weight: .medium) }
    static var bodyLarge: Font { unbounded(size: 14, weight: .bold) }
    static var caption: Font { unbounded(size: 11, weight: .semibold) }
    static var sectionTitle: Font { unbounded(size: 19, weight: .bold) }
    static var screenTitle: Font { unbounded(size: 19, weight: .bold) }
    static var authTitle: Font { unbounded(size: 19, weight: .bold) }
    static var authTab: Font { unbounded(size: 11, weight: .bold) }
    static var authButton: Font { unbounded(size: 12, weight: .bold) }
    static var brand: Font { unbounded(size: 16, weight: .black) }
    static var railTitle: Font { unbounded(size: 18, weight: .bold) }
    static var miniTitle: Font { unbounded(size: 13, weight: .semibold) }
}

struct EarflowTypographyModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.font(EarflowFont.body)
    }
}

extension View {
    func earflowTypography() -> some View {
        modifier(EarflowTypographyModifier())
    }
}

enum EarflowFontRegistrar {
    static func verifyLoaded() -> Bool {
        UIFont(name: EarflowFont.family, size: 14) != nil
    }
}
