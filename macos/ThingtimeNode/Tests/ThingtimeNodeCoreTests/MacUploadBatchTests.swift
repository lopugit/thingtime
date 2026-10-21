import AppleFileSync
import CryptoKit
import CryptoKit
import XCTest
@testable import ThingtimeNodeCore

final class MacUploadBatchTests: XCTestCase {
    private func vectors() throws -> [[String: Any]] {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let data = try Data(contentsOf: root.appendingPathComponent("remix/app/fileSync/fixtures/uploadBatchDigest.v1.json"))
        return try XCTUnwrap((JSONSerialization.jsonObject(with: data) as? [String: Any])?["vectors"] as? [[String: Any]])
    }
    func testSharedASCIIAndUnicodeCanonicalVectors() throws {
        for vector in try vectors() {
            let raw = try JSONSerialization.data(withJSONObject: ["descriptor": vector["descriptor"]!, "digest": vector["digest"]!])
            let parsed = try MacUploadBatchDescriptor(JSONDecoder().decode(JSONValue.self, from: raw))
            XCTAssertEqual(parsed.digest, vector["digest"] as? String)
            XCTAssertEqual(parsed.canonicalBytes.count, vector["canonicalBytes"] as? Int)
            XCTAssertEqual(parsed.canonicalBytes.base64EncodedString(), vector["canonicalBase64"] as? String)
        }
    }
    func testV1AndV2WithoutIgnoreRulesUseSharedV1CanonicalPolicy() throws {
        let vector = try XCTUnwrap(vectors().first)
        var descriptor = try XCTUnwrap(vector["descriptor"] as? [String: Any])
        var saved = try XCTUnwrap(descriptor["configuration"] as? [String: Any])
        var configuration = try XCTUnwrap(saved["configuration"] as? [String: Any])
        configuration.removeValue(forKey: "ignoreRules")
        let original = try XCTUnwrap(Data(base64Encoded: vector["canonicalBase64"] as! String))
        let canonical = String(decoding: original, as: UTF8.self).replacingOccurrences(of: "1:2", with: "1:1").replacingOccurrences(of: "6:*.tmp\n", with: "0:")
        let digest = SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined()
        for version in [1, 2] {
            configuration["configurationVersion"] = version; saved["configuration"] = configuration; descriptor["configuration"] = saved
            let value = try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: ["descriptor": descriptor, "digest": digest]))
            XCTAssertEqual(try MacUploadBatchDescriptor(value).canonicalBytes, Data(canonical.utf8))
        }
    }
    func testDigestAndUnknownDescriptorFieldsFailClosed() throws {
        let vector = try XCTUnwrap(vectors().first)
        var descriptor = try XCTUnwrap(vector["descriptor"] as? [String: Any])
        descriptor["url"] = "https://forbidden.test"
        for row in [["descriptor": descriptor, "digest": vector["digest"]!], ["descriptor": vector["descriptor"]!, "digest": String(repeating: "0", count: 64)]] {
            let value = try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: row))
            XCTAssertThrowsError(try MacUploadBatchDescriptor(value))
        }
    }
    private final class SilentCallback: NSObject, ThingtimeNodeBatchCallback {
        func exchange(_ frame: Data, withReply reply: @escaping (Data) -> Void) { }
    }
    func testMissingCallbackHasBoundedTimeoutAndCancellation() async throws {
        let callback = SilentCallback()
        do { _ = try await NodeBatchCallback.exchange(callback, frame: .object(["kind": .string("verify-ready")]), timeout: 0.01); XCTFail("Missing callback accepted") }
        catch { XCTAssertTrue(error is CancellationError) }
        let task = Task { try await NodeBatchCallback.exchange(callback, frame: .object(["kind": .string("verify-ready")]), timeout: 60) }
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancellation ignored") } catch { XCTAssertTrue(error is CancellationError) }
    }
}
