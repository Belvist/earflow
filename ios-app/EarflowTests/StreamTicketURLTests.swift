import XCTest
@testable import Earflow

final class StreamTicketURLTests: XCTestCase {
    func testAttachAddsStQueryParam() {
        let base = URL(string: "https://strmhaha.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8")!
        let out = StreamTicketURL.attach(base, ticket: "opaque_abc")
        XCTAssertEqual(out.absoluteString, "https://strmhaha.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8?st=opaque_abc")
    }

    func testAttachReplacesExistingSt() {
        let base = URL(string: "https://strmhaha.earflow.ru/stream?foo=1&st=old")!
        let out = StreamTicketURL.attach(base, ticket: "new")
        XCTAssertTrue(out.absoluteString.contains("st=new"))
        XCTAssertFalse(out.absoluteString.contains("st=old"))
    }
}
