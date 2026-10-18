import XCTest
import WebKit
@testable import AppleFileSync
@testable import Thingtime

@MainActor
final class MobileWriteApprovalTests: XCTestCase {
    @MainActor private final class Fixture {
        let directory: URL
        let owner: FileSyncOwnerScope
        let grant: MobileFolderStore.Grant
        let approval: MobileFolderStore.WriteApproval
        let webView = WKWebView()
        let store: MobileFolderStore
        var bridge: MobileFolderBridge
        var ownerChecks = 0
        var deviceChecks = 0
        var onOwner: (() throws -> Void)?
        var onDevice: (() throws -> Void)?
        private let storage: Storage
        var writes: Int { storage.writes }
        private final class Storage { var data: Data?; var writes = 0 }

        init() throws {
            directory = FileManager.default.temporaryDirectory.appendingPathComponent("ios-approval-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            owner = try FileSyncOwnerScope(ownerId: "isolated-approval-test", url: URL(string: "https://thingtime.test")!)
            let storage = Storage(); self.storage = storage
            store = MobileFolderStore(load: { _ in storage.data }, save: { _, value in storage.data = value; storage.writes += 1 })
            grant = try store.add(owner, selected: directory)
            approval = .init(scope: .init(origin: owner.origin.absoluteString, ownerId: owner.ownerId,
                dataPlane: "home", rootId: "connection", deviceId: "paired-device"),
                configurationRevision: "revision-1", configurationHash: String(repeating: "a", count: 64))
            bridge = MobileFolderBridge(store: store)
            webView.configuration.userContentController.addUserScript(WKUserScript(source: "window.thingtimeNativeBridge = {};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
            webView.configuration.userContentController.addUserScript(MobileFolderBridge.script)
        }

        func load() async throws {
            webView.loadHTMLString("<html><body>Isolated native approval fixture</body></html>", baseURL: owner.origin)
            for _ in 0..<100 {
                if let value = try? await webView.evaluateJavaScript("window.thingtimeNativeBridge?.filePublicationVersion"), value as? String == "1.2.0" { return }
                try await Task.sleep(nanoseconds: 20_000_000)
            }
            XCTFail("Native publication capability did not load")
        }

        func call(_ test: XCTestCase, approval: MobileFolderStore.WriteApproval? = nil, deviceVerifier: Bool = true,
                  action: String = "write-check", rootId: String? = nil) async throws -> [String: Any] {
            let done = test.expectation(description: "native saved approval result")
            var result: [String: Any]?
            let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(approval ?? self.approval))
            bridge.handle(["payload": ["requestId": UUID().uuidString, "ownerId": owner.ownerId,
                "rootId": rootId ?? grant.id, "action": action, "approval": encoded]], webView: webView,
                root: owner.origin, currentRoot: { self.owner.origin }, verifyOwner: { scope, check in
                    XCTAssertEqual(scope, self.owner); try check(); self.ownerChecks += 1; try self.onOwner?()
                }, verifyDevice: deviceVerifier ? { scope, deviceId, check in
                    XCTAssertEqual(scope, self.owner); XCTAssertEqual(deviceId, "paired-device")
                    try check(); self.deviceChecks += 1; try self.onDevice?()
                } : nil, reply: { type, payload in
                    XCTAssertEqual(type, "mobile-files-result"); result = payload; done.fulfill()
                })
            await test.fulfillment(of: [done], timeout: 5)
            return try XCTUnwrap(result)
        }
    }

    private func fixture(approved: Bool = true) async throws -> Fixture {
        let fixture = try Fixture()
        addTeardownBlock { @MainActor in
            fixture.onOwner = nil; fixture.onDevice = nil
            fixture.bridge.suspend()
            try? FileManager.default.removeItem(at: fixture.directory)
        }
        if approved { try fixture.store.approveWrite(fixture.owner, grant: fixture.grant, approval: fixture.approval) }
        try await fixture.load()
        return fixture
    }

    func testExistingConsentSurvivesBridgeRestartWithoutSavingOrPrompting() async throws {
        let f = try await fixture(), writes = f.writes
        for _ in 0..<2 {
            let result = try await f.call(self)
            XCTAssertNil(result["error"]); XCTAssertNotNil(result["writeApproval"])
            let roots = try XCTUnwrap(result["roots"] as? [[String: Any]])
            XCTAssertEqual(roots.first?["publicationVersion"] as? String, "1.2.0")
            XCTAssertEqual(f.writes, writes)
            f.bridge.suspend(); f.bridge = MobileFolderBridge(store: f.store)
        }
        XCTAssertEqual(f.ownerChecks, 4); XCTAssertEqual(f.deviceChecks, 4)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: f.directory.path), [])
    }

    func testMissingConsentFailsWithoutPromptOrPersistingConsent() async throws {
        let f = try await fixture(approved: false), writes = f.writes
        let result = try await f.call(self)
        XCTAssertNotNil(result["error"]); XCTAssertNil(result["writeApproval"])
        XCTAssertEqual(f.writes, writes)
        XCTAssertFalse(try f.store.isWriteApproved(f.owner, id: f.grant.id, approval: f.approval))
    }

