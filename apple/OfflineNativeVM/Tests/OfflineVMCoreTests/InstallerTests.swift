import XCTest
import Foundation
import Darwin
@testable import OfflineVMCore

final class InstallerLifecycleTests: XCTestCase {
    func testCancellationBeforeBeginNeverTouchesProgressOrStartsInstaller() {
        let state = InstallLifecycle()
        XCTAssertEqual(state.cancel(reason:"cancelled",now:0),[.finish])
        XCTAssertEqual(state.begin(),[]); XCTAssertFalse(state.receipt.installationBegan)
        XCTAssertFalse(state.receipt.progressCancelIssued)
    }
    func testActiveCancellationWaitsForCallbackAndNeverStopsVM() {
        let state = InstallLifecycle(); XCTAssertEqual(state.begin(),[.begin])
        XCTAssertEqual(state.cancel(reason:"deadline",now:10),[.cancelProgress])
        XCTAssertEqual(state.cancel(reason:"deadline",now:11),[])
        for now in [11.0,20,69] { XCTAssertEqual(state.tick(now:now,stopped:true,canStop:true),[]) }
        XCTAssertFalse(state.receipt.installerCompletionObserved); XCTAssertFalse(state.receipt.stoppedObserved)
        XCTAssertEqual(state.tick(now:70,stopped:true,canStop:true),[.unknown])
        XCTAssertEqual(state.receipt.failure,"teardownUnknown")
    }
    func testSuccessfulCallbackAllowsExactlyOneStopThenObservation() {
        let state = InstallLifecycle(); _ = state.begin(); _ = state.completed(success:true,now:10)
        XCTAssertEqual(state.tick(now:10,stopped:false,canStop:true),[.stopVM])
        XCTAssertEqual(state.tick(now:11,stopped:false,canStop:true),[])
        XCTAssertEqual(state.tick(now:12,stopped:true,canStop:false),[.finish])
        XCTAssertTrue(state.receipt.installerCompletionObserved); XCTAssertTrue(state.receipt.stoppedObserved)
        XCTAssertTrue(state.receipt.installationSucceeded)
    }
    func testCompletionAfterCancellationStillCannotEstablishSuccess() {
        let state = InstallLifecycle(); _ = state.begin(); _ = state.cancel(reason:"cancelled",now:1)
        _ = state.completed(success:true,now:2); _ = state.tick(now:2,stopped:true,canStop:false)
        let result = Supervision(reaped:true,interruption:nil,hardKillRequested:false)
        XCTAssertFalse(InstallReceipt.eligible(worker:state.receipt,supervision:result,workerExitedNormally:true,workerExitCode:0))
    }
    func testInstallationFailureStillWaitsForStoppedState() {
        let state = InstallLifecycle(); _ = state.begin(); _ = state.completed(success:false,now:3)
        XCTAssertEqual(state.tick(now:3,stopped:false,canStop:true),[.stopVM])
        XCTAssertEqual(state.tick(now:18,stopped:false,canStop:false),[.unknown])
        XCTAssertFalse(state.receipt.stoppedObserved)
    }
    func testStopErrorRemainsUnknownEvenIfStoppedStateArrives() {
        let state = InstallLifecycle(); _ = state.begin(); _ = state.completed(success:true,now:1)
        state.stopFailed(SafePlatformError.chain(NSError(domain:"VZErrorDomain",code:1)))
        _ = state.tick(now:2,stopped:true,canStop:false)
        XCTAssertFalse(InstallReceipt.eligible(worker:state.receipt,supervision:Supervision(reaped:true,interruption:nil,hardKillRequested:false),workerExitedNormally:true,workerExitCode:0))
        XCTAssertEqual(state.receipt.failure,"teardownUnknown"); XCTAssertEqual(state.receipt.platformErrorPhase,.stop)
    }
    func testMissingCallbackCannotBeOverriddenByLateCallbackAfterUnknown() {
        let state = InstallLifecycle(); _ = state.begin(); _ = state.cancel(reason:"deadline",now:0)
        XCTAssertEqual(state.tick(now:60,stopped:false,canStop:true),[.unknown])
        XCTAssertEqual(state.completed(success:true,now:61),[])
        XCTAssertFalse(state.receipt.installerCompletionObserved)
    }
    func testHardKillAndUnreapedWorkerNeverInstalled() {
        var worker = InstallWorkerReceipt(); worker.installerCompletionObserved = true; worker.installationSucceeded = true; worker.stoppedObserved = true
        XCTAssertFalse(InstallReceipt.eligible(worker:worker,supervision:Supervision(reaped:true,interruption:nil,hardKillRequested:true),workerExitedNormally:true,workerExitCode:0))
        XCTAssertFalse(InstallReceipt.eligible(worker:worker,supervision:Supervision(reaped:false,interruption:nil,hardKillRequested:false),workerExitedNormally:true,workerExitCode:0))
        let receipt = InstallReceipt(taskID:"fixture",runID:"fixture",sourceSHA:"fixture",manifestSHA256:"fixture",files:[:],worker:worker,supervision:Supervision(reaped:true,interruption:nil,hardKillRequested:true),workerExitedNormally:false,workerExitCode:9)
        XCTAssertTrue(receipt.quarantined); XCTAssertFalse(receipt.installed); XCTAssertFalse(receipt.readiness)
    }
    func testPendingCancellationNeverLaunchesWorker() {
        let worker = MockWorker()
        XCTAssertThrowsError(try Supervisor.run(worker,deadlineSeconds:2,now:{0},pump:{},cancelled:{true}))
        XCTAssertTrue(worker.events.isEmpty)
    }
    func testCancellationAtNaturalExitStillCannotAdmitInstallation() throws {
        let worker = MockWorker(); var cancelled = false; var time = 0.0
        let result = try Supervisor.run(worker,deadlineSeconds:10,now:{time},pump:{time += 1; worker.running = false; cancelled = true},cancelled:{cancelled})
        XCTAssertEqual(result.interruption,"cancelled"); XCTAssertEqual(worker.events,["start"])
    }
    func testInstallerSupervisorHasSeparateFiniteCancellationGrace() throws {
        let worker = MockWorker(); worker.killStops = false; var time = 0.0
        let result = try Supervisor.run(worker,deadlineSeconds:2,now:{time},pump:{time += 1},cancelled:{false},terminationGraceSeconds:90)
        XCTAssertEqual(time,97); XCTAssertEqual(worker.events,["start","terminate","kill"])
        XCTAssertTrue(result.hardKillRequested); XCTAssertFalse(result.reaped)
    }
}
final class InstallerOwnershipTests: XCTestCase {
    var parent: URL!
    var root: URL!
    override func setUpWithError() throws {
        parent = URL(fileURLWithPath:"/private/tmp/offline-vm-install-tests-\(UUID().uuidString)")
        XCTAssertEqual(mkdir(parent.path,0o700),0)
        root = try Workspace.initialize(parent:parent,taskID:UUID().uuidString)
        let inputs = root.appendingPathComponent("inputs")
        for name in ["restore.ipsw","input.img"] { try Preparation.writeExclusive(Data(repeating:0,count:512),to:inputs.appendingPathComponent(name)) }
        let owner = try JSONDecoder().decode(Owner.self,from:SecureFile(root.appendingPathComponent("owner.json")).data())
        let digest = try SecureFile(inputs.appendingPathComponent("input.img")).hash()
        let manifest: [String:Any] = ["contractVersion":"1.0.0","taskID":owner.taskID,"sourceSHA":String(repeating:"a",count:40),"guestOS":"test-macOS","architecture":"arm64",
            "toolchain":["xcode":"expected","macOSSDK":"expected","simulatorSDK":"expected","xcodegen":"expected","offlineDependenciesSHA256":String(repeating:"0",count:64)],
            "restoreImage":["file":"restore.ipsw","format":"ipsw","sha256":digest],"input":["file":"input.img","format":"raw","sha256":digest],"bootGiB":1,"outputGiB":1,"cpuCount":2,"memoryGiB":4,"deadlineSeconds":10]
        try Preparation.writeExclusive(JSONSerialization.data(withJSONObject:manifest),to:inputs.appendingPathComponent("guest.json"))
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at:parent) }
    func prepared() throws -> String {
        let workspace = try Workspace(root:root)
        return try Preparation.perform(workspace:workspace,backend:MockPreparation()).lastPathComponent
    }
    func testOnlyOwnPreparedRunCanCreatePermanentInstallAttempt() throws {
        let runID = try prepared(); var workspace: Workspace? = try Workspace(root:root)
        let run = try workspace!.beginInstallation(runID,parentPID:123)
        let attempt = try JSONDecoder().decode(InstallAttempt.self,from:SecureFile(run.appendingPathComponent("install-attempt.json")).data())
        XCTAssertEqual(attempt.state,"pending-quarantined")
        XCTAssertEqual(try workspace!.installationWorkerRun(runID,parentPID:123),run)
        XCTAssertThrowsError(try workspace!.installationWorkerRun(runID,parentPID:124))
        XCTAssertThrowsError(try Workspace(root:root).beginInstallation(runID,parentPID:123)) // lease still held
        workspace = nil
        XCTAssertThrowsError(try Workspace(root:root).beginInstallation(runID,parentPID:123)) // marker survives lock release
        XCTAssertFalse(PreparationAdmission.available)
    }
    func testSuccessfulInstallFinalizationStillDoesNotGrantReadiness() throws {
        let runID = try prepared(); let run = root.appendingPathComponent("runs").appendingPathComponent(runID)
        var files: [String:FileIdentity] = [:]
        for name in ["boot.img","output.img","auxiliary.bin","hardware.bin","machine-id.bin"] { files[name] = try FileIdentity(run.appendingPathComponent(name)) }
        var worker = InstallWorkerReceipt(); worker.installationBegan = true; worker.installerCompletionObserved = true
        worker.installationSucceeded = true; worker.stoppedObserved = true
        let receipt = InstallReceipt(taskID:"fixture",runID:runID,sourceSHA:"fixture",manifestSHA256:"fixture",files:files,worker:worker,supervision:Supervision(reaped:true,interruption:nil,hardKillRequested:false),workerExitedNormally:true,workerExitCode:0)
        XCTAssertTrue(receipt.installed); XCTAssertFalse(receipt.quarantined)
        XCTAssertFalse(receipt.readiness); XCTAssertFalse(receipt.setupComplete); XCTAssertFalse(receipt.toolchainVerified)
        XCTAssertEqual(receipt.outcome,"installed-not-ready"); XCTAssertFalse(PreparationAdmission.available)
        XCTAssertFalse(InstallReceipt.eligible(worker:worker,supervision:Supervision(reaped:true,interruption:nil,hardKillRequested:false),workerExitedNormally:true,workerExitCode:1))
        XCTAssertFalse(InstallReceipt.eligible(worker:worker,supervision:Supervision(reaped:true,interruption:nil,hardKillRequested:false),workerExitedNormally:false,workerExitCode:0))
    }
    func testForeignRunAndChangedIdentityRejectedBeforeAttempt() throws {
        XCTAssertThrowsError(try Workspace(root:root).beginInstallation(UUID().uuidString,parentPID:123))
        let runID = try prepared(); let run = root.appendingPathComponent("runs").appendingPathComponent(runID)
        try FileManager.default.removeItem(at:run.appendingPathComponent("machine-id.bin"))
        try Preparation.writeExclusive(Data("replacement".utf8),to:run.appendingPathComponent("machine-id.bin"))
        XCTAssertThrowsError(try Workspace(root:root).beginInstallation(runID,parentPID:123))
        XCTAssertFalse(FileManager.default.fileExists(atPath:run.appendingPathComponent("install-attempt.json").path))
    }
}
