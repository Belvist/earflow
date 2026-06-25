import Combine
import Foundation
import UIKit

/// Secret-free snapshot of the listening session for cold-start auto-resume.
///
/// SECURITY (INV-IOS-004): persists only stable catalog metadata + playback position. It MUST NOT
/// contain signed/tokenized stream URLs (`?token=`/`?st=`), `mp_*` cookies, JWTs, or any auth
/// material — those are re-minted on restore by re-resolving a fresh HLS stream through the normal
/// play pipeline (`StreamSessionService.createSession`).
struct PlaybackSnapshot: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int
    var savedAt: Date
    var currentIndex: Int
    var positionSeconds: Double
    var queue: [TrackItem]
}

/// Outcome of evaluating a persisted snapshot at launch — kept pure so it is fully unit-testable.
enum PlaybackRestoreDecision: Equatable {
    case skip
    case resume(queue: [TrackItem], current: TrackItem, position: Double)
}

/// Single owner of playback-state persistence.
///
/// It observes `PlaybackCoordinator` (the one playback source of truth) and writes a throttled,
/// secret-free snapshot to the app sandbox. It never starts a second playback path — restore is
/// performed by the coordinator through the existing pipeline (`INV-ARCH-001`).
///
/// Disk discipline (`INV-IOS-003`): position is persisted at most once per `persistInterval` while
/// playing, and force-flushed on stable transitions (pause/track change/queue change) and on app
/// background/terminate. The persisted queue is capped to `maxPersistedQueue`.
@MainActor
final class PlaybackStateStore {
    private let fileURL: URL
    private let maxPersistedQueue: Int
    private let persistInterval: TimeInterval

    private weak var coordinator: PlaybackCoordinator?
    private var cancellables = Set<AnyCancellable>()
    private var armed = false
    private var lastPersist = Date.distantPast

    init(
        directory: URL? = nil,
        maxPersistedQueue: Int = 200,
        persistInterval: TimeInterval = 5
    ) {
        self.maxPersistedQueue = maxPersistedQueue
        self.persistInterval = persistInterval
        let dir = directory ?? Self.defaultDirectory()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("playback-state.json")
    }

