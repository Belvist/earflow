import XCTest
@testable import Earflow

final class CatalogDecodeTests: XCTestCase {
    func testDecodeLikesArrayPayload() throws {
        let json = """
        [{"id":1,"title":"Track A","artist":"Artist","cover_url":"/c.jpg"}]
        """.data(using: .utf8)!
        let tracks = try JSONDecoder().decode([TrackItem].self, from: json)
        XCTAssertEqual(tracks.count, 1)
        XCTAssertEqual(tracks[0].id, 1)
        XCTAssertEqual(tracks[0].displayTitle, "Track A")
    }

    func testSocialPostIdAcceptsIntOrString() throws {
        let intJson = """
        {"id":101,"body":"hello","author":{"displayName":"A"}}
        """.data(using: .utf8)!
        let intPost = try JSONDecoder().decode(SocialPostDTO.self, from: intJson)
        XCTAssertEqual(intPost.id, "101")

        let strJson = """
        {"id":"101","body":"hello"}
        """.data(using: .utf8)!
        let strPost = try JSONDecoder().decode(SocialPostDTO.self, from: strJson)
        XCTAssertEqual(strPost.id, "101")
    }
}
