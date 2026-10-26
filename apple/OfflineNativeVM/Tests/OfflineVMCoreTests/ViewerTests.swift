import XCTest
import Foundation
import Darwin
@testable import OfflineVMCore

final class ViewerLifecycleTests: XCTestCase {
    func testStartingStoppedStateDoesNotFinishBeforeCallback() {
        let state = ViewerLifecycle(); XCTAssertEqual(state.begin(), [.start])
        XCTAssertEqual(state.tick(now: 0, stopped: true, canStop: false), [])
        state.stop(reason: "requested", now: 1)
        XCTAssertEqual(state.tick(now: 2, stopped: false, canStop: false), [])
        state.started(running: true)
        XCTAssertEqual(state.tick(now: 3, stopped: false, canStop: true), [.stop])
        XCTAssertEqual(state.tick(now: 4, stopped: false, canStop: true), [])
        XCTAssertEqual(state.tick(now: 5, stopped: true, canStop: false), [.finish])
        XCTAssertEqual(state.receipt.reason, "requested"); XCTAssertTrue(state.receipt.stoppedObserved)
    }
    func testMissingStartOrStopCallbackFailsWithinFifteenSeconds() {
        let state = ViewerLifecycle(); _ = state.begin(); state.stop(reason: "deadline", now: 10)
        XCTAssertEqual(state.tick(now: 24, stopped: true, canStop: false), [])
        XCTAssertEqual(state.tick(now: 25, stopped: true, canStop: false), [.unknown])
        state.started(running: true)
        XCTAssertFalse(state.receipt.runningObserved)
        XCTAssertEqual(state.tick(now: 26, stopped: true, canStop: false), [])
        XCTAssertEqual(state.receipt.failure, "teardownUnknown")
    }
    func testStopFailureDoesNotBecomeSuccessFromLateStoppedState() {
        let state = ViewerLifecycle(); _ = state.begin(); state.started(running: true)
        state.stop(reason: "requested", now: 0)
        state.failed([]); _ = state.tick(now: 1, stopped: true, canStop: false)
        XCTAssertFalse(ViewerCheckpoint.eligible(worker: state.receipt, supervision: Supervision(reaped: true, interruption: nil, hardKillRequested: false), normal: true, exitCode: 0))
    }
    func testHardKillStaleStopAndNonzeroExitCannotAdmitCheckpoint() {
        let worker = stoppedWorker()
        XCTAssertTrue(ViewerCheckpoint.eligible(worker: worker, supervision: Supervision(reaped: true, interruption: "deadline", hardKillRequested: false), normal: true, exitCode: 0))
        XCTAssertFalse(ViewerCheckpoint.eligible(worker: worker, supervision: Supervision(reaped: true, interruption: nil, hardKillRequested: true), normal: true, exitCode: 0))
        XCTAssertFalse(ViewerCheckpoint.eligible(worker: worker, supervision: Supervision(reaped: false, interruption: nil, hardKillRequested: false), normal: true, exitCode: 0))
        XCTAssertFalse(ViewerCheckpoint.eligible(worker: worker, supervision: Supervision(reaped: true, interruption: nil, hardKillRequested: false), normal: true, exitCode: 1))
        var altered = worker; altered.networkDevices = 1
        XCTAssertFalse(ViewerCheckpoint.eligible(worker: altered, supervision: Supervision(reaped: true, interruption: nil, hardKillRequested: false), normal: true, exitCode: 0))
    }
    func testParentHasMarginBeyondWorkerStopDeadlineAndFiniteReap() throws {
        let worker = MockWorker(); worker.killStops = false; var time = 0.0
        let result = try Supervisor.run(worker, deadlineSeconds: 2, now: {time}, pump: {time += 1}, cancelled: {false}, terminationGraceSeconds: 25)
        XCTAssertEqual(time, 32); XCTAssertTrue(result.hardKillRequested); XCTAssertFalse(result.reaped)
    }
}
func stoppedWorker() -> ViewerWorkerReceipt {
    var worker = ViewerWorkerReceipt(); worker.startRequested = true; worker.startCallbackObserved = true
    worker.runningObserved = true; worker.stopRequested = true; worker.stoppedObserved = true
    return worker
}
extension InstallerOwnershipTests {
    func installedFixture() throws -> (String, URL) {
        let runID = try prepared()
        let workspace = try Workspace(root: root)
        let run = try workspace.beginInstallation(runID, parentPID: 123)
        // Apple changes auxiliary size while preserving inode. Use final, not prepared size.
        let fd = open(run.appendingPathComponent("auxiliary.bin").path, O_WRONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw VMFailure.path }; defer { close(fd) }
        XCTAssertEqual(ftruncate(fd, 8192), 0)
        var files: [String: FileIdentity] = [:]
        for name in Workspace.pairedFiles { files[name] = try FileIdentity(run.appendingPathComponent(name)) }
        var worker = InstallWorkerReceipt(); worker.installationBegan = true; worker.installerCompletionObserved = true
        worker.installationSucceeded = true; worker.stoppedObserved = true
        let receipt = InstallReceipt(taskID: workspace.owner.taskID, runID: runID, sourceSHA: workspace.manifest.sourceSHA,
            manifestSHA256: workspace.manifestHash, files: files, worker: worker,
            supervision: Supervision(reaped: true, interruption: nil, hardKillRequested: false), workerExitedNormally: true, workerExitCode: 0)
        try writeJSON(receipt, to: run.appendingPathComponent("installation.json"))
        return (runID, run)
    }
    func testViewerUsesFinalInstalledSizeAndExclusiveLease() throws {
        let (runID, run) = try installedFixture()
        XCTAssertThrowsError(try Workspace(root: root).preparedRun(runID))
        var workspace: Workspace? = try Workspace(root: root)
        XCTAssertEqual(try workspace!.installedRun(runID), run)
        let (_, attempt) = try workspace!.beginViewer(runID, parentPID: 42)
        XCTAssertEqual(try workspace!.viewerWorkerRun(runID, attemptID: attempt.id, parentPID: 42), run)
        XCTAssertThrowsError(try workspace!.viewerWorkerRun(runID, attemptID: attempt.id, parentPID: 43))
        XCTAssertThrowsError(try Workspace(root: root).beginViewer(runID, parentPID: 42))
        XCTAssertThrowsError(try workspace!.requireAdmission())
        workspace = nil
        // Parent death/absence leaves pending marker: release of lease is not permission to resume.
        XCTAssertThrowsError(try Workspace(root: root).beginViewer(runID, parentPID: 42))
    }
    func testViewerResumeRequiresCurrentFinalCheckpointAndOriginalPair() throws {
        let (runID, run) = try installedFixture()
        var workspace: Workspace? = try Workspace(root: root)
        let (_, attempt) = try workspace!.beginViewer(runID, parentPID: 42)
        let fd = open(run.appendingPathComponent("auxiliary.bin").path, O_WRONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw VMFailure.path }
        XCTAssertEqual(ftruncate(fd, 16384), 0); close(fd)
        var files: [String: FileIdentity] = [:]
        for name in Workspace.pairedFiles { files[name] = try FileIdentity(run.appendingPathComponent(name)) }
        let checkpoint = ViewerCheckpoint(attempt: attempt, worker: stoppedWorker(), supervision: Supervision(reaped: true, interruption: nil, hardKillRequested: false), normal: true, exitCode: 0, files: files)
        try writeJSON(checkpoint, to: run.appendingPathComponent("viewer-" + attempt.id).appendingPathComponent("checkpoint.json"))
        workspace = nil
        var resumed: Workspace? = try Workspace(root: root)
        let (_, second) = try resumed!.beginViewer(runID, parentPID: 43)
        XCTAssertNotEqual(attempt.id, second.id)
        XCTAssertEqual(second.expectedFiles["auxiliary.bin"]?.bytes, 16384)
        resumed = nil
        XCTAssertThrowsError(try Workspace(root: root).beginViewer(runID, parentPID: 44))
    }
    func testViewerRejectsChangedDiskAndNoInstallBeforeMarker() throws {
        let preparedID = try prepared()
        XCTAssertThrowsError(try Workspace(root: root).beginViewer(preparedID, parentPID: 42))
        let preparedRun = root.appendingPathComponent("runs").appendingPathComponent(preparedID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: preparedRun.appendingPathComponent("viewer-attempt.json").path))
    }
    func testViewerRejectsReplacementEvenWithSameSize() throws {
        let (runID, run) = try installedFixture()
        let disk = run.appendingPathComponent("auxiliary.bin")
        // Keep original inode allocated so the replacement cannot recycle it.
        try FileManager.default.moveItem(at: disk, to: run.appendingPathComponent("held-original"))
        try Preparation.writeExclusive(Data(repeating: 0, count: 8192), to: disk)
        XCTAssertThrowsError(try Workspace(root: root).beginViewer(runID, parentPID: 42))
        XCTAssertFalse(FileManager.default.fileExists(atPath: run.appendingPathComponent("viewer-attempt.json").path))
    }
}
