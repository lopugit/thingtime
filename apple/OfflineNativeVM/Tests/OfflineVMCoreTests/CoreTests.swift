import XCTest
import Foundation
import Darwin
@testable import OfflineVMCore

final class CoreTests: XCTestCase {
    var temporary: URL!
    override func setUpWithError() throws {
        let canonical = try XCTUnwrap(realpath(FileManager.default.temporaryDirectory.path, nil)); defer { free(canonical) }
        temporary = URL(fileURLWithPath: String(cString: canonical)).appendingPathComponent("offline-vm-tests-\(UUID().uuidString)")
        XCTAssertEqual(mkdir(temporary.path, 0o700), 0)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: temporary) }
    func file(_ name: String, data: Data = Data("fixture".utf8)) throws -> URL {
        let path = temporary.appendingPathComponent(name)
        try data.write(to: path); XCTAssertEqual(chmod(path.path, 0o600), 0); return path
    }
    func testInitExclusiveTaskOwnership() throws {
        let task = UUID().uuidString
        let root = try Workspace.initialize(parent: temporary, taskID: task)
        try Workspace.privateDirectory(root)
        XCTAssertThrowsError(try Workspace.initialize(parent: temporary, taskID: task))
    }
    func testInitRejectsSharedParent() throws {
        XCTAssertEqual(chmod(temporary.path, 0o755), 0)
        XCTAssertThrowsError(try Workspace.initialize(parent: temporary, taskID: UUID().uuidString))
    }
    func testSymlinkRefused() throws {
        let original = try file("original")
        let alias = temporary.appendingPathComponent("alias")
        XCTAssertEqual(symlink(original.path, alias.path), 0)
        XCTAssertThrowsError(try SecureFile(alias))
    }
    func testHardlinkRefused() throws {
        let original = try file("original")
        let alias = temporary.appendingPathComponent("alias")
        XCTAssertEqual(link(original.path, alias.path), 0)
        XCTAssertThrowsError(try SecureFile(original)); XCTAssertThrowsError(try SecureFile(alias))
    }
    func testReplacementDetectedAfterOpen() throws {
        let original = try file("original"); let secured = try SecureFile(original)
        try FileManager.default.removeItem(at: original); _ = try file("original", data: Data("other".utf8))
        XCTAssertThrowsError(try secured.hash())
    }
    func testContentMutationDetectedAfterOpen() throws {
        let original = try file("original"); let secured = try SecureFile(original)
        let fd = open(original.path, O_WRONLY | O_APPEND); XCTAssertGreaterThanOrEqual(fd, 0)
        XCTAssertEqual(write(fd, "x", 1), 1); close(fd)
        XCTAssertThrowsError(try secured.data())
    }
    func testHashAndExclusiveCopy() throws {
        let original = try file("original"); let secured = try SecureFile(original)
        let destination = temporary.appendingPathComponent("copy")
        XCTAssertEqual(try secured.hash(copyTo: destination), try SecureFile(destination).hash())
        XCTAssertThrowsError(try secured.hash(copyTo: destination))
    }
    func testSharedFileRefused() throws {
        let original = try file("original"); XCTAssertEqual(chmod(original.path, 0o644), 0)
        XCTAssertThrowsError(try SecureFile(original))
    }
    func testMissingManifestFailsClosed() throws {
        let root = try Workspace.initialize(parent: temporary, taskID: UUID().uuidString)
        XCTAssertThrowsError(try Workspace(root: root))
    }
    func testMissingTeardownNeverSuccess() {
        var worker = WorkerReceipt(); worker.runningObserved = true
        XCTAssertEqual(Lifecycle.outcome(worker: worker, reaped: true, interrupted: nil), "teardownUnknown")
        worker.stoppedObserved = true
        XCTAssertEqual(Lifecycle.outcome(worker: worker, reaped: false, interrupted: nil), "teardownUnknown")
        XCTAssertEqual(Lifecycle.outcome(worker: worker, reaped: true, interrupted: "cancelled"), "cancelled")
        worker.failure = "configuration"
        XCTAssertEqual(Lifecycle.outcome(worker: worker, reaped: true, interrupted: nil), "configuration")
    }
    func testNoGuestAcceptanceOrRunAdmission() {
        XCTAssertFalse(PreparationAdmission.available)
        XCTAssertEqual(Contract.manifest["networkDevices"] as? Int, 0)
        XCTAssertEqual(Contract.manifest["guestOutputTrusted"] as? Bool, false)
    }
    func testSanitizedReceiptIsPrivate() throws {
        let path = temporary.appendingPathComponent("receipt.json")
        try writeJSON(WorkerReceipt(), to: path)
        let receipt = try JSONDecoder().decode(WorkerReceipt.self, from: SecureFile(path).data())
        XCTAssertFalse(receipt.guestOutputTrusted); XCTAssertFalse(receipt.startRequested)
    }
}
final class MockWorker: WorkerProcess {
    var running = false
    var events: [String] = []
    var terminateStops = false
    var killStops = true
    var startFails = false
    func start() throws { events.append("start"); if startFails { throw VMFailure.worker }; running = true }
    func terminate() { events.append("terminate"); if terminateStops { running = false } }
    func kill() { events.append("kill"); if killStops { running = false } }
}
final class LifecycleTests: XCTestCase {
    func testExternalDeadlineForcesThenReapsExactWorker() throws {
        let worker = MockWorker(); var time = 0.0
        let result = try Supervisor.run(worker, deadlineSeconds: 2, now: {time}, pump: {time += 1}, cancelled: {false})
        XCTAssertEqual(worker.events, ["start", "terminate", "kill"])
        XCTAssertTrue(result.reaped); XCTAssertTrue(result.hardKillRequested)
        XCTAssertEqual(result.interruption, "deadline"); XCTAssertLessThanOrEqual(time, 22)
    }
    func testCancellationStopsWithoutHardKill() throws {
        let worker = MockWorker(); worker.terminateStops = true; var time = 0.0
        let result = try Supervisor.run(worker, deadlineSeconds: 100, now: {time}, pump: {time += 1}, cancelled: {time >= 2})
        XCTAssertEqual(worker.events, ["start", "terminate"]); XCTAssertTrue(result.reaped)
        XCTAssertEqual(result.interruption, "cancelled"); XCTAssertFalse(result.hardKillRequested)
    }
    func testUnreapableWorkerHasFiniteBoundAndUnknownTeardown() throws {
        let worker = MockWorker(); worker.killStops = false; var time = 0.0
        let result = try Supervisor.run(worker, deadlineSeconds: 2, now: {time}, pump: {time += 1}, cancelled: {false})
        XCTAssertFalse(result.reaped); XCTAssertEqual(time, 22)
        XCTAssertEqual(Lifecycle.outcome(worker: nil, reaped: result.reaped, interrupted: result.interruption), "teardownUnknown")
    }
    func testNaturalStopDoesNotSignal() throws {
        let worker = MockWorker(); var time = 0.0
        let result = try Supervisor.run(worker, deadlineSeconds: 100, now: {time}, pump: {time += 1; worker.running = false}, cancelled: {false})
        XCTAssertEqual(worker.events, ["start"]); XCTAssertTrue(result.reaped); XCTAssertNil(result.interruption)
    }
    func testLaunchFailureNeverSignalsUnownedPID() {
        let worker = MockWorker(); worker.startFails = true
        XCTAssertThrowsError(try Supervisor.run(worker, deadlineSeconds: 2, now: {0}, pump: {}, cancelled: {false}))
        XCTAssertEqual(worker.events, ["start"])
    }
}
final class MockPreparation: FreshPreparationBackend {
    var calls: [String] = []
    var failMetadata = false
    var mutateRestore: ((URL) -> Void)?
    func hardwareModel(restoreImage: URL) throws -> RestoreMetadata {
        calls.append("local-restore-metadata")
        mutateRestore?(restoreImage)
        if failMetadata { throw VMFailure.configuration }
        return RestoreMetadata(hardware: Data("mock-hardware".utf8), operatingSystem: "test-macOS", build: "mock-build")
    }
    func freshMachineIdentifier() -> Data { calls.append("fresh-identity"); return Data(UUID().uuidString.utf8) }
    func createAuxiliary(at path: URL, hardware: Data) throws {
        calls.append("new-auxiliary")
        try Preparation.writeExclusive(Data("mock-aux".utf8), to: path)
    }
}
final class PreparationTests: XCTestCase {
    var root: URL!
    var parent: URL!
    override func setUpWithError() throws {
        parent = URL(fileURLWithPath: "/private/tmp/offline-vm-preparation-tests-\(UUID().uuidString)")
        XCTAssertEqual(mkdir(parent.path, 0o700), 0)
        root = try Workspace.initialize(parent: parent, taskID: UUID().uuidString)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: parent) }
    func workspace(extra: [String: Any] = [:]) throws -> Workspace {
        let inputs = root.appendingPathComponent("inputs")
        for name in ["restore.ipsw", "source.img"] {
            try Preparation.writeExclusive(name == "source.img" ? Data(repeating: 0, count: 512) : Data(name.utf8), to: inputs.appendingPathComponent(name))
        }
        let owner = try JSONDecoder().decode(Owner.self, from: SecureFile(root.appendingPathComponent("owner.json")).data())
        var value: [String: Any] = ["contractVersion": "1.0.0", "taskID": owner.taskID, "sourceSHA": String(repeating: "a", count: 40),
            "guestOS": "test-macOS", "architecture": "arm64", "toolchain": ["xcode":"expected", "macOSSDK":"expected", "simulatorSDK":"expected", "xcodegen":"expected", "offlineDependenciesSHA256":String(repeating:"0",count:64)],
            "restoreImage": ["format":"ipsw","file":"restore.ipsw","sha256":try SecureFile(inputs.appendingPathComponent("restore.ipsw")).hash()],
            "input": ["format":"raw","file":"source.img","sha256":try SecureFile(inputs.appendingPathComponent("source.img")).hash()],
            "outputGiB":1,"bootGiB":1,"cpuCount":2,"memoryGiB":4,"deadlineSeconds":10]
        value.merge(extra, uniquingKeysWith: {_,new in new})
        try Preparation.writeExclusive(JSONSerialization.data(withJSONObject: value), to: inputs.appendingPathComponent("guest.json"))
        return try Workspace(root: root)
    }
    func testFreshPreparationReceiptAndNoBoot() throws {
        let workspace = try workspace(); let backend = MockPreparation()
        let run = try Preparation.perform(workspace: workspace, backend: backend)
        let receipt = try JSONDecoder().decode(PreparationReceipt.self, from: SecureFile(run.appendingPathComponent("preparation.json")).data())
        XCTAssertEqual(backend.calls, ["local-restore-metadata","fresh-identity","new-auxiliary"])
        XCTAssertTrue(receipt.freshIdentity); XCTAssertFalse(receipt.guestStarted); XCTAssertFalse(receipt.installed)
        XCTAssertFalse(receipt.setupComplete); XCTAssertFalse(receipt.toolchainVerified)
        XCTAssertEqual(receipt.files.count,5); XCTAssertEqual(receipt.files["boot.img"]?.bytes,1024*1024*1024)
        XCTAssertThrowsError(try workspace.requireAdmission())
        XCTAssertThrowsError(try Preparation.perform(workspace: workspace, backend: backend))
    }
    func testMetadataFailureConsumesTaskWithoutIdentityOrDisk() throws {
        let workspace = try workspace(); let backend = MockPreparation(); backend.failMetadata = true
        XCTAssertThrowsError(try Preparation.perform(workspace: workspace, backend: backend))
        XCTAssertEqual(backend.calls, ["local-restore-metadata"])
        XCTAssertThrowsError(try workspace.beginPreparation())
    }
    func testUnknownTransportFieldRejected() throws {
        XCTAssertThrowsError(try workspace(extra: ["networkDevices":["nat"]]))
    }
    func testManifestCannotImportExistingVM() throws {
        XCTAssertThrowsError(try workspace(extra: ["boot":["file":"existing.img"]]))
    }
    func testTraversalDiskRejected() throws {
        XCTAssertThrowsError(try workspace(extra: ["input":["file":"../foreign.img","sha256":String(repeating:"0",count:64)]]))
    }
}
final class CallbackSafetyTests: XCTestCase {
    func testConcurrentFrameworkCallbacksPublishExactlyOnce() {
        let completion = LockedCompletion<Int>()
        let group = DispatchGroup()
        let queue = DispatchQueue(label: "offline-vm-test-callbacks", attributes: .concurrent)
        for value in 0..<100 {
            group.enter(); queue.async { completion.complete(value); group.leave() }
        }
        XCTAssertEqual(group.wait(timeout: .now()+5), .success)
        XCTAssertNotNil(completion.take()); XCTAssertNil(completion.take())
        XCTAssertFalse(completion.complete(101))
    }
    func testCancelledMetadataIgnoresLateCallback() {
        let completion = LockedCompletion<String>(); completion.cancel()
        XCTAssertFalse(completion.complete("late")); XCTAssertNil(completion.take())
    }
    func testCancellationClearsPublishedButUnconsumedMetadata() {
        let completion = LockedCompletion<String>(); XCTAssertTrue(completion.complete("arrived"))
        completion.cancel(); XCTAssertNil(completion.take())
    }
    func testStaleStoppedReceiptCannotProveTeardownAfterHardKill() {
        var receipt = WorkerReceipt(); receipt.stoppedObserved = true; receipt.runningObserved = true
        XCTAssertFalse(Lifecycle.teardownProven(worker: receipt, reaped: true, hardKillRequested: true))
        XCTAssertTrue(Lifecycle.teardownProven(worker: receipt, reaped: true, hardKillRequested: false))
        XCTAssertFalse(Lifecycle.teardownProven(worker: receipt, reaped: false, hardKillRequested: false))
    }
}
final class RestoreInspectionTests: XCTestCase {
    var directory: URL!
    override func setUpWithError() throws {
        directory = URL(fileURLWithPath: "/private/tmp/offline-vm-inspection-tests-\(UUID().uuidString)")
        XCTAssertEqual(mkdir(directory.path, 0o700),0)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
    func testReadOnlyInspectionDoesNotPrepareOrAdoptPublicMedia() throws {
        let path = directory.appendingPathComponent("restore.ipsw")
        try Data("mock-restore-media".utf8).write(to:path); XCTAssertEqual(chmod(path.path,0o644),0)
        let before = try FileManager.default.contentsOfDirectory(atPath:directory.path)
        let backend = MockPreparation()
        let receipt = try RestoreInspection.perform(path:path,backend:backend)
        XCTAssertEqual(backend.calls,["local-restore-metadata"])
        XCTAssertFalse(receipt.guestStarted); XCTAssertFalse(receipt.artifactsCreated); XCTAssertFalse(receipt.installed)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath:directory.path),before)
        XCTAssertEqual(try Data(contentsOf:path),Data("mock-restore-media".utf8))
    }
    func testInspectionRejectsSymlinkAndNonIPSWBeforeBackend() throws {
        let path = directory.appendingPathComponent("restore.ipsw"); try Data("mock".utf8).write(to:path)
        let alias = directory.appendingPathComponent("alias.ipsw"); XCTAssertEqual(symlink(path.path,alias.path),0)
        let backend = MockPreparation()
        XCTAssertThrowsError(try RestoreInspection.perform(path:alias,backend:backend))
        XCTAssertThrowsError(try RestoreInspection.perform(path:directory.appendingPathComponent("other.txt"),backend:backend))
        XCTAssertTrue(backend.calls.isEmpty)
    }
    func testInspectionRejectsFIFOWithoutOpeningOrWaitingForWriter() throws {
        let path = directory.appendingPathComponent("restore.ipsw")
        XCTAssertEqual(mkfifo(path.path,0o600),0)
        let backend = MockPreparation(); let start = ProcessInfo.processInfo.systemUptime
        XCTAssertThrowsError(try RestoreInspection.perform(path:path,backend:backend))
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime-start,1); XCTAssertTrue(backend.calls.isEmpty)
        XCTAssertThrowsError(try SecureFile(path))
    }
    func testInspectionRejectsHardlinkBeforeBackend() throws {
        let path = directory.appendingPathComponent("restore.ipsw"); try Data("mock".utf8).write(to:path)
        XCTAssertEqual(link(path.path,directory.appendingPathComponent("alias.ipsw").path),0)
        let backend = MockPreparation()
        XCTAssertThrowsError(try RestoreInspection.perform(path:path,backend:backend)); XCTAssertTrue(backend.calls.isEmpty)
    }
    func testInspectionDetectsMutationDuringMetadataCallback() throws {
        let path = directory.appendingPathComponent("restore.ipsw"); try Data("mock".utf8).write(to:path)
        let backend = MockPreparation(); backend.mutateRestore = { url in try! Data("changed fixture bytes".utf8).write(to:url) }
        XCTAssertThrowsError(try RestoreInspection.perform(path:path,backend:backend)) { XCTAssertEqual($0 as? VMFailure,.integrity) }
    }
    func testSafeNestedPlatformDiagnosticsExcludeMessagesAndUnknownDomains() throws {
        let nested = NSError(domain:"NSPOSIXErrorDomain",code:13,userInfo:[NSLocalizedDescriptionKey:"secret fixture marker"])
        let outer = NSError(domain:"VZErrorDomain",code:10004,userInfo:[NSUnderlyingErrorKey:nested,NSLocalizedDescriptionKey:"private fixture path"])
        let chain = SafePlatformError.chain(outer)
        XCTAssertEqual(chain.map(\.domain),["VZErrorDomain","NSPOSIXErrorDomain"])
        XCTAssertEqual(chain.map(\.code),[10004,13])
        let encoded = String(data:try JSONEncoder().encode(chain),encoding:.utf8)!
        XCTAssertFalse(encoded.contains("fixture")); XCTAssertFalse(encoded.contains("private")); XCTAssertFalse(encoded.contains("secret"))
        XCTAssertEqual(SafePlatformError.chain(NSError(domain:"untrusted fixture text",code:7))[0].domain,"other")
    }
    func testPlatformDiagnosticChainHasFiniteDepth() {
        var error = NSError(domain:"NSCocoaErrorDomain",code:0)
        for code in 1...10 { error = NSError(domain:"VZErrorDomain",code:code,userInfo:[NSUnderlyingErrorKey:error]) }
        XCTAssertEqual(SafePlatformError.chain(error).count,4)
    }
}
