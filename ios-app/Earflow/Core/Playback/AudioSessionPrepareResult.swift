import Foundation

/// Result of `NowPlayingController.prepareAudioSessionForPlayback()` — consumed by `PlaybackActor`
/// before any `AVPlayer.play()` (hard gate against progress-without-sound).
enum AudioSessionPrepareResult: Sendable, Equatable {
    case active
    case deferred
    case failed
}

enum PlaybackEngineStartPolicy: Sendable {
    static func shouldInvokeEnginePlay(for prepareResult: AudioSessionPrepareResult) -> Bool {
        prepareResult == .active
    }

    static func stateWhenEngineStartBlocked(for prepareResult: AudioSessionPrepareResult) -> PlaybackState? {
        switch prepareResult {
        case .active:
            return nil
        case .deferred:
            return .ready
        case .failed:
            return .failed
        }
    }

    static func setsPendingEngineStart(for prepareResult: AudioSessionPrepareResult) -> Bool {
        prepareResult == .deferred
    }

    static func playbackErrorCode(for prepareResult: AudioSessionPrepareResult) -> String? {
        switch prepareResult {
        case .active, .deferred:
            return nil
        case .failed:
            return "audio_session_not_active"
        }
    }
}

enum RemotePlayCommandPolicy: Sendable {
    static func handlerStatus(
        prepareResult: AudioSessionPrepareResult,
        coordinatorState: PlaybackState,
        pendingEngineStart: Bool
    ) -> RemoteCommandHandlerOutcome {
        switch prepareResult {
        case .failed:
            return .commandFailed
        case .deferred:
            guard !coordinatorStateIsFakePlaying(coordinatorState) else { return .commandFailed }
            return .success
        case .active:
            if coordinatorStateIsAcceptableAfterActivePlay(coordinatorState, pendingEngineStart: pendingEngineStart) {
                return .success
            }
            return .commandFailed
        }
    }

    private static func coordinatorStateIsFakePlaying(_ state: PlaybackState) -> Bool {
        state == .playing
    }

    private static func coordinatorStateIsAcceptableAfterActivePlay(
        _ state: PlaybackState,
        pendingEngineStart: Bool
    ) -> Bool {
        switch state {
        case .playing, .buffering, .loadingMedia, .loadingSession:
            return true
        case .ready, .paused:
            return pendingEngineStart
        default:
            return false
        }
    }
}

enum RemoteCommandHandlerOutcome: Equatable {
    case success
    case commandFailed
}
