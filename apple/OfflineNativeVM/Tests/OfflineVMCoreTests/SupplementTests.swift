import XCTest
import Foundation
import Darwin
@testable import OfflineVMCore

private func supplementalStoppedWorker(_ binding: ReadOnlySupplement? = nil) -> ViewerWorkerReceipt {
    var receipt = ViewerWorkerReceipt()
    receipt.startRequested = true; receipt.startCallbackObserved = true; receipt.runningObserved = true
    receipt.stoppedObserved = true; receipt.stopRequested = true
    if let binding { receipt.storageDevices = 4; receipt.supplementSHA256 = binding.imageSHA256; receipt.supplementReadOnly = true }
    return receipt
}

extension InstallerOwnershipTests {
    func supplementFixture(bytes: Int = 512) throws -> (String, String, String, URL) {
        let workspace = try Workspace(root: root)
        let buildID = UUID().uuidString.lowercased()
        let relative = "build-media/" + workspace.owner.taskID.lowercased() + "/" + buildID + "/build-input.iso"
        let image = root.appendingPathComponent("inputs").appendingPathComponent(relative)
        var directory = root.appendingPathComponent("inputs")
        for part in relative.split(separator: "/").dropLast() {
            directory.appendPathComponent(String(part))
            if !FileManager.default.fileExists(atPath: directory.path) { XCTAssertEqual(mkdir(directory.path, 0o700), 0) }
        }
        try Preparation.writeExclusive(Data(repeating: 1, count: bytes), to: image)
        let sha = try SecureFile(image).hash()
        let candidate = String(repeating: "b", count: 40)
        let header: [String: Any] = ["contractVersion": Contract.version, "taskID": workspace.owner.taskID.lowercased(),
            "buildID": buildID, "sourceCommit": candidate, "format": "RAW-UDF", "candidateAdmission": false,
            "guestStarted": false, "input": ["file": "build-input.iso", "bytes": bytes, "sha256": sha]]
        try Preparation.writeExclusive(JSONSerialization.data(withJSONObject: header), to: image.deletingLastPathComponent().appendingPathComponent("media.json"))
        return (relative, sha, candidate, image)
    }
    func completedViewerCheckpoint(_ workspace: Workspace, runID: String, run: URL) throws -> ViewerAttempt {
        let (_, attempt) = try workspace.beginViewer(runID, parentPID: 42)
        let checkpoint = ViewerCheckpoint(attempt: attempt, worker: supplementalStoppedWorker(attempt.supplement),
            supervision: Supervision(reaped: true, interruption: nil, hardKillRequested: false), normal: true, exitCode: 0, files: attempt.expectedFiles)
        try writeJSON(checkpoint, to: run.appendingPathComponent("viewer-" + attempt.id).appendingPathComponent("checkpoint.json"))
        return attempt
    }
    func testSupplementRegistrationPreservesInstalledPairManifestAndSource() throws {
        let (runID, run) = try installedFixture()
        let (relative, sha, candidate, _) = try supplementFixture()
        let manifest = root.appendingPathComponent("inputs/guest.json")
        let originalManifest = try SecureFile(manifest).hash()
        let files = try Dictionary(uniqueKeysWithValues: Workspace.pairedFiles.map { ($0, try FileIdentity(run.appendingPathComponent($0))) })
        var registering: Workspace? = try Workspace(root: root)
        let binding = try registering!.registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate)
        XCTAssertNotEqual(binding.candidateCommit, binding.installedSourceSHA)
        XCTAssertEqual(try SecureFile(manifest).hash(), originalManifest)
        for (name, identity) in files { XCTAssertEqual(try FileIdentity(run.appendingPathComponent(name)), identity) }
        XCTAssertThrowsError(try Workspace(root: root).beginViewer(runID, parentPID: 43)) // registration holds lease
        registering = nil
        let viewer = try Workspace(root: root)
        let (_, attempt) = try viewer.beginViewer(runID, parentPID: 43)
        XCTAssertEqual(attempt.supplement, binding)
        XCTAssertEqual(try viewer.viewerWorkerRun(runID, attemptID: attempt.id, parentPID: 43), run)
        XCTAssertThrowsError(try viewer.requireAdmission())
    }
    func testSupplementActiveLeaseAndPendingViewerCannotRegister() throws {
        let (runID, run) = try installedFixture()
        let (relative, sha, candidate, _) = try supplementFixture()
        var active: Workspace? = try Workspace(root: root)
        _ = try active!.beginViewer(runID, parentPID: 42)
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate))
        active = nil
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate))
        XCTAssertFalse(FileManager.default.fileExists(atPath: run.appendingPathComponent("viewer-supplement.json").path))
    }
    func testSupplementLatestCheckpointAndResumeKeepBinding() throws {
        let (runID, run) = try installedFixture()
        let (relative, sha, candidate, _) = try supplementFixture()
        var initial: Workspace? = try Workspace(root: root)
        _ = try completedViewerCheckpoint(initial!, runID: runID, run: run)
        initial = nil
        var registering: Workspace? = try Workspace(root: root)
        let binding = try registering!.registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate)
        registering = nil
        var viewer: Workspace? = try Workspace(root: root)
        let attempt = try completedViewerCheckpoint(viewer!, runID: runID, run: run)
        XCTAssertEqual(attempt.supplement, binding)
        viewer = nil
        let resumed = try Workspace(root: root)
        XCTAssertEqual(try resumed.beginViewer(runID, parentPID: 43).1.supplement, binding)
    }
    func testSupplementUninstalledRunCannotRegister() throws {
        let preparedID = try prepared()
        let (relative, sha, candidate, _) = try supplementFixture()
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(preparedID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate))
    }
    func testSupplementOlderGoodCheckpointCannotOverrideNewPendingAttempt() throws {
        let (runID, run) = try installedFixture()
        let (relative, sha, candidate, _) = try supplementFixture()
        var first: Workspace? = try Workspace(root: root)
        _ = try completedViewerCheckpoint(first!, runID: runID, run: run)
        first = nil
        var pending: Workspace? = try Workspace(root: root)
        _ = try pending!.beginViewer(runID, parentPID: 43)
        pending = nil
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate))
    }
    func testSupplementChangedOrMissingHeaderNeverFallsBackToThreeDevices() throws {
        let (runID, run) = try installedFixture()
        let (relative, sha, candidate, image) = try supplementFixture()
        _ = try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate)
        let headerURL = image.deletingLastPathComponent().appendingPathComponent("media.json")
        var header = try XCTUnwrap(JSONSerialization.jsonObject(with: SecureFile(headerURL).data()) as? [String: Any])
        header["extraMetadata"] = "changed"
        try writeJSONData(header, to: headerURL)
        XCTAssertThrowsError(try Workspace(root: root).beginViewer(runID, parentPID: 42))
        try FileManager.default.removeItem(at: headerURL)
        XCTAssertThrowsError(try Workspace(root: root).beginViewer(runID, parentPID: 42))
        XCTAssertFalse(FileManager.default.fileExists(atPath: run.appendingPathComponent("viewer-attempt.json").path))
    }
    func testSupplementQuarantinedCheckpointCannotRegister() throws {
        let (runID, run) = try installedFixture()
        let (relative, sha, candidate, _) = try supplementFixture()
        var viewer: Workspace? = try Workspace(root: root)
        let (_, attempt) = try viewer!.beginViewer(runID, parentPID: 42)
        let bad = ViewerCheckpoint(attempt: attempt, worker: supplementalStoppedWorker(), supervision: Supervision(reaped: true, interruption: nil, hardKillRequested: true), normal: true, exitCode: 0, files: attempt.expectedFiles)
        try writeJSON(bad, to: run.appendingPathComponent("viewer-" + attempt.id).appendingPathComponent("checkpoint.json"))
        viewer = nil
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate))
    }
    func testSupplementPathContainmentAlignmentAndMetadataFailClosed() throws {
        let (runID, _) = try installedFixture()
        let (relative, sha, candidate, image) = try supplementFixture()
        for path in ["/" + relative, "../" + relative, relative.replacingOccurrences(of: "build-media/", with: "build-media/../"), relative.replacingOccurrences(of: root.lastPathComponent.lowercased(), with: UUID().uuidString.lowercased())] {
            XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: path, expectedSHA256: sha, candidateCommit: candidate))
        }
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: String(repeating: "0", count: 64), candidateCommit: candidate))
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: String(repeating: "c", count: 40)))
        let (unaligned, unalignedSHA, _, _) = try supplementFixture(bytes: 513)
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: unaligned, expectedSHA256: unalignedSHA, candidateCommit: candidate))
        let headerURL = image.deletingLastPathComponent().appendingPathComponent("media.json")
        var header = try XCTUnwrap(JSONSerialization.jsonObject(with: SecureFile(headerURL).data()) as? [String: Any])
        header["guestStarted"] = true
        try writeJSONData(header, to: headerURL)
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate))
    }
    private func writeJSONData(_ object: [String: Any], to path: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        try FileManager.default.removeItem(at: path)
        try Preparation.writeExclusive(data, to: path)
    }
    func testSupplementImageAliasesRejectedAndRegistrationIsOneShot() throws {
        let (runID, _) = try installedFixture()
        let (relative, sha, candidate, image) = try supplementFixture()
        let held = image.deletingLastPathComponent().appendingPathComponent("held.img")
        try FileManager.default.moveItem(at: image, to: held)
        XCTAssertEqual(symlink(held.path, image.path), 0)
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate))
        try FileManager.default.removeItem(at: image)
        try FileManager.default.moveItem(at: held, to: image)
        XCTAssertEqual(link(image.path, held.path), 0)
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate))
        try FileManager.default.removeItem(at: held)
        _ = try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate)
        XCTAssertThrowsError(try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate))
    }
    func testSupplementSameByteReplacementAndMidViewerMutationRejected() throws {
        let (runID, run) = try installedFixture()
        let (relative, sha, candidate, image) = try supplementFixture()
        let binding = try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate)
        let held = image.deletingLastPathComponent().appendingPathComponent("held.img")
        try FileManager.default.moveItem(at: image, to: held)
        try Preparation.writeExclusive(Data(repeating: 1, count: 512), to: image)
        XCTAssertThrowsError(try Workspace(root: root).beginViewer(runID, parentPID: 42))
        try FileManager.default.removeItem(at: image)
        try FileManager.default.moveItem(at: held, to: image)
        let viewer = try Workspace(root: root)
        let (_, attempt) = try viewer.beginViewer(runID, parentPID: 42)
        let fd = open(image.path, O_WRONLY | O_NOFOLLOW); XCTAssertGreaterThanOrEqual(fd, 0)
        XCTAssertEqual(write(fd, "x", 1), 1); close(fd)
        XCTAssertThrowsError(try viewer.viewerWorkerRun(runID, attemptID: attempt.id, parentPID: 42))
        XCTAssertThrowsError(try viewer.verifiedSupplementURL(binding, run: run))
    }
    func testSupplementReadOnlyFourDeviceEvidenceRequiredForCheckpoint() throws {
        let (runID, _) = try installedFixture()
        let (relative, sha, candidate, _) = try supplementFixture()
        let binding = try Workspace(root: root).registerSupplement(runID, relativePath: relative, expectedSHA256: sha, candidateCommit: candidate)
        let supervision = Supervision(reaped: true, interruption: nil, hardKillRequested: false)
        let valid = supplementalStoppedWorker(binding)
        XCTAssertTrue(ViewerCheckpoint.eligible(worker: valid, supervision: supervision, normal: true, exitCode: 0, supplement: binding))
        XCTAssertFalse(ViewerCheckpoint.eligible(worker: valid, supervision: supervision, normal: true, exitCode: 0))
        for kind in 0..<3 {
            var bad = valid
            if kind == 0 { bad.supplementReadOnly = false }
            if kind == 1 { bad.storageDevices = 3 }
            if kind == 2 { bad.supplementSHA256 = String(repeating: "0", count: 64) }
            XCTAssertFalse(ViewerCheckpoint.eligible(worker: bad, supervision: supervision, normal: true, exitCode: 0, supplement: binding))
        }
    }
    func testSupplementFeatureManifestAndLegacyReceiptCompatibility() throws {
        XCTAssertEqual(Contract.version, "1.0.0")
        XCTAssertEqual(Contract.manifest["version"] as? String, "1.1.0")
        XCTAssertEqual(Contract.manifest["readOnlySupplement"] as? Bool, true)
        XCTAssertEqual(Contract.manifest["runAvailable"] as? Bool, false)
        XCTAssertTrue((Contract.manifest["commands"] as? [String])?.contains("attach-media") == true)
        let (runID, run) = try installedFixture()
        let workspace = try Workspace(root: root)
        let (_, attempt) = try workspace.beginViewer(runID, parentPID: 42)
        let old = try JSONDecoder().decode(ViewerAttempt.self, from: JSONEncoder().encode(attempt))
        XCTAssertNil(old.supplement)
        XCTAssertTrue(ViewerCheckpoint.eligible(worker: supplementalStoppedWorker(), supervision: Supervision(reaped: true, interruption: nil, hardKillRequested: false), normal: true, exitCode: 0))
        XCTAssertEqual(run.lastPathComponent, old.runID)
    }
}
