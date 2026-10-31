import AppleFileSync
import CryptoKit
import Foundation
@testable import ThingtimeNodeCore
import XCTest

@MainActor final class MacFolderBatchTests: XCTestCase {
    private func vectors() throws -> [[String: Any]] {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let value = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("remix/app/fileSync/fixtures/folderBatchDigest.v1.json"))) as! [String: Any]
        return value["vectors"] as! [[String: Any]]
    }
    private func digest(_ d: [String: Any]) -> String {
        let s = d["scope"] as! [String: Any], saved = d["configuration"] as! [String: Any], c = saved["configuration"] as! [String: Any]
        let ignore = (c["ignoreRules"] as? String ?? "").replacingOccurrences(of: "\r\n", with: "\n"), excluded = c["excludedPaths"] as! [String]
        let members = d["members"] as! [[String: Any]]
        var fields = ["thingtime-folder-batch-v1", d["batchId"] as! String, s["origin"] as! String, s["ownerId"] as! String, "home", s["rootId"] as! String, s["deviceId"] as! String,
            saved["id"] as! String, saved["updatedAt"] as! String, ignore.isEmpty ? "1" : "2", (c["name"] as! String).trimmingCharacters(in: .whitespacesAndNewlines), c["deviceId"] as! String,
            c["localRootId"] as! String, "folder", c["remoteFolderId"] as! String, c["mode"] as! String, "0", "0", c["network"] as! String, (c["chargingOnly"] as! Bool) ? "1" : "0", String(excluded.count)] + excluded + [ignore, String(members.count)]
        for (ordinal, member) in members.enumerated() {
            let w = member["write"] as! [String: Any], o = w["operation"] as! [String: Any], m = o["mutation"] as! [String: Any], e = m["source"] as! [String: Any], p = member["parent"] as! [String: Any], kind = p["kind"] as! String
            fields += [String(ordinal), o["id"] as! String, w["cloudRootId"] as! String, w["folderId"] as! String, e["path"] as! String, e["id"] as! String, e["version"] as! String, kind, kind == "member" ? String(p["ordinal"] as! Int) : (p["id"] as? String ?? "")]
        }
        return SHA256.hash(data: Data(fields.map { "\($0.utf8.count):\($0)" }.joined().utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func json(_ value: Any) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: value)) }
    private func fixture() throws -> (URL, MobileFolderStore, FileSyncOwnerScope, MobileFolderStore.Grant, JSONValue) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        var saved: Data?
        let store = MobileFolderStore(load: { _ in saved }, save: { _, data in saved = data })
        let owner = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let grant = try store.add(owner, selected: root)
        var d = try vectors()[0]["descriptor"] as! [String: Any]
        var configuration = d["configuration"] as! [String: Any], c = configuration["configuration"] as! [String: Any]
        c["localRootId"] = grant.id; configuration["configuration"] = c; d["configuration"] = configuration
        var members = d["members"] as! [[String: Any]]
        var siblingWrite = members[2]["write"] as! [String: Any], siblingOperation = siblingWrite["operation"] as! [String: Any], siblingMutation = siblingOperation["mutation"] as! [String: Any]
        siblingMutation["path"] = "Sibling"; siblingOperation["mutation"] = siblingMutation; siblingWrite["operation"] = siblingOperation
        siblingWrite["folderId"] = "cloud-root"; members[2]["write"] = siblingWrite; members[2]["parent"] = ["kind":"root"]
        for member in members {
            let w = member["write"] as! [String: Any], o = w["operation"] as! [String: Any], m = o["mutation"] as! [String: Any]
            try FileManager.default.createDirectory(at: root.appendingPathComponent(m["path"] as! String), withIntermediateDirectories: true)
        }
        for i in members.indices {
            var w = members[i]["write"] as! [String: Any], o = w["operation"] as! [String: Any], m = o["mutation"] as! [String: Any]
            let entry = try XCTUnwrap(MobileFolderReader.inspect(bookmark: grant.bookmark, path: m["path"] as! String))
            m["source"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(entry)); o["mutation"] = m; w["operation"] = o; members[i]["write"] = w
        }
        d["members"] = members
        return (root, store, owner, grant, try json(["descriptor":d,"digest":digest(d),"ordinals":[0,2]]))
    }
    private func request(_ grant: MobileFolderStore.Grant, _ batch: JSONValue, remaining: Int = 180000) -> JSONValue {
        .object(["action":.string("validate-folder-batch"),"requestId":.string(UUID().uuidString),"ownerId":.string("owner"),"deviceId":.string("device"),"origin":.string("https://sync.test"),"rootId":.string(grant.id),"batch":batch,"remainingMs":.number(Double(remaining))])
    }
    func testCrossLanguageVectorsAndV1NoIgnore() throws {
        for v in try vectors() {
            let batch = try MacFolderBatchDescriptor(json(["descriptor":v["descriptor"]!,"digest":v["sha256"]!,"ordinals":[0]]))
            XCTAssertEqual(String(decoding: batch.canonicalBytes, as: UTF8.self), v["canonicalUtf8"] as? String)
        }
    }
    func testMissingSubsetSkipsGoneReceiptSourceAndUsesTwoFreshChecks() async throws {
        let (root, store, _, grant, raw) = try fixture(); let batch = try MacFolderBatchDescriptor(raw)
        // Ordinal1 is omitted because the caller already holds its exact receipt.
        try FileManager.default.removeItem(at: root.appendingPathComponent(batch.members[1].source.path))
        // Removing a child legitimately invalidates ordinal0's full stamp.
        var checks = 0
        let service = try MacFolderSync(origin: URL(string:"https://sync.test")!, store:store, staging:MobileSyncStaging(directory:root.appendingPathComponent("cache")),verify:{_,_ in checks += 1},choose:{nil},approve:{_ in false},conditions:{.init(network:"wifi",charging:true)})
        let result = try await service.handle(request(grant, raw)), envelope = try result.decode([String: JSONValue].self)
        let body = try envelope["validatedFolderBatch"]!.decode([String: JSONValue].self), rows = try BatchJSON.array(body["results"]!)
        XCTAssertEqual(rows.count,2); XCTAssertEqual(checks,2)
        XCTAssertEqual(try rows[0].decode([String:JSONValue].self)["code"],.string("source-changed"))
        XCTAssertEqual(try rows[1].decode([String:JSONValue].self)["status"],.string("validated"))
    }
    func testPostIdentityRevocationAndExpiredBudgetRejectEntireEnvelope() async throws {
        for expired in [false,true] {
            let (root,store,owner,grant,raw) = try fixture(); var checks = 0
            let service = try MacFolderSync(origin:URL(string:"https://sync.test")!,store:store,staging:MobileSyncStaging(directory:root.appendingPathComponent("cache")),verify:{_,_ in
                checks += 1
                if expired { try await Task.sleep(for:.milliseconds(20)) }
                else if checks == 2 { try store.remove(owner,id:grant.id) }
            },choose:{nil},approve:{_ in false},conditions:{.init(network:"wifi",charging:true)})
            do { _ = try await service.handle(request(grant,raw,remaining:expired ? 1 : 180000)); XCTFail("Revoked/expired batch accepted") } catch {}
        }
    }
    func testSubsetDigestAndParentProtocolDriftFailClosed() throws {
        let (_,_,_,_,raw) = try fixture()
        guard case .object(var fields) = raw else { return XCTFail("fixture") }
        for ordinals in [[2,0],[0,0],[],[3]] {
            fields["ordinals"] = .array(ordinals.map { .number(Double($0)) })
            XCTAssertThrowsError(try MacFolderBatchDescriptor(.object(fields)))
        }
        fields["ordinals"] = .array([.number(0)])
        fields["digest"] = .string(String(repeating:"0",count:64))
        XCTAssertThrowsError(try MacFolderBatchDescriptor(.object(fields)))
    }
    func testCancellationAndFinalConditionChangeRejectEntireEnvelope() async throws {
        for cancel in [true,false] {
            let (root,store,_,grant,raw) = try fixture(); var checks=0, charging=true
            let service = try MacFolderSync(origin:URL(string:"https://sync.test")!,store:store,staging:MobileSyncStaging(directory:root.appendingPathComponent("cache")),verify:{_,_ in
                checks += 1
                if cancel { throw CancellationError() }
                if checks == 2 { charging=false }
            },choose:{nil},approve:{_ in false},conditions:{.init(network:charging ? "wifi" : "unknown",charging:charging)})
            do { _ = try await service.handle(request(grant,raw)); XCTFail("Cancelled/changed conditions accepted") } catch {}
            XCTAssertEqual(checks,cancel ? 1 : 2)
        }
    }

}
