import AppleFileSync
import Foundation
import XCTest
@testable import Thingtime

final class NativePhotoQueueReceiptTests: XCTestCase {
    func testOnlyExactObservedCloudBytesCanAcknowledgePreparedOriginal() throws {
        let path = String(repeating: "a", count: 64) + "-0-Paired Original.mov"
        let digest = String(repeating: "f", count: 64)
        let sourceData: [String: Any] = ["path": path, "id": "original", "version": "v1",
            "kind": "file", "size": 9, "sha256": digest]
        let original = try JSONDecoder().decode(MobileFolderReader.Entry.self, from: JSONSerialization.data(withJSONObject: sourceData))
        var remote = sourceData
        remote["id"] = "cloud-file"; remote["version"] = "cloud-revision"
        func reply(_ entry: [String: Any]?, root: String = "private-folder", complete: Bool = true) -> [String: Any] {
            let observation: [String: Any] = ["version": 1, "complete": complete, "rootId": root,
                "path": path, "entry": entry as Any? ?? NSNull()]
            return ["ok": true, "observation": observation]
        }
        XCTAssertNoThrow(try NativePhotoQueueReceipt.validate(reply(remote), rootId: "private-folder", source: original))
        XCTAssertThrowsError(try NativePhotoQueueReceipt.validate(reply(nil), rootId: "private-folder", source: original))
        XCTAssertThrowsError(try NativePhotoQueueReceipt.validate(reply(remote, root: "different-folder"), rootId: "private-folder", source: original))
        XCTAssertThrowsError(try NativePhotoQueueReceipt.validate(reply(remote, complete: false), rootId: "private-folder", source: original))
        remote["sha256"] = String(repeating: "0", count: 64)
        XCTAssertThrowsError(try NativePhotoQueueReceipt.validate(reply(remote), rootId: "private-folder", source: original))
        let query = try XCTUnwrap(URLComponents(string: NativePhotoQueueReceipt.observationPath(rootId: "private-folder", path: path)))
        XCTAssertEqual(query.path, "/api/v1/files")
        XCTAssertEqual(query.queryItems, [.init(name: "rootId", value: "private-folder"), .init(name: "path", value: path)])
    }
}
