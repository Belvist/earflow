import XCTest
@testable import Earflow

final class PlaybackEngineStartPolicyTests: XCTestCase {
    func testActiveSessionAllowsEnginePlay() {
        XCTAssertTrue(PlaybackEngineStartPolicy.shouldInvokeEnginePlay(for: .active))
        XCTAssertNil(PlaybackEngineStartPolicy.stateWhenEngineStartBlocked(for: .active))
        XCTAssertFalse(PlaybackEngineStartPolicy.setsPendingEngineStart(for: .active))
    }

    func testDeferredSessionBlocksEnginePlayAndSetsPending() {
        XCTAssertFalse(PlaybackEngineStartPolicy.shouldInvokeEnginePlay(for: .deferred))
        XCTAssertEqual(PlaybackEngineStartPolicy.stateWhenEngineStartBlocked(for: .deferred), .ready)
        XCTAssertTrue(PlaybackEngineStartPolicy.setsPendingEngineStart(for: .deferred))
        XCTAssertNil(PlaybackEngineStartPolicy.playbackErrorCode(for: .deferred))
    }

    func testFailedSessionBlocksEnginePlayWithErrorCode() {
        XCTAssertFalse(PlaybackEngineStartPolicy.shouldInvokeEnginePlay(for: .failed))
        XCTAssertEqual(PlaybackEngineStartPolicy.stateWhenEngineStartBlocked(for: .failed), .failed)
        XCTAssertEqual(PlaybackEngineStartPolicy.playbackErrorCode(for: .failed), "audio_session_not_active")
    }
}

final class RemotePlayCommandPolicyTests: XCTestCase {
    func testFailedPrepareReturnsCommandFailed() {
        let outcome = RemotePlayCommandPolicy.handlerStatus(
            prepareResult: .failed,
            coordinatorState: .ready,
            pendingEngineStart: false
        )
        XCTAssertEqual(outcome, .commandFailed)
    }

    func testDeferredPrepareReturnsSuccessWithoutFakePlaying() {
        let outcome = RemotePlayCommandPolicy.handlerStatus(
            prepareResult: .deferred,
            coordinatorState: .ready,
            pendingEngineStart: true
        )
        XCTAssertEqual(outcome, .success)
    }

    func testDeferredWithPlayingStateIsCommandFailed() {
        let outcome = RemotePlayCommandPolicy.handlerStatus(
            prepareResult: .deferred,
            coordinatorState: .playing,
            pendingEngineStart: true
        )
        XCTAssertEqual(outcome, .commandFailed)
    }

    func testActivePrepareWithPlayingStateSucceeds() {
        let outcome = RemotePlayCommandPolicy.handlerStatus(
            prepareResult: .active,
            coordinatorState: .playing,
            pendingEngineStart: false
        )
        XCTAssertEqual(outcome, .success)
    }
}

final class PlaybackActorAudioGateTests: XCTestCase {
    private func makeActor() -> PlaybackActor {
        let gateway = GatewayTestHarness.makeGatewayClient()
        let auth = AuthActor(gateway: gateway)
        let tickets = StreamTicketService(gateway: gateway)
        return PlaybackActor(gateway: gateway, auth: auth, streamTickets: tickets)
    }

    func testResumeWhenSessionDeferredDoesNotCallEnginePlay() async {
        let actor = makeActor()
        await actor.bindAudioSessionPrepare { .deferred }
        await actor.testMarkMediaReady(trackId: 42)

        await actor.resume()

        let state = await actor.currentState()
        let playCount = await actor.testEnginePlayCount()
        let pending = await actor.hasPendingEngineStart()
        let error = await actor.lastErrorMessage()

        XCTAssertEqual(state, .ready)
        XCTAssertEqual(playCount, 0)
        XCTAssertTrue(pending)
        XCTAssertNil(error)
    }

    func testResumeWhenSessionFailedDoesNotCallEnginePlayOrMarkPlaying() async {
        let actor = makeActor()
        await actor.bindAudioSessionPrepare { .failed }
        await actor.testMarkMediaReady(trackId: 42)

        await actor.resume()

        let state = await actor.currentState()
        let playCount = await actor.testEnginePlayCount()
        let pending = await actor.hasPendingEngineStart()
        let error = await actor.lastErrorMessage()

        XCTAssertEqual(state, .failed)
        XCTAssertEqual(playCount, 0)
        XCTAssertFalse(pending)
        XCTAssertEqual(error, "audio_session_not_active")
    }

    func testPendingEngineStartRetriesOnRecovery() async {
        let actor = makeActor()
        let prepareBox = PrepareResultBox(sequence: [.deferred, .active])
        await actor.bindAudioSessionPrepare {
            await prepareBox.next()
        }
        await actor.testMarkMediaReady(trackId: 42)

        await actor.resume()
        let pendingAfterResume = await actor.hasPendingEngineStart()
        let playCountAfterResume = await actor.testEnginePlayCount()
        XCTAssertTrue(pendingAfterResume)
        XCTAssertEqual(playCountAfterResume, 0)

        await actor.retryPendingEngineStartIfNeeded()
        let pendingAfterRetry = await actor.hasPendingEngineStart()
        let playCountAfterRetry = await actor.testEnginePlayCount()
        XCTAssertFalse(pendingAfterRetry)
        XCTAssertEqual(playCountAfterRetry, 1)
    }
}

private actor PrepareResultBox {
    private var sequence: [AudioSessionPrepareResult]

    init(sequence: [AudioSessionPrepareResult]) {
        self.sequence = sequence
    }

    func next() -> AudioSessionPrepareResult {
        if sequence.isEmpty { return .active }
        return sequence.removeFirst()
    }
}
