import XCTest
@testable import Earflow

/// Pure-logic + file round-trip tests for cold-start auto-resume persistence.
/// System playback (AVPlayer / audio session / lock screen) cannot be unit-tested; those are
/// covered by the on-device gate (see `PEND-IOS-004` / `docs/PENDING.md`).
final class PlaybackStateStoreTests: XCTestCase {
    private func track(_ id: Int, duration: Int? = 200) -> TrackItem {
        TrackItem(
            id: id,
            title: "Title \(id)",
            artist: "Artist \(id)",
            album: "Album \(id)",
            albumPublicId: "alb-\(id)",
            coverUrl: "covers/\(id).jpg",
            duration: duration
        )
    }

    // MARK: - Codable round-trip

    func testSnapshotCodableRoundTrip() throws {
        let snapshot = PlaybackSnapshot(
            version: PlaybackSnapshot.currentVersion,
            savedAt: Date(timeIntervalSince1970: 1_700_000_000),
            currentIndex: 1,
            positionSeconds: 42.5,
            queue: [track(1), track(2), track(3)]
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let decoded = try decoder.decode(PlaybackSnapshot.self, from: encoder.encode(snapshot))
        XCTAssertEqual(decoded, snapshot)
    }

    func testSnapshotJSONCarriesNoStreamSecrets() throws {
        // SECURITY (INV-IOS-004): only catalog metadata + position may be persisted.
        let snapshot = PlaybackSnapshot(
            version: PlaybackSnapshot.currentVersion,
            savedAt: Date(),
            currentIndex: 0,
            positionSeconds: 10,
            queue: [track(1)]
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let json = String(decoding: try encoder.encode(snapshot), as: UTF8.self).lowercased()
        for forbidden in ["token", "mp_hls", "mp_sid", "cookie", "?st=", "bearer", "authorization"] {
            XCTAssertFalse(json.contains(forbidden), "persisted snapshot must not contain \(forbidden)")
        }
    }

    // MARK: - decideRestore

    func testDecideRestoreSkipsNilSnapshot() {
        XCTAssertEqual(PlaybackStateStore.decideRestore(from: nil), .skip)
    }

    func testDecideRestoreSkipsEmptyQueue() {
        let snapshot = PlaybackSnapshot(version: 1, savedAt: Date(), currentIndex: 0, positionSeconds: 0, queue: [])
        XCTAssertEqual(PlaybackStateStore.decideRestore(from: snapshot), .skip)
    }

    func testDecideRestoreSkipsIncompatibleVersion() {
        let snapshot = PlaybackSnapshot(version: 999, savedAt: Date(), currentIndex: 0, positionSeconds: 0, queue: [track(1)])
        XCTAssertEqual(PlaybackStateStore.decideRestore(from: snapshot), .skip)
    }

    func testDecideRestoreSkipsOutOfRangeIndex() {
        let snapshot = PlaybackSnapshot(version: 1, savedAt: Date(), currentIndex: 5, positionSeconds: 0, queue: [track(1), track(2)])
        XCTAssertEqual(PlaybackStateStore.decideRestore(from: snapshot), .skip)
    }

    func testDecideRestoreResumesCurrentWithClampedPosition() throws {
        let snapshot = PlaybackSnapshot(
            version: 1,
            savedAt: Date(),
            currentIndex: 1,
            positionSeconds: 50,
            queue: [track(1), track(2, duration: 200), track(3)]
        )
        guard case let .resume(queue, current, position) = PlaybackStateStore.decideRestore(from: snapshot) else {
            return XCTFail("expected resume")
        }
        XCTAssertEqual(current.id, 2)
        XCTAssertEqual(queue.count, 3)
        XCTAssertEqual(position, 50)
    }

    func testDecideRestoreResetsFinishedTrackToStart() throws {
        let snapshot = PlaybackSnapshot(
            version: 1,
            savedAt: Date(),
            currentIndex: 0,
            positionSeconds: 999,
            queue: [track(1, duration: 200)]
        )
        guard case let .resume(_, _, position) = PlaybackStateStore.decideRestore(from: snapshot) else {
            return XCTFail("expected resume")
        }
        XCTAssertEqual(position, 0, "position at/after duration restarts from 0")
    }

    // MARK: - clampPosition

    func testClampPositionNegativeToZero() {
        XCTAssertEqual(PlaybackStateStore.clampPosition(-10, duration: 200), 0)
    }

    func testClampPositionBeyondDurationToZero() {
        XCTAssertEqual(PlaybackStateStore.clampPosition(250, duration: 200), 0)
    }

    func testClampPositionInRangeKept() {
        XCTAssertEqual(PlaybackStateStore.clampPosition(123.4, duration: 200), 123.4)
    }

    func testClampPositionUnknownDurationKeepsPositive() {
        XCTAssertEqual(PlaybackStateStore.clampPosition(123.4, duration: nil), 123.4)
        XCTAssertEqual(PlaybackStateStore.clampPosition(123.4, duration: 0), 123.4)
    }

    // MARK: - makeSnapshot

    func testMakeSnapshotNilWhenCurrentNotInQueue() {
        XCTAssertNil(PlaybackStateStore.makeSnapshot(queue: [track(1), track(2)], currentId: 99, positionSeconds: 10))
    }

    func testMakeSnapshotCapturesIndexAndClampsNegativePosition() throws {
        let snapshot = try XCTUnwrap(
            PlaybackStateStore.makeSnapshot(queue: [track(1), track(2), track(3)], currentId: 3, positionSeconds: -5)
        )
        XCTAssertEqual(snapshot.currentIndex, 2)
        XCTAssertEqual(snapshot.positionSeconds, 0)
        XCTAssertEqual(snapshot.queue.count, 3)
        XCTAssertEqual(snapshot.version, PlaybackSnapshot.currentVersion)
    }

    func testMakeSnapshotWindowsLargeQueueAroundCurrent() throws {
        let big = (0 ..< 1000).map { track($0) }
        let snapshot = try XCTUnwrap(
            PlaybackStateStore.makeSnapshot(queue: big, currentId: 800, positionSeconds: 12, maxPersistedQueue: 200)
        )
        XCTAssertEqual(snapshot.queue.count, 200, "queue is capped for bounded persistence (INV-IOS-003)")
        XCTAssertTrue(snapshot.queue.indices.contains(snapshot.currentIndex))
        XCTAssertEqual(snapshot.queue[snapshot.currentIndex].id, 800, "current track is preserved in the window")
    }

    func testMakeSnapshotKeepsShortQueueIntact() throws {
        let snapshot = try XCTUnwrap(
            PlaybackStateStore.makeSnapshot(queue: [track(1), track(2)], currentId: 1, positionSeconds: 3, maxPersistedQueue: 200)
        )
        XCTAssertEqual(snapshot.queue.map(\.id), [1, 2])
        XCTAssertEqual(snapshot.currentIndex, 0)
    }

    // MARK: - File save / load / clear

    @MainActor
    func testSaveLoadClearRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = PlaybackStateStore(directory: dir)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }

        XCTAssertNil(store.loadSnapshot(), "no file yet")

        let snapshot = PlaybackSnapshot(
            version: 1,
            savedAt: Date(timeIntervalSince1970: 1_700_000_000),
            currentIndex: 0,
            positionSeconds: 7,
            queue: [track(1)]
        )
        store.save(snapshot)
        XCTAssertEqual(store.loadSnapshot(), snapshot)

        store.clear()
        XCTAssertNil(store.loadSnapshot(), "cleared file returns nil")
    }

    @MainActor
    func testLoadDropsCorruptFile() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }

        let file = dir.appendingPathComponent("playback-state.json")
        try Data("{ not valid json".utf8).write(to: file)

        let store = PlaybackStateStore(directory: dir)
        XCTAssertNil(store.loadSnapshot(), "corrupt payload is ignored")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path), "corrupt file is removed")
    }
}
