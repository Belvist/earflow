import SwiftUI

/// Bottom chrome height for scroll padding — nav + optional mini-player.
struct ShellChromeMetrics: Equatable {
    var hasMiniPlayer: Bool

    var bottomInset: CGFloat {
        var h = EarflowTheme.navHeight + EarflowTheme.homeScrollExtraBottom
        if hasMiniPlayer {
            h += EarflowTheme.miniPlayerFloatGap + EarflowTheme.miniPlayerHeight
        }
        return h
    }
}

private struct ShellChromeMetricsKey: EnvironmentKey {
    static let defaultValue = ShellChromeMetrics(hasMiniPlayer: false)
}

extension EnvironmentValues {
    var shellChromeMetrics: ShellChromeMetrics {
        get { self[ShellChromeMetricsKey.self] }
        set { self[ShellChromeMetricsKey.self] = newValue }
    }
}
