import Combine
import Foundation

/// Composition root — single ownership of core actors/services.
@MainActor
final class AppDependencies: ObservableObject {
    let gateway: GatewayClient
    let auth: AuthActor
    let authPresentation = AppAuthPresentation()
    let playback: PlaybackActor
    let playbackCoordinator: PlaybackCoordinator
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
        catalog = CatalogService(gateway: gateway)
        search = SearchService(gateway: gateway)
        social = SocialService(gateway: gateway)
        deviceSync = DeviceSyncActor(gateway: gateway, auth: auth)
        analytics = AnalyticsQueue(gateway: gateway, auth: auth)

        playbackCoordinator.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        Task {
            await wireSessionLifecycle()
        }
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
