import SwiftUI
import UIKit

/// Dominant cover color — parity with web `useCoverAccentColor` / `toDarkenedRgba`.
enum CoverAccentColor {
    struct RGB: Equatable {
        let r: Int
        let g: Int
        let b: Int

        func darkened(factor: Double = 0.5, alpha: Double = 1) -> Color {
            let f = max(0, min(1, factor))
            let a = max(0, min(1, alpha))
            return Color(
                red: Double(r) / 255 * f,
                green: Double(g) / 255 * f,
                blue: Double(b) / 255 * f,
                opacity: a
            )
        }
    }

    static func load(from url: URL) async -> RGB? {
        await CoverAccentCache.shared.load(from: url)
    }

    static func backdropGradient(base: Color?, fallback: Color = EarflowTheme.surfaceMain) -> LinearGradient {
        let top = base ?? fallback
        return LinearGradient(
            colors: [top, Color.black.opacity(0.88)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    static func extractDominant(from image: UIImage) -> RGB? {
        let size = 48
        guard let cg = image.cgImage else { return nil }
        let width = size
        let height = size
        let bytesPerPixel = 4
        let bytesPerRow = bytesPerPixel * width
        var raw = [UInt8](repeating: 0, count: width * height * bytesPerPixel)
        guard let ctx = CGContext(
            data: &raw,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }

        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        var buckets: [UInt32: (count: Int, r: Int, g: Int, b: Int)] = [:]

        for y in 0..<height {
            for x in 0..<width {
                let i = (y * width + x) * bytesPerPixel
                let r = Int(raw[i])
                let g = Int(raw[i + 1])
                let b = Int(raw[i + 2])
                guard isSaturated(r: r, g: g, b: b) else { continue }
                let key = UInt32((r / 16) << 16 | (g / 16) << 8 | (b / 16))
                var bucket = buckets[key] ?? (0, 0, 0, 0)
                bucket.count += 1
                bucket.r += r
                bucket.g += g
                bucket.b += b
                buckets[key] = bucket
            }
        }

        guard let best = buckets.max(by: { $0.value.count < $1.value.count })?.value,
              best.count > 0 else { return nil }
        return RGB(
            r: best.r / best.count,
            g: best.g / best.count,
            b: best.b / best.count
        )
    }

    private static func isSaturated(r: Int, g: Int, b: Int) -> Bool {
        let maxC = max(r, g, b)
        let minC = min(r, g, b)
        if maxC < 24 || minC > 232 { return false }
        return (maxC - minC) > 18
    }
}

/// Observes cover URL and publishes accent `Color` for player chrome.
@MainActor
final class CoverAccentStore: ObservableObject {
    @Published private(set) var accentColor: Color?
    private var task: Task<Void, Never>?

    func update(coverURL: URL?) {
        task?.cancel()
        guard let coverURL else {
            accentColor = nil
            return
        }
        task = Task {
            let rgb = await CoverAccentColor.load(from: coverURL)
            guard !Task.isCancelled else { return }
            accentColor = rgb?.darkened(factor: 0.5, alpha: 1)
                ?? Color(red: 18 / 255, green: 12 / 255, blue: 14 / 255)
        }
    }
}
