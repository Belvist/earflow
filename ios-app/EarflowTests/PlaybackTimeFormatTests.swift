import XCTest
@testable import Earflow

final class PlaybackTimeFormatTests: XCTestCase {
    func testMmssZero() {
        XCTAssertEqual(PlaybackTimeFormat.mmss(0), "0:00")
    }

    func testMmssUnderMinute() {
        XCTAssertEqual(PlaybackTimeFormat.mmss(42), "0:42")
    }

    func testMmssOverMinute() {
        XCTAssertEqual(PlaybackTimeFormat.mmss(125), "2:05")
    }

    func testMmssInvalid() {
        XCTAssertEqual(PlaybackTimeFormat.mmss(.nan), "0:00")
    }

    func testProgressFraction() {
        let p = PlaybackProgress(currentTime: 30, duration: 120)
        XCTAssertEqual(p.fraction, 0.25, accuracy: 0.001)
    }

    func testProgressFractionZeroDuration() {
        let p = PlaybackProgress(currentTime: 10, duration: 0)
        XCTAssertEqual(p.fraction, 0)
    }
}
