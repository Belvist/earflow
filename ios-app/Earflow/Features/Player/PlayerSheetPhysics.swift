import CoreGraphics
import UIKit

/// Mirrors `frontend/src/utils/playerSheetPhysics.js` — pure math for sheet Y/progress/snap.
enum PlayerSheetPhysics {
    enum Phase: Equatable {
        case closed
        case dragging
        case open
        case snapping
    }

    struct Constants {
        static let openY: CGFloat = 0
        static let snapOpenProgress: CGFloat = 0.42
        static let fastOpenVelocity: CGFloat = -720
        static let fastCloseVelocity: CGFloat = 760
        static let minFlingTravelPx: CGFloat = 42
        static let rubberBandConstant: CGFloat = 0.52
        static let dragAttachProgress: CGFloat = 0.68
        static let dragLateResistance: CGFloat = 0.42
        static let dragOverPullResistance: CGFloat = 0.22
    }

    static func viewportHeight(_ fallback: CGFloat = 800) -> CGFloat {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first { $0.isKeyWindow }
        let height = window?.bounds.height ?? scenes.first?.screen.bounds.height ?? fallback
        return max(1, height)
    }

    static func closedY(viewportHeight: CGFloat) -> CGFloat {
        let height = max(1, viewportHeight)
        let bottomNav = EarflowTheme.navHeight
        let miniPlayer = EarflowTheme.miniPlayerHeight + EarflowTheme.miniProgressHeight + 8
        let floatGap = EarflowTheme.miniPlayerFloatGap
        return max(1, height - bottomNav - floatGap - miniPlayer)
    }

    static func clampY(_ value: CGFloat, viewportHeight: CGFloat) -> CGFloat {
        let closed = closedY(viewportHeight: viewportHeight)
        return max(Constants.openY, min(closed, value))
    }

    static func yToProgress(_ y: CGFloat, viewportHeight: CGFloat) -> CGFloat {
        let closed = closedY(viewportHeight: viewportHeight)
        guard closed > 0 else { return 0 }
        return max(0, min(1, 1 - clampY(y, viewportHeight: viewportHeight) / closed))
    }

    static func progressToY(_ progress: CGFloat, viewportHeight: CGFloat) -> CGFloat {
        let closed = closedY(viewportHeight: viewportHeight)
        let p = max(0, min(1, progress))
        return closed * (1 - p)
    }

    static func rubberBandY(_ y: CGFloat, viewportHeight: CGFloat) -> CGFloat {
        let height = max(1, viewportHeight)
        let closed = closedY(viewportHeight: height)
        let c = max(0.01, Constants.rubberBandConstant)

        if y < 0 {
            let overflow = abs(y)
            return -((overflow * height * c) / (height + overflow * c))
        }
        if y > closed {
            let overflow = y - closed
            return closed + (overflow * height * c) / (height + overflow * c)
        }
        return y
    }

    static func shouldSnapOpen(
        y: CGFloat,
        velocityY: CGFloat,
        travelY: CGFloat,
        viewportHeight: CGFloat
    ) -> Bool {
        let closed = closedY(viewportHeight: viewportHeight)
        let currentY = clampY(y, viewportHeight: viewportHeight)
        let progress = yToProgress(currentY, viewportHeight: viewportHeight)
        let travel = abs(travelY)

        if travel >= Constants.minFlingTravelPx {
            if velocityY <= Constants.fastOpenVelocity { return true }
            if velocityY >= Constants.fastCloseVelocity { return false }
            if travelY < 0, travel >= max(Constants.minFlingTravelPx * 2, closed * 0.2) {
                return true
            }
        }
        return progress >= Constants.snapOpenProgress
    }
}
