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
    func testSharedResourceV3IEEE754CanonicalVectors() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let file = try Data(contentsOf: root.appendingPathComponent("remix/app/fileSync/fixtures/resourceLimits.v3.json"))
        let rows = try XCTUnwrap((JSONSerialization.jsonObject(with: file) as? [String: Any])?["vectors"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 6)
        for row in rows {
            var envelope: [String: Any] = ["descriptor": row["descriptor"]!, "digest": row["sha256"]!]
            if row["kind"] as? String == "folder" { envelope["ordinals"] = [0] }
            let encoded = try JSONSerialization.data(withJSONObject: envelope)
            let raw = try JSONDecoder().decode(JSONValue.self, from: encoded)
            let actual: Data
            if row["kind"] as? String == "upload" { actual = try MacUploadBatchDescriptor(raw).canonicalBytes }
            else { actual = try MacFolderBatchDescriptor(raw).canonicalBytes }
            XCTAssertEqual(actual.base64EncodedString(), row["canonicalBase64"] as? String)
        }
    }
    private final class SilentCallback: NSObject, ThingtimeNodeBatchCallback {
        func exchange(_ frame: Data, withReply reply: @escaping (Data) -> Void) { }
    }
    func testOnlyGovernedPayloadCallbackMayOutliveWallClockAndStillCancels() async throws {
        let callback = SilentCallback()
        do { _ = try await NodeBatchCallback.exchange(callback, frame: .object(["kind": .string("prepare-ready")]), timeout: .infinity); XCTFail("Control callback lost its deadline") }
        catch { XCTAssertTrue(error is CancellationError) }
        let task = Task { try await NodeBatchCallback.exchange(callback, frame: .object(["kind": .string("put-ready")]), timeout: .infinity) }
        await Task.yield(); task.cancel()
        do { _ = try await task.value; XCTFail("Governed payload ignored cancellation") } catch { XCTAssertTrue(error is CancellationError) }
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
