import Combine
import Foundation

/// Composition root — single ownership of core actors/services.
@MainActor
final class AppDependencies: ObservableObject {
    let gateway: GatewayClient
    let auth: AuthActor
    let playback: PlaybackActor
    let playbackCoordinator: PlaybackCoordinator
    let catalog: CatalogService
    let search: SearchService
    let social: SocialService
    let deviceSync: DeviceSyncActor
    let analytics: AnalyticsQueue

    init(configuration: AppConfiguration = .current) {
        let gatewayConfiguration = GatewayConfiguration(appConfiguration: configuration)
        gateway = GatewayClient(configuration: gatewayConfiguration)
        auth = AuthActor(gateway: gateway)
        playback = PlaybackActor(gateway: gateway, auth: auth)
        playbackCoordinator = PlaybackCoordinator(playback: playback)
        catalog = CatalogService(gateway: gateway)
        search = SearchService(gateway: gateway)
        social = SocialService(gateway: gateway)
        deviceSync = DeviceSyncActor(gateway: gateway, auth: auth)
        analytics = AnalyticsQueue(gateway: gateway, auth: auth)
    }
}
