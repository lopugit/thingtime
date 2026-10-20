import XCTest
import Foundation
import CryptoKit
import AppleFileSync
@testable import ThingtimeNodeCore

@MainActor
final class MacFolderSyncTests: XCTestCase {
    private let origin = URL(string: "https://sync.test")!
    func testStreamingLifecycleRetainsGenerationAndRejectsPolicyOrGrantChanges() async throws {
        var saved: [String: Data] = [:]
        let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
        let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
        let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
        let helper = folder.appendingPathComponent("paused-helper")
        try Data("#!/bin/sh\nread request\nprintf '%s\\n' '{\"event\":\"hello\",\"version\":1,\"streaming\":true}'\nexec /bin/sleep 20\n".utf8).write(to: helper)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
        let waitEntered = expectation(description: "long-poll entered its own lane")
        var observeWait = false
        let service = try MacFolderSync(origin: origin, store: store, staging: MobileSyncStaging(directory: folder.appendingPathComponent("stage")),
            verify: { _, _ in if observeWait { observeWait = false; waitEntered.fulfill() } }, choose: { nil }, approve: { _ in false },
            inventories: MobileFolderInventory(directory: folder.appendingPathComponent("stream"), commanderIndexer: helper))
        defer { service.suspend() }
        var fields = backupFields(grant.id)
        fields["capturePolicy"] = .string("one-way-supported")
        let started = try await service.handle(request("scan-stream", fields)).decode([String: JSONValue].self)
        let initial = try XCTUnwrap(started["changesPage"]).decode([String: JSONValue].self)
        XCTAssertEqual(initial["state"], .string("running"))
        var longPoll = fields; longPoll["afterSequence"] = .number(0); longPoll["waitMilliseconds"] = .number(25_000)
        observeWait = true
        let pending = Task { try await service.handle(self.request("scan-changes", longPoll)) }
        await fulfillment(of: [waitEntered], timeout: 2)
        try Data("read during indexing".utf8).write(to: folder.appendingPathComponent("selected/read"))
        let inspected = try await service.handle(request("inspect", ["rootId": .string(grant.id), "path": .string("read")])).decode([String: JSONValue].self)
        let observed = try XCTUnwrap(inspected["entry"]).decode([String: JSONValue].self)
        let range = try await service.handle(request("read", ["rootId": .string(grant.id), "path": .string("read"), "version": try XCTUnwrap(observed["version"]), "offset": .number(0), "length": .number(1)])).decode([String: JSONValue].self)
        XCTAssertNotNil(range["chunk"])
        pending.cancel()
        do { _ = try await pending.value; XCTFail("Cancelled waiter disclosed a result") } catch { }
        var waiting = fields; waiting["afterSequence"] = .number(0); waiting["waitMilliseconds"] = .number(10)
        let response = try await service.handle(request("scan-changes", waiting)).decode([String: JSONValue].self)
        let page = try XCTUnwrap(response["changesPage"]).decode([String: JSONValue].self)
        XCTAssertEqual(page["generation"], initial["generation"])
        var foreign = fields; foreign["captureId"] = .string(UUID().uuidString.lowercased())
        await rejects { try await service.handle(self.request("scan-cancel", foreign)) }
        let retained = try await service.handle(request("scan-changes", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(try retained["changesPage"]?.decode([String: JSONValue].self)["state"], .string("running"))
        var changed = fields; changed["ignoreRules"] = .string("*.txt")
        await rejects { try await service.handle(self.request("scan-changes", changed)) }
        let stopped = try await service.handle(request("scan-cancel", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(try stopped["changesPage"]?.decode([String: JSONValue].self)["state"], .string("interrupted"))
        try store.remove(owner, id: grant.id)
        await rejects { try await service.handle(self.request("scan-changes", fields)) }
    }

    func testIndexedWatcherOnlyFinishesAfterConsumerAcknowledgesCurrentSequence() async throws {
        var saved: [String: Data] = [:]
        let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
        let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
        let selected = folder.appendingPathComponent("selected")
        try Data("content".utf8).write(to: selected.appendingPathComponent("file"))
        let grant = try store.add(owner, selected: selected)
        let entry = try XCTUnwrap(MobileFolderReader.scan(bookmark: grant.bookmark).first)
        let event = String(decoding: try JSONEncoder().encode(entry), as: UTF8.self)
        let helper = folder.appendingPathComponent("indexed-helper")
        let text = "#!/bin/sh\nread request\nprintf '%s\\n' '{\"event\":\"hello\",\"version\":1,\"streaming\":true}' '{\"event\":\"entry\",\"entry\":\(event)}' '{\"event\":\"indexed\"}'\nread stop\nprintf '%s\\n' '{\"event\":\"complete\"}'\n"
        try Data(text.utf8).write(to: helper)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
        let service = try MacFolderSync(origin: origin, store: store, staging: MobileSyncStaging(directory: folder.appendingPathComponent("stage")),
            verify: { _, _ in }, choose: { nil }, approve: { _ in false },
            inventories: MobileFolderInventory(directory: folder.appendingPathComponent("stream"), commanderIndexer: helper))
        defer { service.suspend() }
        var fields = backupFields(grant.id); fields["capturePolicy"] = .string("one-way-supported")
        _ = try await service.handle(request("scan-stream", fields))
        var reading = fields; reading["afterSequence"] = .number(0); reading["waitMilliseconds"] = .number(1000)
        var result = try await service.handle(request("scan-changes", reading)).decode([String: JSONValue].self)
        var page = try XCTUnwrap(result["changesPage"]).decode([String: JSONValue].self)
        if page["state"] != .string("indexed") {
            reading["afterSequence"] = page["revision"]
            result = try await service.handle(request("scan-changes", reading)).decode([String: JSONValue].self)
            page = try XCTUnwrap(result["changesPage"]).decode([String: JSONValue].self)
        }
        XCTAssertEqual(page["state"], .string("indexed")); XCTAssertEqual(page["revision"], .number(1))
        var stale = fields; stale["afterSequence"] = .number(0)
        let refused = try await service.handle(request("scan-stream-finish", stale)).decode([String: JSONValue].self)
        let refusedPage = try XCTUnwrap(refused["changesPage"]).decode([String: JSONValue].self)
        XCTAssertEqual(refusedPage["state"], .string("indexed"))
        XCTAssertEqual(try refusedPage["changes"]?.decode([JSONValue].self).count, 1)
        var caughtUp = fields; caughtUp["afterSequence"] = .number(1)
        _ = try await service.handle(request("scan-stream-finish", caughtUp))
        caughtUp["waitMilliseconds"] = .number(2000)
        let finished = try await service.handle(request("scan-changes", caughtUp)).decode([String: JSONValue].self)
        XCTAssertEqual(try finished["changesPage"]?.decode([String: JSONValue].self)["state"], .string("complete"))
    }

    func testCancelledIdentityRequestsPreserveIndependentStreamingCapture() async throws {
        for action in ["list", "scan-changes"] {
            for networkCancellation in [false, true] {
                var saved: [String: Data] = [:], blockVerification = false, rejectIdentity = false
                let entered = expectation(description: "request identity verification entered")
                let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
                let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
                let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
                let helper = folder.appendingPathComponent("cancel-helper")
                try Data("#!/bin/sh\nread request\nprintf '%s\\n' '{\"event\":\"hello\",\"version\":1,\"streaming\":true}'\nexec /bin/sleep 20\n".utf8).write(to: helper)
                try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
                let service = try MacFolderSync(origin: origin, store: store,
                    staging: MobileSyncStaging(directory: folder.appendingPathComponent(UUID().uuidString)),
                    verify: { _, _ in
                        if rejectIdentity { rejectIdentity = false; throw ThingtimeAPIClientError.rejected(status: 403) }
                        if blockVerification {
                            blockVerification = false; entered.fulfill()
                            do { try await Task.sleep(for: .seconds(20)) }
                            catch { if networkCancellation { throw URLError(.cancelled) }; throw CancellationError() }
                        }
                    }, choose: { nil }, approve: { _ in false },
                    inventories: MobileFolderInventory(directory: folder.appendingPathComponent(UUID().uuidString), commanderIndexer: helper))
                defer { service.suspend() }
                var fields = backupFields(grant.id); fields["capturePolicy"] = .string("one-way-supported")
                let start = try await service.handle(request("scan-stream", fields)).decode([String: JSONValue].self)
                let generation = try start["changesPage"]?.decode([String: JSONValue].self)["generation"]
                var reading = fields; reading["afterSequence"] = .number(0); reading["waitMilliseconds"] = .number(500)
                blockVerification = true
                let pending = Task { try await service.handle(self.request(action, action == "list" ? [:] : reading)) }
                await fulfillment(of: [entered], timeout: 2)
                pending.cancel()
                do { _ = try await pending.value; XCTFail("Cancelled request succeeded") } catch { }
                let result = try await service.handle(request("scan-changes", reading)).decode([String: JSONValue].self)
                let page = try XCTUnwrap(result["changesPage"]).decode([String: JSONValue].self)
                XCTAssertEqual(page["state"], .string("running"), "\(action), network cancellation: \(networkCancellation)")
                XCTAssertEqual(page["generation"], generation)
                // Actual authorization loss must still stop the independent producer.
                rejectIdentity = true
                await rejects { try await service.handle(self.request("list")) }
                let stopped = try await service.handle(request("scan-changes", reading)).decode([String: JSONValue].self)
                XCTAssertEqual(try stopped["changesPage"]?.decode([String: JSONValue].self)["state"], .string("interrupted"))
            }
        }
    }

    func testBackupDiagnosticsNeverExposeErrorDescriptionsOrURLs() {
        let sensitive = "secret-token /private/home/filename"
        let network = URLError(.timedOut, userInfo: [NSLocalizedDescriptionKey: sensitive, NSURLErrorFailingURLStringErrorKey: sensitive])
        XCTAssertEqual(MacFolderSync.backupDiagnosticCode(network), "network--1001")
        XCTAssertEqual(MacFolderSync.backupDiagnosticCode(ThingtimeAPIClientError.rejected(status: 429)), "identity-http-429")
        XCTAssertEqual(MacFolderSync.backupDiagnosticCode(ThingtimeAPIClientError.notPaired), "identity-not-paired")
        XCTAssertEqual(MacFolderSync.backupDiagnosticCode(MobileFolderStore.Failure.storage), "local-storage")
        XCTAssertEqual(MacFolderSync.backupDiagnosticCode(CancellationError()), "cancelled")
        XCTAssertEqual(MacFolderSync.backupDiagnosticCode(NSError(domain: sensitive, code: 1, userInfo: [NSLocalizedDescriptionKey: sensitive])), "unexpected")
    }

    private var folder: URL!
    override func setUpWithError() throws {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("mac-sync-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: folder.appendingPathComponent("selected"), withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: folder) }
    private func request(_ action: String, _ fields: [String: JSONValue] = [:], id: String = UUID().uuidString) -> JSONValue {
        .object(["action": .string(action), "requestId": .string(id), "ownerId": .string("owner"), "deviceId": .string("device"), "origin": .string(origin.absoluteString)].merging(fields) { _, next in next })
    }
    private func service(verify: @escaping (String, String) async throws -> Void = { owner, device in
        guard owner == "owner", device == "device" else { throw MobileFolderStore.Failure.unavailable }
    }, approve: @escaping (MobileFolderStore.Grant) async throws -> Bool = { _ in true }) throws -> MacFolderSync {
        var saved: [String: Data] = [:]
        let selected = folder.appendingPathComponent("selected")
        return try MacFolderSync(origin: origin, store: MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 }),
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: verify, choose: { selected }, approve: approve, chooseSource: { .folder(selected) },
            inventories: MobileFolderInventory(directory: folder.appendingPathComponent("inventories")))
    }
    private func root(_ service: MacFolderSync) async throws -> String {
        let result = try await service.handle(request("choose"))
        let data = try JSONEncoder().encode(result)
        let body = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let rows = try XCTUnwrap(body["roots"] as? [[String: Any]])
        XCTAssertEqual(Set(rows[0].keys), ["id", "name", "publicationVersion"])
        return try XCTUnwrap(rows.first?["id"] as? String)
    }
    private func rejects(_ work: () async throws -> JSONValue) async {
        do { _ = try await work(); XCTFail("Unauthorized request succeeded") } catch { }
    }
    private func backupFields(_ root: String, id: String = UUID().uuidString.lowercased()) -> [String: JSONValue] {
        ["rootId": .string(root), "inventoryDeviceId": .string("device"), "captureId": .string(id),
         "capturePolicy": .string("backup-supported"), "excludedPaths": .array([])]
    }
    private func awaitBackup(_ service: MacFolderSync, fields: [String: JSONValue]) async throws -> [String: JSONValue] {
        for _ in 0..<200 {
            let result = try await service.handle(request("scan-status", fields)).decode([String: JSONValue].self)
            let status = try XCTUnwrap(result["backupCapture"]).decode([String: JSONValue].self)
            if status["state"] != .string("running") { return result }
            try await Task.sleep(for: .milliseconds(5))
        }
        throw MobileFolderStore.Failure.unavailable
    }

    func testTransientVerificationClassificationExcludesAuthorityAndTrustFailures() {
        for error: Error in [URLError(.timedOut), URLError(.networkConnectionLost), URLError(.notConnectedToInternet),
                             ThingtimeAPIClientError.rejected(status: 408), ThingtimeAPIClientError.rejected(status: 429), ThingtimeAPIClientError.rejected(status: 503)] {
            XCTAssertTrue(MacFolderSync.identityVerificationIsTransient(error))
        }
        for error: Error in [CancellationError(), URLError(.cancelled), URLError(.serverCertificateUntrusted),
                             ThingtimeAPIClientError.notPaired, ThingtimeAPIClientError.rejected(status: 401),
                             ThingtimeAPIClientError.rejected(status: 403), ThingtimeAPIClientError.invalidResponse,
                             MobileFolderStore.Failure.unavailable] {
            XCTAssertFalse(MacFolderSync.identityVerificationIsTransient(error))
        }
    }

    func testTransientSealMonitorAndRequestFailuresPreserveGenerationButDiscloseNothingUntilFreshAuthorization() async throws {
        for failure: Error in [URLError(.timedOut), ThingtimeAPIClientError.rejected(status: 429), ThingtimeAPIClientError.rejected(status: 503)] {
            var saved: [String: Data] = [:], checks = 0, online = true, retrying = false, observedMonitor = false
            var retryGate: CheckedContinuation<Void, Never>?
            let waiting = expectation(description: "seal awaits fresh identity")
            let monitor = expectation(description: "monitor also survives unavailable identity")
            let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
            let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
            let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
            let service = try MacFolderSync(origin: origin, store: store,
                staging: MobileSyncStaging(directory: folder.appendingPathComponent(UUID().uuidString)),
                verify: { _, _ in
                    checks += 1
                    if checks == 3 { online = false }
                    if !online {
                        if retrying && !observedMonitor { observedMonitor = true; monitor.fulfill() }
                        throw failure
                    }
                }, choose: { nil }, approve: { _ in false },
                inventories: MobileFolderInventory(directory: folder.appendingPathComponent(UUID().uuidString)))
            service.backupMonitorInterval = .milliseconds(20)
            service.backupRetrySleep = { duration in
                XCTAssertEqual(duration, .seconds(5)); retrying = true
                await withCheckedContinuation { retryGate = $0; waiting.fulfill() }
            }
            defer { retryGate?.resume(); service.suspend() }
            let fields = backupFields(grant.id)
            let begin = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
            let generation = try XCTUnwrap(begin["backupCapture"]).decode([String: JSONValue].self)["generation"]
            await fulfillment(of: [waiting, monitor], timeout: 3)
            // A failed polling/read request must neither return local data nor
            // cancel the scanner's private, unsealed capture.
            await rejects { try await service.handle(self.request("scan-status", fields)) }
            await rejects { try await service.handle(self.request("inspect", ["rootId": .string(grant.id), "path": .string("private")])) }
            online = true; retryGate?.resume(); retryGate = nil
            let complete = try await awaitBackup(service, fields: fields)
            let status = try XCTUnwrap(complete["backupCapture"]).decode([String: JSONValue].self)
            XCTAssertEqual(status["state"], .string("complete")); XCTAssertEqual(status["generation"], generation)
            XCTAssertGreaterThan(checks, 5)
        }
    }

    func testSealRetryStopsOnCancellationRevocationGrantLossAndLifetime() async throws {
        for stop in ["cancel", "unpair", "forbidden", "grant", "lifetime"] {
            var saved: [String: Data] = [:], checks = 0, terminal = false, current = Date()
            let checked = expectation(description: "private preparation waits")
            let stopped = expectation(description: "retry finishes")
            let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
            let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
            let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
            var retryGate: CheckedContinuation<Void, Never>?
            let inventories = MobileFolderInventory(directory: folder.appendingPathComponent(UUID().uuidString))
            let service = try MacFolderSync(origin: origin, store: store,
                staging: MobileSyncStaging(directory: folder.appendingPathComponent(UUID().uuidString)),
                verify: { _, _ in
                    checks += 1
                    if terminal { throw stop == "forbidden" ? ThingtimeAPIClientError.rejected(status: 403) : ThingtimeAPIClientError.notPaired }
                    if checks >= 3 { throw URLError(.timedOut) }
                }, choose: { nil }, approve: { _ in false }, inventories: inventories)
            service.backupNow = { current }
            service.backupRetrySleep = { _ in
                await withCheckedContinuation { retryGate = $0; checked.fulfill() }
                defer { stopped.fulfill() }
                try Task.checkCancellation()
            }
            let fields = backupFields(grant.id)
            _ = try await service.handle(request("scan-capture", fields))
            await fulfillment(of: [checked], timeout: 3)
            if stop == "cancel" { service.suspend() }
            if stop == "unpair" || stop == "forbidden" { terminal = true }
            if stop == "grant" { try store.remove(owner, id: grant.id) }
            if stop == "lifetime" { current = current.addingTimeInterval(MacFolderSync.maximumBackupJobSeconds) }
            retryGate?.resume(); retryGate = nil
            await fulfillment(of: [stopped], timeout: 3)
            // Let the scanner's actor task perform abandonment after the retry.
            for _ in 0..<20 { await Task.yield() }
            let id = try XCTUnwrap(fields["captureId"]).decode(String.self)
            let scope = MobileFolderInventory.Scope(owner: owner, deviceId: "device", rootId: grant.id)
            let status = try await Task.detached { try inventories.backupStatus(scope, id: id, bookmark: grant.bookmark) }.value
            XCTAssertEqual(status?.state, "interrupted")
            XCTAssertLessThanOrEqual(checks, 4, "A terminal authority failure must not retry")
            service.suspend()
        }
    }

    func testCancellationInterruptsActualSealRetrySleep() async throws {
        var checks = 0, allow = false, saved: [String: Data] = [:]
        let sleeping = expectation(description: "actual retry sleep")
        let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
        let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
        let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
        let service = try MacFolderSync(origin: origin, store: store,
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: { _, _ in checks += 1; if checks >= 3 && !allow { throw URLError(.timedOut) } },
            choose: { nil }, approve: { _ in false }, inventories: MobileFolderInventory(directory: folder.appendingPathComponent("inventories")))
        let fields = backupFields(grant.id)
        service.backupRetrySleep = { duration in sleeping.fulfill(); try await Task.sleep(for: duration) }
        _ = try await service.handle(request("scan-capture", fields))
        await fulfillment(of: [sleeping], timeout: 3)
        service.suspend()
        // Suspending the whole service cancels both monitor and retry sleep;
        // unlike polling transport cancellation, this ends the native job.
        for _ in 0..<20 { await Task.yield() }
        allow = true
        let result = try await awaitBackup(service, fields: fields)
        XCTAssertEqual(try XCTUnwrap(result["backupCapture"]).decode([String: JSONValue].self)["state"], .string("interrupted"))
    }

    func testPollingCancellationDuringNetworkVerificationDoesNotCancelPrivateBackup() async throws {
        var saved: [String: Data] = [:], checks = 0, cancelPolling = false
        var sealGate: CheckedContinuation<Void, Never>?
        let sealing = expectation(description: "seal authorization pending")
        let polling = expectation(description: "polling verification in flight")
        let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
        let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
        let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
        let service = try MacFolderSync(origin: origin, store: store,
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: { _, _ in
                checks += 1
                if checks == 3 { await withCheckedContinuation { sealGate = $0; sealing.fulfill() } }
                else if cancelPolling {
                    polling.fulfill()
                    do { try await Task.sleep(for: .seconds(60)) }
                    catch { throw URLError(.cancelled) } // URLSession's cancellation shape.
                }
            }, choose: { nil }, approve: { _ in false },
            inventories: MobileFolderInventory(directory: folder.appendingPathComponent("inventories")))
        defer { sealGate?.resume(); service.suspend() }
        let fields = backupFields(grant.id)
        _ = try await service.handle(request("scan-capture", fields))
        await fulfillment(of: [sealing], timeout: 3)
        cancelPolling = true
        let read = Task { try await service.handle(request("scan-status", fields)) }
        await fulfillment(of: [polling], timeout: 3)
        read.cancel(); await rejects { try await read.value }
        cancelPolling = false; sealGate?.resume(); sealGate = nil
        let complete = try await awaitBackup(service, fields: fields)
        XCTAssertEqual(complete["complete"], .bool(true))
    }

    func testSealRetryBackoffCapsAtOneMinuteAndEndsAtJobLifetime() async throws {
        var saved: [String: Data] = [:], checks = 0, allow = false, current = Date(), delays: [Duration] = []
        let expired = expectation(description: "retry budget expired")
        let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
        let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
        let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
        let service = try MacFolderSync(origin: origin, store: store,
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: { _, _ in checks += 1; if checks >= 3 && !allow { throw ThingtimeAPIClientError.rejected(status: 503) } },
            choose: { nil }, approve: { _ in false }, inventories: MobileFolderInventory(directory: folder.appendingPathComponent("inventories")))
        service.backupNow = { current }
        service.backupRetrySleep = { delay in
            delays.append(delay)
            if delays.count == 7 { current = current.addingTimeInterval(MacFolderSync.maximumBackupJobSeconds); expired.fulfill() }
        }
        let fields = backupFields(grant.id)
        _ = try await service.handle(request("scan-capture", fields))
        await fulfillment(of: [expired], timeout: 3)
        allow = true
        let result = try await awaitBackup(service, fields: fields)
        XCTAssertEqual(delays, [5, 10, 20, 40, 60, 60, 60].map { .seconds($0) })
        XCTAssertEqual(try XCTUnwrap(result["backupCapture"]).decode([String: JSONValue].self)["state"], .string("interrupted"))
        service.suspend()
    }
    func testIgnoreRulesAreEchoedPrunedAndBoundAcrossBackupLifecycle() async throws {
        let selected = folder.appendingPathComponent("selected")
        try FileManager.default.createDirectory(at: selected.appendingPathComponent("node_modules"), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: selected.appendingPathComponent("node_modules/blocked"), withDestinationURL: selected.appendingPathComponent("missing"))
        try Data().write(to: selected.appendingPathComponent("kept"))
        let service = try service(), id = try await root(service)
        let rules = "# Explicit sync policy\r\nnode_modules/\r\n"
        let fields = backupFields(id).merging(["ignoreRules": .string(rules)]) { _, v in v }
        let begin = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(begin["ignoreRules"], .string(rules))
        let completed = try await awaitBackup(service, fields: fields)
        XCTAssertEqual(completed["ignoreRules"], .string(rules))
        let status = try XCTUnwrap(completed["backupCapture"]).decode([String: JSONValue].self)
        XCTAssertEqual(status["coverage"], .string("full")); XCTAssertEqual(status["totalSkipped"], .number(0))
        XCTAssertEqual(status["ignoredCount"], .number(1))
        let descriptor = status.filter { ["id", "generation", "totalEntries", "coverage", "consistency", "totalSkipped"].contains($0.key) }
        let pageFields: [String: JSONValue] = ["rootId": .string(id), "inventoryDeviceId": .string("device"),
            "capturePolicy": .string("backup-supported"), "capture": .object(descriptor), "offset": .number(0), "ignoreRules": .string(rules)]
        let page = try await service.handle(request("scan-page", pageFields)).decode([String: JSONValue].self)
        XCTAssertEqual(page["ignoreRules"], .string(rules))
        XCTAssertEqual(try XCTUnwrap(page["inventoryPage"]).decode(MobileFolderInventory.Page.self).entries.map(\.path), ["kept"])
        let skipped = try await service.handle(request("scan-skips", pageFields)).decode([String: JSONValue].self)
        XCTAssertEqual(skipped["ignoreRules"], .string(rules))
        await rejects { try await service.handle(self.request("scan-page", pageFields.filter { $0.key != "ignoreRules" })) }
        await rejects { try await service.handle(self.request("scan-status", fields.merging(["ignoreRules": .string(rules + "kept")]) { _, v in v })) }
        await rejects { try await service.handle(self.request("scan-capture", fields.merging(["ignoreRules": .string(rules + "kept")]) { _, v in v })) }
        let strict = try await service.handle(request("scan", ["rootId": .string(id), "ignoreRules": .string(rules)])).decode([String: JSONValue].self)
        XCTAssertEqual(strict["ignoreRules"], .string(rules))
        XCTAssertEqual(try XCTUnwrap(strict["entries"]).decode([MobileFolderReader.Entry].self).map(\.path), ["kept"])
        let discarded = try await service.handle(request("scan-discard", pageFields)).decode([String: JSONValue].self)
        XCTAssertEqual(discarded["ignoreRules"], .string(rules))
        for invalid: JSONValue in [.null, .number(1), .string("\0")] {
            await rejects { try await service.handle(self.request("scan", ["rootId": .string(id), "ignoreRules": invalid])) }
        }
        let empty = try await service.handle(request("scan", ["rootId": .string(id), "excludedPaths": .array([.string("node_modules")]), "ignoreRules": .string("")])).decode([String: JSONValue].self)
        XCTAssertNil(empty["ignoreRules"])
        let largerRules = String(repeating: "#", count: 16_385)
        let larger = try await service.handle(request("scan", ["rootId": .string(id), "excludedPaths": .array([.string("node_modules")]), "ignoreRules": .string(largerRules)])).decode([String: JSONValue].self)
        XCTAssertEqual(larger["ignoreRules"], .string(largerRules))
    }

    func testBackupLifecycleReturnsQuicklySealsCoverageAndReusesLostReply() async throws {
        let selected = folder.appendingPathComponent("selected")
        try Data("kept".utf8).write(to: selected.appendingPathComponent("kept"))
        try FileManager.default.createSymbolicLink(at: selected.appendingPathComponent("link"), withDestinationURL: selected.appendingPathComponent("absent"))
        let service = try service(), rootId = try await root(service), fields = backupFields(rootId)
        let begin = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(begin["capturePolicy"], .string("backup-supported")); XCTAssertEqual(begin["complete"], .bool(false))
        let started = try XCTUnwrap(begin["backupCapture"]).decode([String: JSONValue].self)
        XCTAssertEqual(started["state"], .string("running")); XCTAssertEqual(started["coverage"], .string("partial"))
        let duplicate = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(duplicate["backupCapture"]).decode([String: JSONValue].self)["generation"], started["generation"])
        let completed = try await awaitBackup(service, fields: fields)
        XCTAssertEqual(completed["complete"], .bool(true)); XCTAssertEqual(completed["excludedPaths"], .array([]))
        var descriptor = try XCTUnwrap(completed["backupCapture"]).decode([String: JSONValue].self)
        XCTAssertEqual(descriptor.removeValue(forKey: "state"), .string("complete"))
        XCTAssertEqual(descriptor["coverage"], .string("partial")); XCTAssertEqual(descriptor["totalSkipped"], .number(1))
        let capture = JSONValue.object(descriptor)
        let pageFields: [String: JSONValue] = ["rootId": .string(rootId), "inventoryDeviceId": .string("device"),
            "capturePolicy": .string("backup-supported"), "capture": capture, "offset": .number(0)]
        let page = try await service.handle(request("scan-page", pageFields)).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(page["inventoryPage"]).decode(MobileFolderInventory.Page.self).entries.map(\.path), ["kept"])
        let skipped = try await service.handle(request("scan-skips", pageFields)).decode([String: JSONValue].self)
        let skippedBody = try XCTUnwrap(skipped["skippedPage"]).decode([String: JSONValue].self)
        XCTAssertEqual(skippedBody["totalSkipped"], .number(1))
        let gaps = try XCTUnwrap(skippedBody["skipped"]).decode([MobileFolderInventory.Skipped].self)
        XCTAssertEqual(gaps[0].path, "link"); XCTAssertEqual(gaps[0].reason, .symlink)
        // A renderer reconnect can retrieve the sealed durable generation.
        let repeated = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(repeated["backupCapture"], completed["backupCapture"])
        await rejects { try await service.handle(self.request("scan-page", pageFields.merging(["capturePolicy": .null]) { _, v in v })) }
        let stripped = descriptor.filter { ["id", "generation", "totalEntries"].contains($0.key) }
        await rejects { try await service.handle(self.request("scan-page", pageFields.merging(["capture": .object(stripped)]) { _, v in v })) }
    }

    func testBackupExplicitCancellationIsDistinctFromTransportRequestCancellation() async throws {
        let selected = folder.appendingPathComponent("selected")
        // Enough metadata work to leave a live job, without allocating file data.
        for i in 0..<800 { try Data().write(to: selected.appendingPathComponent("file-\(i)")) }
        let service = try service(), rootId = try await root(service), fields = backupFields(rootId)
        let started = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        let generation = try XCTUnwrap(started["backupCapture"]).decode([String: JSONValue].self)["generation"]
        let polling = Task { try await service.handle(request("scan-status", fields)) }
        polling.cancel()
        await rejects { try await polling.value }
        let stillOwned = try await service.handle(request("scan-status", fields)).decode([String: JSONValue].self)
        let retained = try XCTUnwrap(stillOwned["backupCapture"]).decode([String: JSONValue].self)
        XCTAssertEqual(retained["generation"], generation); XCTAssertNotEqual(retained["state"], .string("interrupted"))
        let cancel = try await service.handle(request("scan-cancel", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(cancel["cancelled"], .bool(true)); XCTAssertEqual(cancel["complete"], .bool(false))
        let status = try await service.handle(request("scan-status", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(status["backupCapture"]).decode([String: JSONValue].self)["state"], .string("interrupted"))
        let restarted = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        let renewed = try XCTUnwrap(restarted["backupCapture"]).decode([String: JSONValue].self)
        XCTAssertEqual(renewed["state"], .string("running"))
        _ = try await service.handle(request("scan-cancel", fields))
    }

    func testScopedSuspendCancelsActiveRequestWithoutCancellingBackupJob() async throws {
        var saved: [String: Data] = [:], checks = 0
        var backupGate: CheckedContinuation<Void, Never>?
        var pickerGate: CheckedContinuation<URL?, Never>?
        let prepared = expectation(description: "backup waits at final authorization")
        let pickerStarted = expectation(description: "scoped request opens picker")
        let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
        let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
        let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
        let service = try MacFolderSync(origin: origin, store: store,
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: { _, _ in
                checks += 1
                if checks == 3 {
                    await withCheckedContinuation { backupGate = $0; prepared.fulfill() }
                }
            }, choose: {
                await withCheckedContinuation { pickerGate = $0; pickerStarted.fulfill() }
            }, approve: { _ in true },
            inventories: MobileFolderInventory(directory: folder.appendingPathComponent("inventories")),
            cancelDialog: { pickerGate?.resume(returning: nil); pickerGate = nil })
        defer { backupGate?.resume(); pickerGate?.resume(returning: nil); service.suspend() }
        let fields = backupFields(grant.id)
        let begin = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        let generation = try XCTUnwrap(begin["backupCapture"]).decode([String: JSONValue].self)["generation"]
        await fulfillment(of: [prepared], timeout: 3)
        let requestId = UUID().uuidString
        let pending = Task { try await service.handle(request("choose", id: requestId)) }
        await fulfillment(of: [pickerStarted], timeout: 3)
        // This is the desktop transport's timeout message, with the active
        // request's identity, rather than cancellation of a Swift caller task.
        _ = try await service.handle(request("suspend", id: requestId))
        await rejects { try await pending.value }
        XCTAssertNil(pickerGate)
        backupGate?.resume(); backupGate = nil
        let completed = try await awaitBackup(service, fields: fields)
        let status = try XCTUnwrap(completed["backupCapture"]).decode([String: JSONValue].self)
        XCTAssertEqual(status["generation"], generation)
        XCTAssertEqual(status["state"], .string("complete"))
        XCTAssertEqual(completed["complete"], .bool(true))
    }

    func testBackupCancellationOfEvictedCaptureIsIdempotentAndRemainsScoped() async throws {
        let service = try service(), id = try await root(service), fields = backupFields(id)
        for _ in 0..<2 {
            let result = try await service.handle(request("scan-cancel", fields)).decode([String: JSONValue].self)
            XCTAssertEqual(result["cancelled"], .bool(true)); XCTAssertEqual(result["complete"], .bool(false))
            XCTAssertEqual(result["captureId"], fields["captureId"])
            XCTAssertNil(result["capture"]); XCTAssertNil(result["backupCapture"])
        }
        for patch: [String: JSONValue] in [
            ["ownerId": .string("foreign")], ["deviceId": .string("foreign")],
            ["rootId": .string(UUID().uuidString)], ["captureId": .string("invalid")]
        ] {
            await rejects { try await service.handle(self.request("scan-cancel", fields.merging(patch) { _, v in v })) }
        }
        // An existing generation must still reject a caller's changed policy.
        let withRules = fields.merging(["ignoreRules": .string("node_modules/")]) { _, v in v }
        _ = try await service.handle(request("scan-capture", withRules))
        _ = try await awaitBackup(service, fields: withRules)
        await rejects { try await service.handle(self.request("scan-cancel", fields)) }
        let cancelled = try await service.handle(request("scan-cancel", withRules)).decode([String: JSONValue].self)
        XCTAssertEqual(cancelled["cancelled"], .bool(true))
    }

    func testBackupRechecksAuthorityBeforeSealAfterPrivatePreparation() async throws {
        for revokeGrant in [false, true] {
            var saved: [String: Data] = [:], calls = 0
            let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
            let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
            let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
            let inventories = MobileFolderInventory(directory: folder.appendingPathComponent(UUID().uuidString))
            let checked = expectation(description: "post-preparation identity check")
            let service = try MacFolderSync(origin: origin, store: store,
                staging: MobileSyncStaging(directory: folder.appendingPathComponent(UUID().uuidString)),
                verify: { _, _ in
                    calls += 1
                    if calls == 3 {
                        checked.fulfill()
                        if revokeGrant { try store.remove(owner, id: grant.id) }
                        else { throw MobileFolderStore.Failure.unavailable }
                    }
                }, choose: { nil }, approve: { _ in false }, inventories: inventories)
            let fields = backupFields(grant.id)
            _ = try await service.handle(request("scan-capture", fields))
            await fulfillment(of: [checked], timeout: 3)
            let id = try XCTUnwrap(fields["captureId"]).decode(String.self)
            let scope = MobileFolderInventory.Scope(owner: owner, deviceId: "device", rootId: grant.id)
            let status = try await Task.detached { try inventories.backupStatus(scope, id: id, bookmark: grant.bookmark) }.value
            XCTAssertEqual(status?.state, "interrupted")
            service.suspend()
        }
    }

    func testBackupOwnerOrRootRevocationCannotSealOrDisclose() async throws {
        for revoked in ["identity", "grant"] {
            var saved: [String: Data] = [:], allow = true
            let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
            let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
            let selected = folder.appendingPathComponent("selected")
            let grant = try store.add(owner, selected: selected)
            let service = try MacFolderSync(origin: origin, store: store,
                staging: MobileSyncStaging(directory: folder.appendingPathComponent(UUID().uuidString)),
                verify: { _, _ in if !allow { throw MobileFolderStore.Failure.unavailable } }, choose: { nil }, approve: { _ in false },
                inventories: MobileFolderInventory(directory: folder.appendingPathComponent(UUID().uuidString)))
            let fields = backupFields(grant.id)
            _ = try await service.handle(request("scan-capture", fields))
            if revoked == "identity" { allow = false } else { try store.remove(owner, id: grant.id) }
            await rejects { try await service.handle(self.request("scan-status", fields)) }
            service.suspend()
        }
    }

    func testBatchPageSizeIsValidatedAndRetainsBothLiveOwnerChecks() async throws {
        var checks = 0, denyAt = Int.max
        let service = try service(verify: { owner, device in
            checks += 1
            guard owner == "owner", device == "device", checks != denyAt else { throw MobileFolderStore.Failure.unavailable }
        })
        let id = try await root(service)
        for i in 0..<600 { try Data().write(to: folder.appendingPathComponent("selected/file-\(i)")) }
        let fields: [String: JSONValue] = ["rootId": .string(id), "inventoryDeviceId": .string("device"), "captureId": .string(UUID().uuidString.lowercased())]
        let captured = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        let pageFields = fields.merging(["capture": try XCTUnwrap(captured["capture"]), "offset": .number(0), "pageSize": .number(512)]) { _, v in v }
        checks = 0
        let result = try await service.handle(request("scan-page", pageFields)).decode([String: JSONValue].self)
        let page = try XCTUnwrap(result["inventoryPage"]).decode(MobileFolderInventory.Page.self)
        XCTAssertEqual(page.entries.count, 512); XCTAssertEqual(page.nextOffset, 512); XCTAssertEqual(checks, 2)
        for boundary in [1, 2] {
            checks = 0; denyAt = boundary
            await rejects { try await service.handle(self.request("scan-page", pageFields)) }
            XCTAssertEqual(checks, boundary)
        }
        denyAt = Int.max
        for i in 0..<600 {
            try FileManager.default.createSymbolicLink(at: folder.appendingPathComponent("selected/link-\(i)"),
                withDestinationURL: folder.appendingPathComponent("missing"))
        }
        let backup = backupFields(id)
        _ = try await service.handle(request("scan-capture", backup))
        let sealed = try await awaitBackup(service, fields: backup)
        var descriptor = try XCTUnwrap(sealed["backupCapture"]).decode([String: JSONValue].self)
        XCTAssertEqual(descriptor.removeValue(forKey: "state"), .string("complete"))
        let skippedFields = backup.filter { $0.key != "excludedPaths" }.merging(["capture": .object(descriptor), "offset": .number(0), "pageSize": .number(512)]) { _, v in v }
        checks = 0
        let skippedResult = try await service.handle(request("scan-skips", skippedFields)).decode([String: JSONValue].self)
        let skipped = try XCTUnwrap(skippedResult["skippedPage"]).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(skipped["skipped"]).decode([MobileFolderInventory.Skipped].self).count, 512)
        XCTAssertEqual(skipped["nextOffset"], .number(512)); XCTAssertEqual(checks, 2)
        for boundary in [1, 2] {
            checks = 0; denyAt = boundary
            await rejects { try await service.handle(self.request("scan-skips", skippedFields)) }
            XCTAssertEqual(checks, boundary)
        }
        denyAt = Int.max
        await rejects { try await service.handle(self.request("scan-page", pageFields.merging(["ownerId": .string("foreign")]) { _, v in v })) }
        await rejects { try await service.handle(self.request("scan-page", pageFields.merging(["deviceId": .string("foreign")]) { _, v in v })) }
        for invalid: JSONValue in [.null, .bool(true), .number(-1), .number(0), .number(4097), .number(1.5), .string("512")] {
            await rejects { try await service.handle(self.request("scan-page", pageFields.merging(["pageSize": invalid]) { _, v in v })) }
            await rejects { try await service.handle(self.request("scan-skips", ["pageSize": invalid, "capturePolicy": .string("backup-supported")])) }
        }
        for action in ["context", "list", "choose", "scan", "scan-capture", "scan-status", "scan-cancel", "scan-discard", "inspect"] {
            await rejects { try await service.handle(self.request(action, ["pageSize": .number(512)])) }
        }
    }

    func testNativeScansPruneAndEchoExclusionsAndBindCaptureReuse() async throws {
        let service = try service(), id = try await root(service)
        let selected = folder.appendingPathComponent("selected")
        try FileManager.default.createDirectory(at: selected.appendingPathComponent("Library"), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: selected.appendingPathComponent("Library/blocked"),
            withDestinationURL: selected.appendingPathComponent("missing"))
        try Data().write(to: selected.appendingPathComponent("kept"))
        let fields: [String: JSONValue] = ["rootId": .string(id), "excludedPaths": .array([.string("library")])]
        let scan = try await service.handle(request("scan", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(scan["excludedPaths"], fields["excludedPaths"])
        XCTAssertEqual(try XCTUnwrap(scan["entries"]).decode([MobileFolderReader.Entry].self).map(\.path), ["kept"])
        let captureFields = fields.merging(["inventoryDeviceId": .string("device"), "captureId": .string(UUID().uuidString.lowercased())]) { _, v in v }
        let captured = try await service.handle(request("scan-capture", captureFields)).decode([String: JSONValue].self)
        XCTAssertEqual(captured["excludedPaths"], fields["excludedPaths"])
        XCTAssertEqual(try XCTUnwrap(captured["capture"]).decode(MobileFolderInventory.Capture.self).totalEntries, 1)
        await rejects { try await service.handle(self.request("scan-capture", captureFields.merging(["excludedPaths": .array([])]) { _, v in v })) }
        let failed = try await service.handle(request("scan", ["rootId": .string(id)])).decode([String: JSONValue].self)
        XCTAssertEqual(failed["complete"], .bool(false)); XCTAssertNil(failed["entries"])
        XCTAssertEqual(failed["scanFailure"], .object(["reason": .string("symlink"), "path": .string("Library/blocked")]))
        await rejects { try await service.handle(self.request("scan", fields.merging(["excludedPaths": .array([.string("../escape")])]) { _, v in v })) }
        await rejects { try await service.handle(self.request("scan", fields.merging(["excludedPaths": .null]) { _, v in v })) }
    }


    func testScanFailureIsIdentityBoundAndReauthorizesOwnerAndGrant() async throws {
        let selected = folder.appendingPathComponent("selected")
        try FileManager.default.createSymbolicLink(at: selected.appendingPathComponent("blocked"), withDestinationURL: selected.appendingPathComponent("missing"))
        for action in ["scan", "scan-capture"] {
            for revoked in ["none", "identity", "grant"] {
                var saved: [String: Data] = [:], calls = 0
                let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
                let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
                let grant = try store.add(owner, selected: selected)
                let service = try MacFolderSync(origin: origin, store: store,
                    staging: MobileSyncStaging(directory: folder.appendingPathComponent(UUID().uuidString)),
                    verify: { _, _ in
                        calls += 1
                        if calls == 2 {
                            if revoked == "identity" { throw MobileFolderStore.Failure.unavailable }
                            if revoked == "grant" { try store.remove(owner, id: grant.id) }
                        }
                    }, choose: { nil }, approve: { _ in false },
                    inventories: MobileFolderInventory(directory: folder.appendingPathComponent(UUID().uuidString)))
                let requestId = UUID().uuidString
                let fields: [String: JSONValue] = ["rootId": .string(grant.id), "inventoryDeviceId": .string("device"), "captureId": .string(UUID().uuidString.lowercased())]
                if revoked != "none" {
                    await rejects { try await service.handle(self.request(action, fields, id: requestId)) }
                } else {
                    let result = try await service.handle(request(action, fields, id: requestId)).decode([String: JSONValue].self)
                    XCTAssertEqual(result["requestId"], .string(requestId)); XCTAssertEqual(result["ownerId"], .string("owner"))
                    XCTAssertEqual(result["rootId"], .string(grant.id)); XCTAssertEqual(result["complete"], .bool(false))
                    XCTAssertEqual(result["scanFailure"], .object(["reason": .string("symlink"), "path": .string("blocked")]))
                    for key in ["entries", "capture", "inventoryPage"] { XCTAssertNil(result[key]) }
                }
                XCTAssertEqual(calls, 2)
            }
        }
    }

    func testContextAndUnknownConditionsUseTheSharedFolderContract() async throws {
        let service = try service()
        let context = try await service.handle(request("context")).decode([String: JSONValue].self)
        XCTAssertEqual(context["deviceId"], .string("device"))
        let capabilities = try XCTUnwrap(context["capabilities"]).decode([String: String].self)
        XCTAssertEqual(capabilities, ["fileAccessVersion": "1.11.0", "fileStagingVersion": "1.1.0", "filePublicationVersion": "1.2.0"])
        let result = try await service.handle(request("conditions")).decode([String: JSONValue].self)
        XCTAssertEqual(result["conditions"], .object(["network": .string("unknown"), "charging": .null]))
    }

    func testSavedWriteApprovalCheckNeverPromptsAndSurvivesAdapterRestart() async throws {
        var saved: [String: Data] = [:], prompts = 0, writes = 0
        let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1; writes += 1 })
        let selected = folder.appendingPathComponent("selected")
        func makeService() throws -> MacFolderSync {
            try MacFolderSync(origin: origin, store: store,
                staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
                verify: { owner, device in
                    guard owner == "owner", device == "device" else { throw MobileFolderStore.Failure.unavailable }
                }, choose: { selected }, approve: { _ in prompts += 1; return true })
        }
        let service = try makeService(), id = try await root(service)
        let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
        let approval = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: String(repeating: "a", count: 64))
        let fields: [String: JSONValue] = ["rootId": .string(id), "approval": try .from(approval)]
        let before = writes
        await rejects { try await service.handle(self.request("write-check", fields)) }
        XCTAssertEqual(prompts, 0); XCTAssertEqual(writes, before)
        _ = try await service.handle(request("write-approve", fields))
        XCTAssertEqual(prompts, 1)
        let approvedWrites = writes, restarted = try makeService()
        let result = try await restarted.handle(request("write-check", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(result["writeApproval"], try .from(approval))
        for replacement in [
            MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "2", configurationHash: approval.configurationHash),
            MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: String(repeating: "b", count: 64)),
            MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: approval.configurationHash, allowTrash: true)
        ] {
            await rejects { try await restarted.handle(self.request("write-check", ["rootId": .string(id), "approval": try .from(replacement)])) }
        }
        for patch: [String: JSONValue] in [["ownerId": .string("other")], ["deviceId": .string("other")], ["origin": .string("https://other.test")]] {
            await rejects { try await restarted.handle(self.request("write-check", fields.merging(patch) { _, v in v })) }
        }
        XCTAssertEqual(prompts, 1); XCTAssertEqual(writes, approvedWrites)
        _ = try await restarted.handle(request("remove", ["rootId": .string(id)]))
        await rejects { try await restarted.handle(self.request("write-check", fields)) }
        XCTAssertEqual(prompts, 1)
    }

    func testApprovalRepliesRejectRevocationDuringFinalIdentityVerification() async throws {
        for action in ["write-check", "write-approve"] {
            for revoked in ["identity", "grant", "approval"] {
                var saved: [String: Data] = [:], calls = 0, prompts = 0
                let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
                let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
                let grant = try store.add(owner, selected: folder.appendingPathComponent("selected"))
                let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
                let approval = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: String(repeating: "a", count: 64))
                try store.approveWrite(owner, grant: grant, approval: approval)
                let service = try MacFolderSync(origin: origin, store: store,
                    staging: MobileSyncStaging(directory: folder.appendingPathComponent(UUID().uuidString)),
                    verify: { _, _ in
                        calls += 1
                        if calls == 2 {
                            if revoked == "identity" { throw MobileFolderStore.Failure.unavailable }
                            if revoked == "grant" { try store.remove(owner, id: grant.id) }
                            if revoked == "approval" {
                                try store.approveWrite(owner, grant: grant, approval: .init(scope: scope, configurationRevision: "2", configurationHash: approval.configurationHash))
                            }
                        }
                    }, choose: { nil }, approve: { _ in prompts += 1; return true })
                await rejects { try await service.handle(self.request(action, ["rootId": .string(grant.id), "approval": try .from(approval)])) }
                XCTAssertEqual(calls, 2); XCTAssertEqual(prompts, 0)
            }
        }
    }

    func testInventoryCapturePagesAreScopedImmutableAndDiscardable() async throws {
        let service = try service(), id = try await root(service)
        let source = folder.appendingPathComponent("selected")
        for i in 0..<129 { try Data().write(to: source.appendingPathComponent("file-\(i)")) }
        let fields: [String: JSONValue] = ["rootId": .string(id), "inventoryDeviceId": .string("device")]
        let captureID = UUID().uuidString.lowercased()
        let begin = request("scan-capture", fields.merging(["captureId": .string(captureID)]) { _, v in v })
        let first = try await service.handle(begin).decode([String: JSONValue].self)
        let capture = try XCTUnwrap(first["capture"])
        XCTAssertEqual(try capture.decode(MobileFolderInventory.Capture.self).totalEntries, 129)
        let repeated = try await service.handle(begin).decode([String: JSONValue].self)
        XCTAssertEqual(repeated["capture"], capture)
        try Data("later".utf8).write(to: source.appendingPathComponent("file-0"))
        let pageFields = fields.merging(["capture": capture, "offset": .number(0)]) { _, v in v }
        let firstPage = try await service.handle(request("scan-page", pageFields)).decode([String: JSONValue].self)
        let page = try XCTUnwrap(firstPage["inventoryPage"]).decode(MobileFolderInventory.Page.self)
        XCTAssertEqual(page.entries.count, 128); XCTAssertEqual(page.nextOffset, 128)
        XCTAssertTrue(page.entries.allSatisfy { $0.size == 0 })
        let last = try await service.handle(request("scan-page", pageFields.merging(["offset": .number(128)]) { _, v in v })).decode([String: JSONValue].self)
        let lastPage = try XCTUnwrap(last["inventoryPage"]).decode(MobileFolderInventory.Page.self)
        XCTAssertEqual(lastPage.entries.count, 1); XCTAssertNil(lastPage.nextOffset)
        for patch: [String: JSONValue] in [["inventoryDeviceId": .string("other")], ["rootId": .string(UUID().uuidString)], ["offset": .number(-1)]] {
            await rejects { try await service.handle(self.request("scan-page", pageFields.merging(patch) { _, v in v })) }
        }
        _ = try await service.handle(request("scan-discard", pageFields))
        await rejects { try await service.handle(self.request("scan-page", pageFields)) }
        XCTAssertEqual(try Data(contentsOf: source.appendingPathComponent("file-0")), Data("later".utf8))
    }

    func testInventoryReauthorizesEveryCaptureAndPageBeforeReply() async throws {
        var calls = 0, refuse = false
        let service = try service(verify: { _, _ in
            calls += 1
            if refuse && calls == 2 { throw MobileFolderStore.Failure.unavailable }
        })
        let id = try await root(service), captureID = UUID().uuidString.lowercased()
        let fields: [String: JSONValue] = ["rootId": .string(id), "inventoryDeviceId": .string("device"), "captureId": .string(captureID)]
        calls = 0; refuse = true
        await rejects { try await service.handle(self.request("scan-capture", fields)) }
        XCTAssertEqual(calls, 2)
        calls = 0; refuse = false
        let result = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        let capture = try XCTUnwrap(result["capture"])
        calls = 0; refuse = true
        await rejects { try await service.handle(self.request("scan-page", fields.merging(["capture": capture, "offset": .number(0)]) { _, v in v })) }
        XCTAssertEqual(calls, 2)
    }

    func testSinglePathInspectionIsScopedAndReauthorizesBeforeReply() async throws {
        var allowed = true, calls = 0
        let service = try service(verify: { owner, device in
            calls += 1
            guard allowed, owner == "owner", device == "device" else { throw MobileFolderStore.Failure.unavailable }
        })
        let id = try await root(service)
        try Data("real native bytes".utf8).write(to: folder.appendingPathComponent("selected/file.bin"))
        let fields: [String: JSONValue] = ["rootId": .string(id), "path": .string("file.bin")]
        calls = 0
        let result = try await service.handle(request("inspect", fields)).decode([String: JSONValue].self)
        let entry = try XCTUnwrap(result["entry"]).decode(MobileFolderReader.Entry.self)
        XCTAssertEqual(entry.path, "file.bin"); XCTAssertEqual(entry.size, 17); XCTAssertEqual(calls, 2)
        XCTAssertEqual(result["complete"], .bool(true)); XCTAssertNil(result["entries"])
        let missing = try await service.handle(request("inspect", ["rootId": .string(id), "path": .string("missing")])).decode([String: JSONValue].self)
        XCTAssertEqual(missing["entry"], .null)
        for path in ["../outside", "/outside"] {
            await rejects { try await service.handle(self.request("inspect", ["rootId": .string(id), "path": .string(path)])) }
        }
        allowed = false
        await rejects { try await service.handle(self.request("inspect", fields)) }
    }

    func testInspectionRejectsIdentityOrGrantRevokedBeforeReply() async throws {
        for revokeGrant in [false, true] {
            var saved: [String: Data] = [:], calls = 0
            var revoke = false, id = ""
            let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
            let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
            let selected = folder.appendingPathComponent("selected")
            let service = try MacFolderSync(origin: origin, store: store,
                staging: MobileSyncStaging(directory: folder.appendingPathComponent(UUID().uuidString)),
                verify: { _, _ in
                    calls += 1
                    if revoke && calls == 2 {
                        if revokeGrant { try store.remove(owner, id: id) }
                        else { throw MobileFolderStore.Failure.unavailable }
                    }
                }, choose: { selected }, approve: { _ in true }, chooseSource: { .folder(selected) })
            id = try await root(service)
            try Data("authorized before inspection".utf8).write(to: selected.appendingPathComponent("file.bin"))
            calls = 0; revoke = true
            await rejects { try await service.handle(self.request("inspect", ["rootId": .string(id), "path": .string("file.bin")])) }
            XCTAssertEqual(calls, 2)
            XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent("file.bin")), Data("authorized before inspection".utf8))
        }
    }

    func testNativeSelectionReadAndAccountDeviceOriginFences() async throws {
        let service = try service(), bytes = Data([1,2,3])
        try bytes.write(to: folder.appendingPathComponent("selected/file.bin"))
        let id = try await root(service)
        let scanned = try await service.handle(request("scan", ["rootId": .string(id)]))
        let body = try scanned.decode([String: JSONValue].self)
        XCTAssertEqual(body["complete"], .bool(true))
        let entries = try XCTUnwrap(body["entries"]).decode([MobileFolderReader.Entry].self)
        XCTAssertEqual(entries.count, 1)
        let read = try await service.handle(request("read", ["rootId": .string(id), "path": .string("file.bin"), "version": .string(entries[0].version), "offset": .number(0), "length": .number(3)]))
        let json = try read.decode([String: JSONValue].self)
        XCTAssertEqual(json["path"], .string("file.bin"))
        let chunk = try XCTUnwrap(json["chunk"]).decode([String: JSONValue].self)
        XCTAssertEqual(chunk["data"], .string(bytes.base64EncodedString()))
        for fields: [String: JSONValue] in [["ownerId": .string("foreign")], ["deviceId": .string("other")], ["origin": .string("https://foreign.test")]] {
            await rejects { try await service.handle(self.request("scan", fields.merging(["rootId": .string(id)]) { _, x in x })) }
        }
        await rejects { try await service.handle(self.request("read", ["rootId": .string(id), "path": .string("../outside"), "version": .string(entries[0].version), "offset": .number(0), "length": .number(3)])) }
    }
    func testPublicationRequiresExactNativeConsentAndRemovalPreservesBytes() async throws {
        var allow = false
        let service = try service(approve: { _ in allow }), id = try await root(service)
        let bytes = Data(repeating: 17, count: 65_537)
        let digest = SHA256.hash(data: Data(SHA256.hash(data: bytes))).map { String(format: "%02x", $0) }.joined()
        let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
        let source = MobileFolderReader.Entry(path: "sample.bin", id: "cloud", version: "v1", kind: "file", size: Int64(bytes.count), sha256: nil, fingerprint: .init(partSizeBytes: 8_388_608, partCount: 1, sha256: digest))
        let transfer = MobileSyncStaging.Request(scope: scope, rootId: id, operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "copy", from: "remote", path: source.path, source: source, expectedTarget: nil), confirmed: false))
        var fields: [String: JSONValue] = ["rootId": .string(id), "transfer": try .from(transfer)]
        _ = try await service.handle(request("stage-begin", fields))
        for offset in stride(from: 0, to: bytes.count, by: 65_536) {
            _ = try await service.handle(request("stage-append", fields.merging(["offset": .number(Double(offset)), "data": .string(bytes.subdata(in: offset..<min(bytes.count, offset + 65_536)).base64EncodedString())]) { _, x in x }))
        }
        let staged = try await service.handle(request("stage-finish", fields)).decode([String: JSONValue].self)
        fields["stage"] = try XCTUnwrap(staged["staging"]).decode([String: JSONValue].self)["stage"]
        let approval = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: String(repeating: "a", count: 64))
        fields["approval"] = try .from(approval)
        await rejects { try await service.handle(self.request("publish", fields)) }
        await rejects { try await service.handle(self.request("write-approve", fields)) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent("selected/sample.bin").path))
        allow = true; _ = try await service.handle(request("write-approve", fields))
        var changed = fields
        changed["approval"] = try .from(MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "2", configurationHash: approval.configurationHash))
        await rejects { try await service.handle(self.request("publish", changed)) }
        let result = try await service.handle(request("publish", fields))
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("selected/sample.bin")), bytes)
        let repeated = try await service.handle(request("publish", fields))
        XCTAssertEqual(try result.decode([String: JSONValue].self)["publication"], try repeated.decode([String: JSONValue].self)["publication"])
        _ = try await service.handle(request("remove", ["rootId": .string(id)]))
        await rejects { try await service.handle(self.request("publication-lookup", fields)) }
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("selected/sample.bin")), bytes)
    }
    func testIdentityChangeDuringPickerCannotSaveGrant() async throws {
        var valid = true, saved: Data?
        let selected = folder.appendingPathComponent("selected")
        let store = MobileFolderStore(load: { _ in saved }, save: { _, data in saved = data })
        let service = try MacFolderSync(origin: origin, store: store, staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: { _, _ in if !valid { throw MobileFolderStore.Failure.unavailable } }, choose: { valid = false; return selected }, approve: { _ in true })
        await rejects { try await service.handle(self.request("choose")) }
        XCTAssertNil(saved)
    }
    func testMatchingSuspendCancelsOnlyItsOwnPendingPicker() async throws {
        var started = false, saved: Data?
        let store = MobileFolderStore(load: { _ in saved }, save: { _, value in saved = value })
        let service = try MacFolderSync(origin: origin, store: store, staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: { _, _ in }, choose: { started = true; try await Task.sleep(for: .seconds(30)); return nil }, approve: { _ in true })
        let id = UUID().uuidString
        let pending = Task { try await service.handle(request("choose", id: id)) }
        while !started { await Task.yield() }
        _ = try await service.handle(request("suspend", ["ownerId": .string("foreign")], id: id))
        await rejects { try await service.handle(self.request("list")) }
        _ = try await service.handle(request("suspend", id: id))
        await rejects { try await pending.value }; XCTAssertNil(saved)
        _ = try await service.handle(request("list"))
    }
    func testGenericAndLeasedDispatchCannotCallFolderAdapter() async throws {
        var calls = 0
        let folderService = try service(verify: { _, _ in calls += 1 })
        let telemetry = DeviceTelemetryCollector()
        let controller = ThingtimeNodeController(
            journal: try CommandJournal(fileURL: folder.appendingPathComponent("commands.json")),
            folderSync: folderService,
            pairing: PairingManager(store: InMemoryDeviceCredentialStore()),
            connector: ConnectorRuntime(configuration: nil), telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry))
        let generic = await controller.handle(NodeRequest(method: "folder-sync.request", parameters: request("list")))
        XCTAssertFalse(generic.ok)
        let leased = await controller.handleLeasedCommand(.init(commandID: "remote", leaseID: "lease", method: "folder-sync.request", parameters: request("list"), leaseExpiresAt: .distantFuture))
        XCTAssertFalse(leased.ok); XCTAssertEqual(calls, 0)
        let local = await controller.handleLocalFolderSync(NodeRequest(method: "folder-sync.request", parameters: request("list")))
        XCTAssertTrue(local.ok); XCTAssertEqual(calls, 2)
    }

    func testLocalDispatchPreservesOnlyRedactedTransientIdentityMarker() async throws {
        for failure: Error in [URLError(.timedOut, userInfo: [NSLocalizedDescriptionKey: "private-secret-url"]),
                               ThingtimeAPIClientError.rejected(status: 429), ThingtimeAPIClientError.rejected(status: 503),
                               ThingtimeAPIClientError.notPaired, ThingtimeAPIClientError.rejected(status: 403)] {
            let folderService = try service(verify: { _, _ in throw failure })
            let telemetry = DeviceTelemetryCollector()
            let controller = ThingtimeNodeController(
                journal: try CommandJournal(fileURL: folder.appendingPathComponent(UUID().uuidString)), folderSync: folderService,
                pairing: PairingManager(store: InMemoryDeviceCredentialStore()), connector: ConnectorRuntime(configuration: nil),
                telemetry: telemetry, actionExecutor: SafeActionExecutor(telemetry: telemetry))
            let result = await controller.handleLocalFolderSync(NodeRequest(method: "folder-sync.request", parameters: request("list")))
            XCTAssertFalse(result.ok)
            XCTAssertEqual(result.error?.code, MacFolderSync.identityVerificationIsTransient(failure) ? "folder_identity_retry" : "folder_unavailable")
            XCTAssertFalse(result.error?.message.contains("private-secret-url") ?? true)
        }
    }

    func testCallerCancellationClosesOnlyActiveDialog() async throws {
        var started = false, cancelled = false
        var selection: CheckedContinuation<URL?, Never>?
        let service = try MacFolderSync(origin: origin, store: MobileFolderStore(load: { _ in nil }, save: { _, _ in }),
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")), verify: { _, _ in },
            choose: { await withCheckedContinuation { selection = $0; started = true } }, approve: { _ in true },
            cancelDialog: { cancelled = true; selection?.resume(returning: nil); selection = nil })
        let pending = Task { try await service.handle(request("choose")) }
        while !started { await Task.yield() }
        pending.cancel()
        await rejects { try await pending.value }
        // The picker exits on cancellation as well as the service's dialog callback.
        _ = try await service.handle(request("list"))
        XCTAssertTrue(cancelled)
    }

    func testFolderSyncIsExplicitlyLocalOnly() {
        XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: "folder-sync.request"), .folderSync)
        XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: "folder-sync.publish"), .forbidden)
        XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.bridgeResponseTimeoutSeconds(for: "folder-sync.request"), 300)
    }
    func testStreamUsesTwoLiveIdentityChecksAndNeverSucceedsAfterRevocation() async throws {
        let bytes = Data(repeating: 29, count: 8 * 1024 * 1024 + 17)
        try bytes.write(to: folder.appendingPathComponent("selected/large.bin"))
        var checks = 0, revoked = false, failAt = Int.max
        let service = try service(verify: { _, _ in checks += 1; if revoked || checks == failAt { throw MobileFolderStore.Failure.unavailable } })
        let id = try await root(service)
        let rows = try await service.handle(request("scan", ["rootId": .string(id)])).decode([String: JSONValue].self)
        let entry = try XCTUnwrap(rows["entries"]).decode([MobileFolderReader.Entry].self)[0]
        let input = request("read-range", ["rootId": .string(id), "path": .string(entry.path), "version": .string(entry.version), "offset": .number(0), "length": .number(Double(bytes.count))])
        final class Collector: @unchecked Sendable { var bytes = Data(); var chunks = 0 }
        let collector = Collector(); checks = 0
        let result = try await service.handle(input, stream: { data in
            XCTAssertLessThanOrEqual(data.count, 65_536); collector.bytes.append(data); collector.chunks += 1
        })
        XCTAssertEqual(collector.bytes, bytes); XCTAssertEqual(collector.chunks, 129); XCTAssertEqual(checks, 2)
        let chunk = try XCTUnwrap(result.decode([String: JSONValue].self)["chunk"]).decode([String: JSONValue].self)
        XCTAssertNil(chunk["data"]); XCTAssertEqual(chunk["length"], .number(Double(bytes.count)))
        await rejects { try await service.handle(input) } // Never put a whole range in a normal XPC reply.
        await rejects { try await service.handle(self.request("list"), stream: { _ in }) }
        // The completion verifier refuses after all provisional frames arrived.
        checks = 0; failAt = 2; collector.bytes.removeAll()
        await rejects { try await service.handle(input, stream: { collector.bytes.append($0) }) }
        XCTAssertEqual(collector.bytes, bytes); XCTAssertEqual(checks, 2)
        revoked = true
        await rejects { try await service.handle(input, stream: { _ in XCTFail("Revoked source disclosed bytes") }) }

    }

    func testCancellationDuringStreamStopsBeforeSecondFrameAndReleasesRequest() async throws {
        let bytes = Data(repeating: 7, count: 131_073)
        try bytes.write(to: folder.appendingPathComponent("selected/cancel.bin"))
        let service = try service(), id = try await root(service)
        let rows = try await service.handle(request("scan", ["rootId": .string(id)])).decode([String: JSONValue].self)
        let entry = try XCTUnwrap(rows["entries"]).decode([MobileFolderReader.Entry].self)[0]
        let started = expectation(description: "first provisional frame"), release = DispatchSemaphore(value: 0)
        let input = request("read-range", ["rootId": .string(id), "path": .string(entry.path), "version": .string(entry.version), "offset": .number(0), "length": .number(Double(bytes.count))])
        let pending = Task { try await service.handle(input, stream: { _ in
            started.fulfill(); _ = release.wait(timeout: .now() + 5)
        }) }
        await fulfillment(of: [started], timeout: 5)
        await rejects { try await service.handle(self.request("list")) }
        pending.cancel(); release.signal()
        await rejects { try await pending.value }
        _ = try await service.handle(request("list"))
    }

    func testStagingRangeSurvivesLateIdentityRefusalWithoutPublishing() async throws {
        var checks = 0, failAt = Int.max
        let service = try service(verify: { _, _ in checks += 1; if checks == failAt { throw MobileFolderStore.Failure.unavailable } })
        let id = try await root(service), bytes = Data(repeating: 71, count: 2 * 1024 * 1024 + 17)
        let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
        let source = MobileFolderReader.Entry(path: "sample.bin", id: "cloud", version: "v1", kind: "file", size: Int64(bytes.count), sha256: nil,
            fingerprint: .init(partSizeBytes: 8_388_608, partCount: 1, sha256: SHA256.hash(data: Data(SHA256.hash(data: bytes))).map { String(format: "%02x", $0) }.joined()))
        let transfer = MobileSyncStaging.Request(scope: scope, rootId: id, operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "copy", from: "remote", path: source.path, source: source, expectedTarget: nil), confirmed: false))
        let fields: [String: JSONValue] = ["rootId": .string(id), "transfer": try .from(transfer)]
        _ = try await service.handle(request("stage-begin", fields))
        final class Cursor: @unchecked Sendable { var offset = 0; var calls = 0 }
        let cursor = Cursor()
        checks = 0; failAt = 2
        let input = request("stage-range", fields.merging(["offset": .number(0), "length": .number(Double(bytes.count))]) { _, next in next })
        await rejects { try await service.handle(input, receive: { count in
            let data = bytes.subdata(in: cursor.offset..<cursor.offset + count)
            cursor.offset += count; cursor.calls += 1; return data
        }) }
        XCTAssertEqual(checks, 2); XCTAssertEqual(cursor.calls, 33)
        failAt = Int.max
        let resumed = try await service.handle(request("stage-begin", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(resumed["staging"]).decode(MobileSyncStaging.Progress.self).received, Int64(bytes.count))
        _ = try await service.handle(request("stage-finish", fields))
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent("selected/sample.bin").path))
        await rejects { try await service.handle(input) }
        await rejects { try await service.handle(self.request("list"), receive: { _ in Data() }) }
    }

    func testTrashRequiresSeparateConsentAndRestoreSurvivesDisablingDeletions() async throws {
        var saved: [String: Data] = [:], allowTrash = false, trashPrompts = 0, writePrompts = 0, live = true
        let selected = folder.appendingPathComponent("selected"), target = selected.appendingPathComponent("keep.bin")
        let bytes = Data("recover this exact version".utf8)
        try bytes.write(to: target)
        let service = try MacFolderSync(origin: origin,
            store: MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 }),
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("staging")),
            trash: MobileSyncTrash(directory: folder.appendingPathComponent("trash")),
            verify: { owner, device in
                guard live, owner == "owner", device == "device" else { throw MobileFolderStore.Failure.unavailable }
            }, choose: { selected }, approve: { _ in writePrompts += 1; return true },
            approveTrash: { _ in trashPrompts += 1; return allowTrash })
        let context = try await service.handle(request("context")).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(context["capabilities"]).decode([String: String].self)["fileTrashVersion"], "1.1.1")
        let id = try await root(service)
        let scan = try await service.handle(request("scan", ["rootId": .string(id)])).decode([String: JSONValue].self)
        let entry = try XCTUnwrap(scan["entries"]).decode([MobileFolderReader.Entry].self)[0]
        let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
        let operation = MobileSyncTrash.Request(scope: scope, rootId: id,
            operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "trash", side: "local", path: entry.path, expected: entry), confirmed: false))
        let ordinary = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: String(repeating: "a", count: 64))
        let deletion = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: ordinary.configurationHash, allowTrash: true)
        var fields: [String: JSONValue] = ["rootId": .string(id), "trash": try .from(operation), "approval": try .from(ordinary)]
        _ = try await service.handle(request("write-approve", fields))
        await rejects { try await service.handle(self.request("trash", fields)) }
        XCTAssertEqual(writePrompts, 1); XCTAssertEqual(trashPrompts, 0)
        fields["approval"] = try .from(deletion)
        await rejects { try await service.handle(self.request("trash", fields)) }
        await rejects { try await service.handle(self.request("write-approve", fields)) }
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        allowTrash = true
        _ = try await service.handle(request("write-approve", fields))
        XCTAssertEqual(trashPrompts, 2)
        var changed = fields
        changed["approval"] = try .from(MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "2", configurationHash: ordinary.configurationHash, allowTrash: true))
        await rejects { try await service.handle(self.request("trash", changed)) }
        let result = try await service.handle(request("trash", fields)).decode([String: JSONValue].self)
        let receipt = try XCTUnwrap(result["trash"]).decode(MobileSyncTrash.Lookup.self)
        XCTAssertEqual(receipt.status, "complete"); XCTAssertNil(receipt.receipt?.entry)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        let repeated = try await service.handle(request("trash-lookup", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(repeated["trash"], result["trash"])
        live = false
        await rejects { try await service.handle(self.request("trash-inspect", fields)) }
        live = true
        let inspected = try await service.handle(request("trash-inspect", fields)).decode([String: JSONValue].self)
        let retained = try XCTUnwrap(inspected["retainedEntry"]).decode(MobileFolderReader.Entry.self)
        XCTAssertEqual(retained.id, entry.id)
        // Revoke deletion consent by accepting the ordinary configuration again.
        fields["approval"] = try .from(ordinary)
        _ = try await service.handle(request("write-approve", fields))
        fields["restore"] = try .from(MobileSyncTrash.Restore(path: entry.path, expected: retained))
        _ = try await service.handle(request("trash-restore", fields))
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        await rejects { try await service.handle(self.request("trash", fields)) }
        _ = try await service.handle(request("remove", ["rootId": .string(id)]))
        await rejects { try await service.handle(self.request("trash-inspect", fields)) }
        XCTAssertEqual(try Data(contentsOf: target), bytes)
    }

    func testReviewedRecoveryNeedsNativeConsentAndResumesOnlyTheApprovedDestination() async throws {
        struct Interrupted: Error {}
        var saved: [String: Data] = [:], accept = false, live = true, prompts = 0, interrupt = true
        let selected = folder.appendingPathComponent("selected"), target = selected.appendingPathComponent("recover.bin")
        try Data("retained".utf8).write(to: target)
        let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
        let trash = MobileSyncTrash(directory: folder.appendingPathComponent("trash"), afterRestore: { if interrupt { throw Interrupted() } })
        let service = try MacFolderSync(origin: origin, store: store,
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("staging")), trash: trash,
            verify: { _, _ in guard live else { throw MobileFolderStore.Failure.unavailable } },
            choose: { selected }, approve: { _ in false }, approveTrash: { _ in false },
            approveRestore: { _, _ in prompts += 1; return accept })
        let context = try await service.handle(request("context")).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(context["capabilities"]).decode([String: String].self)["fileTrashVersion"], "1.2.1")
        let id = try await root(service), owner = try FileSyncOwnerScope(ownerId: "owner", url: origin), grant = try store.grant(owner, id: id)
        let entry = try XCTUnwrap(MobileFolderReader.scan(bookmark: grant.bookmark).first { $0.path == "recover.bin" })
        let oldScope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "old-connection", deviceId: "old-device")
        let operation = MobileSyncTrash.Request(scope: oldScope, rootId: id, operation: .init(id: UUID().uuidString.lowercased(),
            mutation: .init(kind: "trash", side: "local", path: entry.path, expected: entry), confirmed: false))
        _ = try trash.trash(operation, owner: owner, bookmark: grant.bookmark)
        let listed = try await service.handle(request("trash-list", ["rootId": .string(id)])).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(listed["trashPage"]).decode(MobileSyncTrash.Page.self).items.count, 1)
        var fields: [String: JSONValue] = ["rootId": .string(id), "trash": try .from(operation)]
        let inspected = try await service.handle(request("trash-inspect", fields)).decode([String: JSONValue].self)
        let retained = try XCTUnwrap(inspected["retainedEntry"]).decode(MobileFolderReader.Entry.self)
        fields["restore"] = try .from(MobileSyncTrash.Restore(path: "new-path", expected: retained))
        await rejects { try await service.handle(self.request("trash-restore-reviewed", fields)) }
        XCTAssertEqual(prompts, 1); XCTAssertNil(try trash.restoration(operation, owner: owner, bookmark: grant.bookmark))
        accept = true; live = false
        await rejects { try await service.handle(self.request("trash-restore-reviewed", fields)) }
        XCTAssertEqual(prompts, 1)
        live = true
        await rejects { try await service.handle(self.request("trash-restore-reviewed", fields)) }
        XCTAssertEqual(prompts, 2)
        let pending = try await service.handle(request("trash-inspect", fields)).decode([String: JSONValue].self)
        XCTAssertNotEqual(pending["restoreIntent"], .null)
        var changed = fields
        changed["restore"] = try .from(MobileSyncTrash.Restore(path: "different", expected: retained))
        await rejects { try await service.handle(self.request("trash-restore-reviewed", changed)) }
        interrupt = false
        _ = try await service.handle(request("trash-restore-reviewed", fields))
        XCTAssertEqual(prompts, 2)
        XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent("new-path")), Data("retained".utf8))
        await rejects { try await service.handle(self.request("trash", fields)) }
    }

    func testOldNativeAdapterCannotApproveTrash() async throws {
        let service = try service(), id = try await root(service)
        let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
        let approval = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: String(repeating: "a", count: 64), allowTrash: true)
        await rejects { try await service.handle(self.request("write-approve", ["rootId": .string(id), "approval": try .from(approval)])) }
    }

}
