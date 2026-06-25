import MediaPlayer
import XCTest
@testable import Earflow

/// Contract tests for the OS playback integration layer (lock screen / Control Center).
/// Verifies the Now Playing metadata builder and queue-aware command availability.
final class NowPlayingControllerTests: XCTestCase {
    private func track(id: Int, title: String? = "Song", artist: String? = "Artist", album: String? = "Album", duration: Int? = 200) -> TrackItem {
        TrackItem(id: id, title: title, artist: artist, album: album, duration: duration)
    }

    func testNowPlayingInfoCarriesMetadataAndPlayingRate() {
        let info = NowPlayingController.makeNowPlayingInfo(
            track: track(id: 1),
            elapsed: 42,
            duration: 200,
            isPlaying: true
        )
        XCTAssertEqual(info[MPMediaItemPropertyTitle] as? String, "Song")
        XCTAssertEqual(info[MPMediaItemPropertyArtist] as? String, "Artist")
        XCTAssertEqual(info[MPMediaItemPropertyAlbumTitle] as? String, "Album")
        XCTAssertEqual(info[MPMediaItemPropertyPlaybackDuration] as? Double, 200)
        XCTAssertEqual(info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 42)
        XCTAssertEqual(info[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1.0)
    }

    func testNowPlayingInfoPausedRateIsZero() {
        let info = NowPlayingController.makeNowPlayingInfo(
            track: track(id: 1),
            elapsed: 10,
            duration: 200,
            isPlaying: false
        )
        XCTAssertEqual(info[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0.0)
    }

    func testNowPlayingInfoFallsBackForEmptyMetadata() {
        let info = NowPlayingController.makeNowPlayingInfo(
            track: track(id: 1, title: "  ", artist: nil, album: "  ", duration: 0),
            elapsed: -5,
            duration: 0,
            isPlaying: false
        )
        XCTAssertEqual(info[MPMediaItemPropertyTitle] as? String, "Без названия")
        XCTAssertEqual(info[MPMediaItemPropertyArtist] as? String, "Неизвестный артист")
        XCTAssertNil(info[MPMediaItemPropertyAlbumTitle], "blank album must be omitted")
        XCTAssertNil(info[MPMediaItemPropertyPlaybackDuration], "zero duration must be omitted")
        XCTAssertEqual(info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 0, "negative elapsed clamps to 0")
    }

    func testHasNextRespectsQueueBoundaries() {
        let queue = [track(id: 1), track(id: 2), track(id: 3)]
        XCTAssertTrue(NowPlayingController.hasNext(currentId: 1, queue: queue))
        XCTAssertTrue(NowPlayingController.hasNext(currentId: 2, queue: queue))
        XCTAssertFalse(NowPlayingController.hasNext(currentId: 3, queue: queue), "last track has no next")
        XCTAssertFalse(NowPlayingController.hasNext(currentId: 99, queue: queue), "unknown track")
        XCTAssertFalse(NowPlayingController.hasNext(currentId: nil, queue: queue))
        XCTAssertFalse(NowPlayingController.hasNext(currentId: 1, queue: []))
    }

    func testCannotStartPlayingCodeIsPux() {
        XCTAssertEqual(NowPlayingController.cannotStartPlayingCode, 561015905)
    }
}
