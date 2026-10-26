import Foundation

public enum InstallErrorPhase: String, Codable { case installation, virtualMachine, stop }

public struct InstallWorkerReceipt: Codable {
    public var contractVersion = Contract.version
    public var installationBegan = false
    public var installerCompletionObserved = false
    public var installationSucceeded = false
    public var progressCancelIssued = false
    public var stoppedObserved = false
    public var parentFinalizationRequired = true
    public var readiness = false
    public var failure: String? = nil
    public var platformErrors: [SafePlatformError] = []
    public var platformErrorPhase: InstallErrorPhase? = nil
    public init() {}
}
public struct InstallAttempt: Codable {
    public let taskID: String
    public let runID: String
    public let sourceSHA: String
    public let parentPID: Int32
    public let state: String
    public init(taskID: String, runID: String, sourceSHA: String, parentPID: Int32) {
        self.taskID = taskID; self.runID = runID; self.sourceSHA = sourceSHA; self.parentPID = parentPID; state = "pending-quarantined"
    }
}
public struct InstallReceipt: Codable {
    public let taskID: String
    public let runID: String
    public let sourceSHA: String
    public let worker: InstallWorkerReceipt?
    public let workerReaped: Bool
    public let hardKillRequested: Bool
    public let workerExitCode: Int32?
    public let workerExitedNormally: Bool
    public let outcome: String
    public let installed: Bool
    public let quarantined: Bool
    public let setupComplete: Bool
    public let toolchainVerified: Bool
    public let readiness: Bool
    public let manifestSHA256: String
    public let files: [String: FileIdentity]
    public static func eligible(worker: InstallWorkerReceipt?, supervision: Supervision, workerExitedNormally: Bool, workerExitCode: Int32?) -> Bool {
        workerExitedNormally && workerExitCode == 0 && supervision.reaped && !supervision.hardKillRequested && supervision.interruption == nil && worker?.failure == nil &&
        worker?.contractVersion == Contract.version && worker?.installationBegan == true && worker?.readiness == false &&
        worker?.installerCompletionObserved == true && worker?.installationSucceeded == true && worker?.stoppedObserved == true
    }
    public init(taskID: String, runID: String, sourceSHA: String, manifestSHA256: String, files: [String: FileIdentity], worker: InstallWorkerReceipt?, supervision: Supervision, workerExitedNormally: Bool, workerExitCode: Int32?) {
        self.taskID = taskID; self.runID = runID; self.sourceSHA = sourceSHA; self.worker = worker
        workerReaped = supervision.reaped; hardKillRequested = supervision.hardKillRequested
        self.workerExitedNormally = workerExitedNormally; self.workerExitCode = workerExitCode
        setupComplete = false; toolchainVerified = false; readiness = false
        self.manifestSHA256 = manifestSHA256; self.files = files
        installed = Self.eligible(worker: worker, supervision: supervision, workerExitedNormally: workerExitedNormally, workerExitCode: workerExitCode) &&
            Set(files.keys) == ["boot.img", "output.img", "auxiliary.bin", "hardware.bin", "machine-id.bin"]
        quarantined = !installed
        outcome = installed ? "installed-not-ready" : (!supervision.reaped || supervision.hardKillRequested || worker?.installerCompletionObserved != true || worker?.stoppedObserved != true ? "teardownUnknown" : supervision.interruption ?? worker?.failure ?? "installationFailed")
    }
}
public enum InstallAction: Equatable { case begin, cancelProgress, stopVM, finish, unknown }
// All state transitions run on the VM queue. Unlike runtime shutdown, active
// installation may ONLY be cancelled through NSProgress, never VM.stop/pause.
public final class InstallLifecycle {
    public private(set) var receipt = InstallWorkerReceipt()
    private enum Phase { case idle, installing, stopping, finished }
    private var phase = Phase.idle
    private var cancelDeadline: TimeInterval?
    private var stopDeadline: TimeInterval?
    private var stopIssued = false
    public init() {}
    public func begin() -> [InstallAction] {
        guard phase == .idle else { return [] }
        phase = .installing; receipt.installationBegan = true; return [.begin]
    }
    public func cancel(reason: String, now: TimeInterval) -> [InstallAction] {
        if receipt.failure == nil { receipt.failure = reason }
        if phase == .idle { phase = .finished; return [.finish] }
        guard phase == .installing, !receipt.progressCancelIssued else { return [] }
        receipt.progressCancelIssued = true; cancelDeadline = now + 60; return [.cancelProgress]
    }
    public func completed(success: Bool, now: TimeInterval) -> [InstallAction] {
        guard phase == .installing else { return [] }
        receipt.installerCompletionObserved = true; receipt.installationSucceeded = success
        if !success && receipt.failure == nil { receipt.failure = "installationFailed" }
        phase = .stopping; stopDeadline = now + 15; return []
    }
    public func platformFailure(_ errors: [SafePlatformError], phase: InstallErrorPhase = .installation) { receipt.platformErrors = errors; receipt.platformErrorPhase = phase }
    public func stopFailed(_ errors: [SafePlatformError]) { receipt.platformErrors = errors; receipt.platformErrorPhase = .stop; receipt.failure = "teardownUnknown" }
    public func tick(now: TimeInterval, stopped: Bool, canStop: Bool) -> [InstallAction] {
        if phase == .installing, let cancelDeadline, now >= cancelDeadline {
            receipt.failure = "teardownUnknown"; phase = .finished; return [.unknown]
        }
        guard phase == .stopping else { return [] }
        if stopped { receipt.stoppedObserved = true; phase = .finished; return [.finish] }
        if let stopDeadline, now >= stopDeadline { receipt.failure = "teardownUnknown"; phase = .finished; return [.unknown] }
        if canStop && !stopIssued { stopIssued = true; return [.stopVM] }
        return []
    }
}
