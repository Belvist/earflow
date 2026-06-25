import SwiftUI
import UIKit
import CoreText

/// Typography — matches web `index.css` + `EmailAuth` (`Unbounded` from Google Fonts).
enum EarflowFont {
    static let family = "Unbounded"
    private static let bundledFile = "Unbounded.ttf"
    private static let wghtAxis: NSNumber = 2_003_265_652 // 'wght'

    static func registerFontsIfNeeded() {
        guard UIFont(name: family, size: 14) == nil else { return }
        guard let url = Bundle.main.url(forResource: "Unbounded", withExtension: "ttf") else { return }
        var error: Unmanaged<CFError>?
        _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
    }

    static func unbounded(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        if let uiFont = uiFont(size: size, weight: weight) {
            return Font(uiFont)
        }
        return Font.system(size: size, weight: weight)
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
    static var railTitle: Font { unbounded(size: 13.5, weight: .semibold) }
    static var homeSectionTitle: Font { unbounded(size: 13.5, weight: .semibold) }
    static var miniTitle: Font { unbounded(size: 11, weight: .semibold) }
    static var miniArtist: Font { unbounded(size: 9, weight: .medium) }

    private static func uiFont(size: CGFloat, weight: Font.Weight) -> UIFont? {
        let wght = weightAxisValue(weight)
        let base = UIFontDescriptor(fontAttributes: [.family: family])
        let variation: [NSNumber: NSNumber] = [wghtAxis: NSNumber(value: wght)]
        let attrs: [UIFontDescriptor.AttributeName: Any] = [
            UIFontDescriptor.AttributeName(rawValue: "NSCTFontVariationAttribute"): variation,
        ]
        let descriptor = base.addingAttributes(attrs)
        return UIFont(descriptor: descriptor, size: size)
    }

    private static func weightAxisValue(_ weight: Font.Weight) -> CGFloat {
        switch weight {
        case .ultraLight: return 200
        case .thin: return 250
        case .light: return 300
        case .regular: return 400
        case .medium: return 500
        case .semibold: return 600
        case .bold: return 700
        case .heavy: return 800
        case .black: return 900
        default: return 400
        }
    }
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

    static func bundledFontPresent() -> Bool {
        Bundle.main.url(forResource: "Unbounded", withExtension: "ttf") != nil
    }
}
