import Combine
import Foundation
import UIKit

/// Composition root — single ownership of core actors/services.
@MainActor
final class AppDependencies: ObservableObject {
    let gateway: GatewayClient
    let auth: AuthActor
    let authPresentation = AppAuthPresentation()
    let playback: PlaybackActor
    let playbackCoordinator: PlaybackCoordinator
    let nowPlaying: NowPlayingController
    let playbackState: PlaybackStateStore
    let shellNavigation = AppShellNavigation()
    let catalog: CatalogService
    let search: SearchService
    let social: SocialService
    let deviceSync: DeviceSyncActor
    let analytics: AnalyticsQueue
    let streamTickets: StreamTicketService

    private var cancellables = Set<AnyCancellable>()

    init(configuration: AppConfiguration = .current) {
        let gatewayConfiguration = GatewayConfiguration(appConfiguration: configuration)
        gateway = GatewayClient(configuration: gatewayConfiguration)
        auth = AuthActor(gateway: gateway)
        streamTickets = StreamTicketService(gateway: gateway)
        playback = PlaybackActor(gateway: gateway, auth: auth, streamTickets: streamTickets)
        playbackCoordinator = PlaybackCoordinator(playback: playback)
        nowPlaying = NowPlayingController(coordinator: playbackCoordinator)
        playbackState = PlaybackStateStore()
        catalog = CatalogService(gateway: gateway)
        search = SearchService(gateway: gateway)
        social = SocialService(gateway: gateway)
        deviceSync = DeviceSyncActor(gateway: gateway, auth: auth)
        analytics = AnalyticsQueue(gateway: gateway, auth: auth)

        Task { [nowPlaying, playback] in
            await playback.bindAudioSessionPrepare {
                await MainActor.run {
                    nowPlaying.prepareAudioSessionForPlayback()
                }
            }
        }

        playbackCoordinator.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        Task {
            await wireSessionLifecycle()
        }
        observePlaybackRestore()
    }

    /// Auto-resume the last session once auth is usable. Gated on `.authenticated`/`.degraded`
    /// because re-resolving the HLS stream needs a valid session — restoring earlier would 401 and
    /// discard the saved state. Runs once per launch, then persistence takes over.
    private func observePlaybackRestore() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            for await state in await self.auth.stateStream() {
                guard state == .authenticated || state == .degraded else { continue }
                await self.waitForApplicationActive()
                await self.restorePlayback()
                return
            }
        }
    }

    /// Auto-resume must not start `AVPlayer` until UIApplication is `.active` — otherwise
    /// `setActive(true)` returns `!pux` (cannotStartPlaying) and playback is silent.
    private func waitForApplicationActive() async {
        if UIApplication.shared.applicationState == .active { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            var token: NSObjectProtocol?
            token = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { _ in
                if let token {
                    NotificationCenter.default.removeObserver(token)
                }
                continuation.resume()
            }
        }
    }

    private func restorePlayback() async {
        let snapshot = playbackState.loadSnapshot()
        switch PlaybackStateStore.decideRestore(from: snapshot) {
        case .skip:
            playbackState.clear()
        case let .resume(queue, current, position):
            await EarflowLog.shared.info(
                "playback",
                "auto-resume track=\(current.id) pos=\(Int(position))s queue=\(queue.count)"
            )
            await playbackCoordinator.restore(queue: queue, current: current, position: position)
        }
        playbackState.beginPersisting(coordinator: playbackCoordinator)
    }

    private func wireSessionLifecycle() async {
        await auth.bindLifecycleHooks(SessionLifecycleHooks(onSessionCleared: { [playback, deviceSync, streamTickets] in
            await playback.stop()
            await playback.clearPlaybackCaches()
            await deviceSync.disconnect()
            await streamTickets.clearCache()
        }))
    }
}