    func testChangedSettingsOrTrashConsentCannotReuseApproval() async throws {
        let f = try await fixture(), writes = f.writes
        for approval in [
            MobileFolderStore.WriteApproval(scope: f.approval.scope, configurationRevision: "revision-2", configurationHash: f.approval.configurationHash),
            .init(scope: f.approval.scope, configurationRevision: "revision-1", configurationHash: String(repeating: "b", count: 64)),
            .init(scope: f.approval.scope, configurationRevision: "revision-1", configurationHash: f.approval.configurationHash, allowTrash: true)
        ] {
            let result = try await f.call(self, approval: approval)
            XCTAssertNotNil(result["error"]); XCTAssertNil(result["writeApproval"])
        }
        XCTAssertEqual(f.writes, writes)
    }

    func testMissingDeviceVerifierFailsClosed() async throws {
        let f = try await fixture()
        let result = try await f.call(self, deviceVerifier: false)
        XCTAssertNotNil(result["error"]); XCTAssertNil(result["writeApproval"])
    }

    func testUnpairedDeviceCannotReuseSavedConsent() async throws {
        let f = try await fixture()
        f.onDevice = { throw MobileFolderStore.Failure.unavailable }
        let result = try await f.call(self)
        XCTAssertNotNil(result["error"]); XCTAssertNil(result["writeApproval"])
        XCTAssertEqual(f.deviceChecks, 1)
    }

    func testGrantRevocationDuringFinalDeviceCheckFails() async throws {
        let f = try await fixture()
        f.onDevice = { if f.deviceChecks == 2 { try f.store.remove(f.owner, id: f.grant.id) } }
        let result = try await f.call(self)
        XCTAssertNotNil(result["error"]); XCTAssertNil(result["writeApproval"])
        XCTAssertEqual(f.deviceChecks, 2)
    }

    func testApprovalReplacementDuringFinalDeviceCheckFails() async throws {
        let f = try await fixture()
        f.onDevice = {
            if f.deviceChecks == 2 {
                let replacement = MobileFolderStore.WriteApproval(scope: f.approval.scope,
                    configurationRevision: "revision-2", configurationHash: f.approval.configurationHash)
                try f.store.approveWrite(f.owner, grant: f.grant, approval: replacement)
            }
        }
        let result = try await f.call(self)
        XCTAssertNotNil(result["error"]); XCTAssertNil(result["writeApproval"])
    }

    func testUnavailableNativeFolderCannotReuseSavedConsent() async throws {
        let f = try await fixture(), writes = f.writes
        try FileManager.default.removeItem(at: f.directory)
        let result = try await f.call(self)
        XCTAssertNotNil(result["error"]); XCTAssertNil(result["writeApproval"])
        XCTAssertEqual(f.writes, writes)
    }

    func testOwnerChangeDuringFinalAuthorizationFails() async throws {
        let f = try await fixture()
        f.onOwner = { if f.ownerChecks == 2 { throw MobileFolderStore.Failure.unavailable } }
        let result = try await f.call(self)
        XCTAssertNotNil(result["error"]); XCTAssertNil(result["writeApproval"])
        XCTAssertEqual(f.deviceChecks, 1)
    }

    func testPhotoSourcesNeverAdvertiseOrReceivePublicationAuthority() async throws {
        let f = try await fixture()
        let photo = try f.store.addPhotos(f.owner)
        let listed = try await f.call(self, action: "list")
        let roots = try XCTUnwrap(listed["roots"] as? [[String: Any]])
        let source = try XCTUnwrap(roots.first { $0["id"] as? String == photo.id })
        XCTAssertEqual(source["sourceKind"] as? String, "photos"); XCTAssertNil(source["publicationVersion"])
        let denied = try await f.call(self, rootId: photo.id)
        XCTAssertNotNil(denied["error"]); XCTAssertNil(denied["writeApproval"])
        XCTAssertEqual(f.deviceChecks, 0)
    }

    func testForeignOwnerAndOriginApprovalsFailBeforeDeviceAccess() async throws {
        let f = try await fixture(), writes = f.writes
        for scope in [
            MobileSyncStaging.Scope(origin: "https://other.test", ownerId: f.owner.ownerId, dataPlane: "home", rootId: "connection", deviceId: "paired-device"),
            .init(origin: f.owner.origin.absoluteString, ownerId: "other-owner", dataPlane: "home", rootId: "connection", deviceId: "paired-device")
        ] {
            let approval = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "revision-1", configurationHash: f.approval.configurationHash)
            let denied = try await f.call(self, approval: approval)
            XCTAssertNotNil(denied["error"]); XCTAssertNil(denied["writeApproval"])
        }
        XCTAssertEqual(f.writes, writes); XCTAssertEqual(f.deviceChecks, 0)
    }
}
