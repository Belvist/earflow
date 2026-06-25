import SwiftUI

/// Owner: sheet drag Y + progress + snap — mirrors web `usePlayerSheetState` (INV-SHEET-001).
@MainActor
final class PlayerSheetState: ObservableObject {
    @Published private(set) var sheetY: CGFloat = 0
    @Published private(set) var sheetProgress: CGFloat = 0
    @Published private(set) var phase: PlayerSheetPhysics.Phase = .closed

    private var dragAnchorY: CGFloat = 0
    private var snapTask: Task<Void, Never>?

    var isModalVisible: Bool {
        phase == .dragging || phase == .open || phase == .snapping || sheetProgress > 0.02
    }

    var isOpen: Bool { phase == .open }

    var miniOpacity: CGFloat {
        let p = sheetProgress
        if p <= 0.28 { return 1 - (p / 0.28) * 0.03 }
        if p <= 0.78 { return 0.97 - ((p - 0.28) / 0.5) * 0.59 }
        return max(0, 0.38 - ((p - 0.78) / 0.22) * 0.38)
    }

    var miniScale: CGFloat {
        let p = sheetProgress
        if p <= 0.55 { return 1 - (p / 0.55) * 0.015 }
        return 0.985 - ((p - 0.55) / 0.45) * 0.045
    }

    init() {
        resetToClosed(animated: false)
    }

    func open() {
        stopSnap()
        let height = PlayerSheetPhysics.viewportHeight()
        let closed = PlayerSheetPhysics.closedY(viewportHeight: height)
        if sheetY >= closed - 2 {
            snap(to: PlayerSheetPhysics.Constants.openY, nextPhase: .open)
        } else {
            writeY(PlayerSheetPhysics.Constants.openY, viewportHeight: height)
            phase = .open
        }
    }

    func finishClosed() {
        stopSnap()
        resetToClosed(animated: true)
    }

    func beginExpandPan() {
        stopSnap()
        let height = PlayerSheetPhysics.viewportHeight()
        dragAnchorY = sheetY > 0 ? sheetY : PlayerSheetPhysics.closedY(viewportHeight: height)
        phase = .dragging
    }

    func applyExpandPull(_ pullDy: CGFloat) {
        let height = PlayerSheetPhysics.viewportHeight()
        let next = PlayerSheetPhysics.rubberBandY(dragAnchorY + pullDy, viewportHeight: height)
        writeY(next, viewportHeight: height)
        phase = .dragging
    }

    func settleExpand(velocityY: CGFloat, travelY: CGFloat) {
        let height = PlayerSheetPhysics.viewportHeight()
        let shouldOpen = PlayerSheetPhysics.shouldSnapOpen(
            y: sheetY,
            velocityY: velocityY,
            travelY: travelY,
            viewportHeight: height
        )
        if shouldOpen {
            snap(to: PlayerSheetPhysics.Constants.openY, nextPhase: .open)
        } else {
            snap(to: PlayerSheetPhysics.closedY(viewportHeight: height), nextPhase: .closed)
        }
    }

    func beginDismissDrag() {
        stopSnap()
        dragAnchorY = sheetY
        phase = .dragging
    }

    func applyDismissDelta(_ dy: CGFloat) {
        let height = PlayerSheetPhysics.viewportHeight()
        let next = PlayerSheetPhysics.rubberBandY(max(PlayerSheetPhysics.Constants.openY, dragAnchorY + dy), viewportHeight: height)
        writeY(next, viewportHeight: height)
        phase = .dragging
    }

    func settleDismiss(velocityY: CGFloat, travelY: CGFloat) {
        let height = PlayerSheetPhysics.viewportHeight()
        let closed = PlayerSheetPhysics.closedY(viewportHeight: height)
        let shouldClose = travelY > 120
            || velocityY > 760
            || sheetProgress < (1 - PlayerSheetPhysics.Constants.snapOpenProgress)
        if shouldClose {
            snap(to: closed, nextPhase: .closed)
        } else {
            snap(to: PlayerSheetPhysics.Constants.openY, nextPhase: .open)
        }
    }

    // MARK: - Private

    private func resetToClosed(animated: Bool) {
        let height = PlayerSheetPhysics.viewportHeight()
        let closed = PlayerSheetPhysics.closedY(viewportHeight: height)
        if animated {
            snap(to: closed, nextPhase: .closed)
        } else {
            writeY(closed, viewportHeight: height)
            phase = .closed
        }
    }

    private func writeY(_ y: CGFloat, viewportHeight: CGFloat) {
        sheetY = y
        sheetProgress = PlayerSheetPhysics.yToProgress(y, viewportHeight: viewportHeight)
    }

    private func stopSnap() {
        snapTask?.cancel()
        snapTask = nil
    }

    private func snap(to targetY: CGFloat, nextPhase: PlayerSheetPhysics.Phase) {
        stopSnap()
        phase = .snapping
        let height = PlayerSheetPhysics.viewportHeight()
        let startY = sheetY
        let isClose = targetY > PlayerSheetPhysics.Constants.openY + 8
        let duration: TimeInterval = isClose ? 0.24 : 0.28

        snapTask = Task { @MainActor in
            let frames = 24
            for frame in 0 ... frames {
                if Task.isCancelled { return }
                let t = CGFloat(frame) / CGFloat(frames)
                let eased = 1 - pow(1 - t, 3)
                let y = startY + (targetY - startY) * eased
                writeY(y, viewportHeight: height)
                try? await Task.sleep(nanoseconds: UInt64((duration / Double(frames)) * 1_000_000_000))
            }
            writeY(targetY, viewportHeight: height)
            phase = nextPhase
        }
    }
}
