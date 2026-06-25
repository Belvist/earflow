import XCTest
@testable import Earflow

final class StreamURLResolverTests: XCTestCase {
    func testResolvesRelativeMasterAgainstGatewayForNative() {
        let url = StreamURLResolver.resolveMasterURL(
            "/api/ebap-hls/v1/tracks/626/master.m3u8",
            configuration: .production
        )
        XCTAssertEqual(url?.host, "api.earflow.ru")
        XCTAssertEqual(url?.scheme, "https")
    }

    func testRewritesAbsoluteStrmhahaToGateway() {
        let raw = "https://strmhaha.earflow.ru/audio/v3/direct/ps_x/master.m3u8?st=tok"
        let url = StreamURLResolver.resolveMasterURL(raw, configuration: .production)
        XCTAssertEqual(url?.host, "api.earflow.ru")
        XCTAssertEqual(url?.path, "/audio/v3/direct/ps_x/master.m3u8")
        XCTAssertEqual(url?.query, "st=tok")
    }

    func testNativePlaybackURLPreservesPathAndQuery() {
        let input = URL(string: "https://strmhaha.earflow.ru/api/ebap-hls/v1/hls/42/master.m3u8?token=abc&st=xyz")!
        let out = StreamURLResolver.nativePlaybackURL(input, configuration: .production)
        XCTAssertEqual(out.host, "api.earflow.ru")
        XCTAssertEqual(out.path, "/api/ebap-hls/v1/hls/42/master.m3u8")
        XCTAssertEqual(out.query, "token=abc&st=xyz")
    }
}