    private static func defaultDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Playback", isDirectory: true)
    }

    // MARK: - File I/O (secret-free, atomic)

    /// File JSON (not UserDefaults): the queue can hold up to `maxPersistedQueue` `TrackItem`s, so the
    /// payload is tens of KB — well past what belongs in UserDefaults. Atomic write avoids torn files.
    nonisolated func save(_ snapshot: PlaybackSnapshot) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(snapshot) else { return }
        do {
            try data.write(to: fileURL, options: [.atomic])
        } catch {
            Task { await EarflowLog.shared.warning("playback", "persist write failed: \(error.localizedDescription)") }
        }
    }

    nonisolated func loadSnapshot() -> PlaybackSnapshot? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let snapshot = try? decoder.decode(PlaybackSnapshot.self, from: data) else {
            // Corrupt / incompatible payload — drop it so the next save starts clean.
            clear()
            return nil
        }
        return snapshot
    }

    nonisolated func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    // MARK: - Persistence wiring

    /// Begin mirroring the coordinator into the snapshot file. Idempotent; call once after the
    /// restore attempt so the initial idle state can't overwrite a snapshot before it is read.
    func beginPersisting(coordinator: PlaybackCoordinator) {
        guard !armed else { return }
        armed = true
        self.coordinator = coordinator

        coordinator.$nowPlaying
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in MainActor.assumeIsolated { self?.persist(force: true) } }
            .store(in: &cancellables)

        coordinator.$queue
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in MainActor.assumeIsolated { self?.persist(force: true) } }
            .store(in: &cancellables)

        coordinator.$state
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in MainActor.assumeIsolated { self?.onStateChanged(state) } }
            .store(in: &cancellables)

        coordinator.$progress
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in MainActor.assumeIsolated { self?.persist(force: false) } }
            .store(in: &cancellables)

        observeAppLifecycle()
        persist(force: true)
    }

    private func onStateChanged(_ state: PlaybackState) {
        switch state {
        case .paused, .ended, .idle, .revoked, .failed:
            persist(force: true) // checkpoint an accurate position on every stable transition
        case .playing, .buffering, .seeking, .loadingSession, .loadingMedia, .ready:
            break // covered by throttled progress writes
        }
    }

    /// Force-flush before the process can be suspended/killed so the latest position survives a
    /// swipe-kill (which always backgrounds first). `queue: nil` delivers synchronously on the main
    /// thread the notifications are posted on, so `willTerminate` flushes before exit.
    private func observeAppLifecycle() {
        let names: [Notification.Name] = [
            UIApplication.willResignActiveNotification,
            UIApplication.didEnterBackgroundNotification,
            UIApplication.willTerminateNotification,
        ]
        for name in names {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
                MainActor.assumeIsolated { self?.persist(force: true) }
            }
        }
    }

    private func persist(force: Bool) {
        guard armed, let coordinator else { return }
        guard let current = coordinator.nowPlaying else {
            clear() // nothing playing → no ghost session to resume on next launch
            lastPersist = .distantPast
            return
        }
        let now = Date()
        if !force, now.timeIntervalSince(lastPersist) < persistInterval { return }
        guard let snapshot = Self.makeSnapshot(
            queue: coordinator.queue,
            currentId: current.id,
            positionSeconds: coordinator.progress.currentTime,
            maxPersistedQueue: maxPersistedQueue,
            savedAt: now
        ) else { return }
        save(snapshot)
        lastPersist = now
    }

    // MARK: - Pure logic (unit tested)

    /// Build a bounded snapshot from live coordinator state. Returns `nil` if the current track is
    /// not in the queue (inconsistent state). Large queues are windowed around the current track so
    /// the persisted payload stays bounded (`INV-IOS-003`).
    nonisolated static func makeSnapshot(
        queue: [TrackItem],
        currentId: Int,
        positionSeconds: Double,
        maxPersistedQueue: Int = 200,
        savedAt: Date = Date()
    ) -> PlaybackSnapshot? {
        guard let fullIndex = queue.firstIndex(where: { $0.id == currentId }) else { return nil }
        var window = queue
        var index = fullIndex
        if queue.count > maxPersistedQueue, maxPersistedQueue > 0 {
            let half = maxPersistedQueue / 2
            var start = max(0, fullIndex - half)
            let end = min(queue.count, start + maxPersistedQueue)
            start = max(0, end - maxPersistedQueue)
            window = Array(queue[start ..< end])
            index = fullIndex - start
        }
        return PlaybackSnapshot(
            version: PlaybackSnapshot.currentVersion,
            savedAt: savedAt,
            currentIndex: index,
            positionSeconds: max(0, positionSeconds),
            queue: window
        )
    }

    /// Decide whether a persisted snapshot can be auto-resumed. Restores regardless of age (the
    /// product chose unconditional auto-resume); only structural validity and version compatibility
    /// gate the decision.
    nonisolated static func decideRestore(from snapshot: PlaybackSnapshot?) -> PlaybackRestoreDecision {
        guard let snapshot,
              snapshot.version == PlaybackSnapshot.currentVersion,
              snapshot.queue.indices.contains(snapshot.currentIndex)
        else { return .skip }
        let current = snapshot.queue[snapshot.currentIndex]
        return .resume(
            queue: snapshot.queue,
            current: current,
            position: clampPosition(snapshot.positionSeconds, duration: current.duration)
        )
    }

    /// Clamp a persisted position into a sane resume point: negatives and positions at/after the
    /// known duration (a finished track) restart from 0; otherwise the saved offset is kept.
    nonisolated static func clampPosition(_ position: Double, duration: Int?) -> Double {
        guard position.isFinite, position > 0 else { return 0 }
        if let duration, duration > 0, position >= Double(duration) { return 0 }
        return position
    }
}
