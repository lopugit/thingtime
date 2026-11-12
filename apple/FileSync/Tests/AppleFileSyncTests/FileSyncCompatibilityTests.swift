import XCTest
import AppleFileSync

final class FileSyncCompatibilityTests: XCTestCase {
    func testExistingOwnerScopeKeepsItsJSONAndKeychainIdentity() throws {
        // Persisted by MobileDevicePairing.Scope before the shared-module move.
        let legacy = Data(#"{"ownerId":"test-owner","origin":"https://example.test"}"#.utf8)
        let saved = try JSONDecoder().decode(FileSyncOwnerScope.self, from: legacy)
        let current = try FileSyncOwnerScope(ownerId: "test-owner", url: URL(string: "https://EXAMPLE.test:443/things?view=files")!)
        XCTAssertEqual(saved, current)
        XCTAssertEqual(saved.key, "de7550bcb12c6a5026342f4cbf8d63e770e49c0ebf801b97bc5bbe1b016a5f1d")
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(current)) as? NSDictionary
        XCTAssertEqual(encoded, try JSONSerialization.jsonObject(with: legacy) as? NSDictionary)
        XCTAssertThrowsError(try FileSyncOwnerScope(ownerId: "test-owner", url: URL(string: "http://example.test")!))
        XCTAssertThrowsError(try FileSyncOwnerScope(ownerId: "test-owner", url: URL(string: "https://user:secret@example.test")!))
    }
}
