import Foundation

public struct ViewerAttempt: Codable, Equatable {
    public let id: String
    public let taskID: String
    public let runID: String
    public let sourceSHA: String
    public let manifestSHA256: String
    public let expectedFiles: [String: FileIdentity]
    public let parentPID: Int32
    public init(taskID: String, runID: String, sourceSHA: String, manifestSHA256: String, expectedFiles: [String: FileIdentity], parentPID: Int32) {
        id = UUID().uuidString; self.taskID = taskID; self.runID = runID; self.sourceSHA = sourceSHA
        self.manifestSHA256 = manifestSHA256; self.expectedFiles = expectedFiles; self.parentPID = parentPID
    }
}
public struct ViewerWorkerReceipt: Codable {
    public var contractVersion = Contract.version
    public var startRequested = false
    public var startCallbackObserved = false
    public var runningObserved = false
    public var stoppedObserved = false
    public var stopRequested = false
    public var reason: String? = nil
    public var failure: String? = nil
    public var platformErrors: [SafePlatformError] = []
    public var keyboardDevices = 1
    public var pointingDevices = 1
    public var networkDevices = 0
    public var directoryShares = 0
    public var socketDevices = 0
    public var clipboardIntegration = false
    public var readiness = false
    public init() {}
}
public struct ViewerCheckpoint: Codable {
    public let attempt: ViewerAttempt
    public let worker: ViewerWorkerReceipt?
    public let workerReaped: Bool
    public let workerExitedNormally: Bool
    public let workerExitCode: Int32?
    public let hardKillRequested: Bool
    public let interruption: String?
    public let teardownProven: Bool
    public let quarantined: Bool
    public var readiness = false
    public let files: [String: FileIdentity]
    public static func eligible(worker: ViewerWorkerReceipt?, supervision: Supervision, normal: Bool, exitCode: Int32?) -> Bool {
        normal && exitCode == 0 && supervision.reaped && !supervision.hardKillRequested &&
        worker?.contractVersion == Contract.version && worker?.startRequested == true && worker?.runningObserved == true &&
        worker?.startCallbackObserved == true && worker?.stoppedObserved == true && worker?.failure == nil && worker?.readiness == false &&
        worker?.keyboardDevices == 1 && worker?.pointingDevices == 1 && worker?.networkDevices == 0 &&
        worker?.directoryShares == 0 && worker?.socketDevices == 0 && worker?.clipboardIntegration == false
    }
    public init(attempt: ViewerAttempt, worker: ViewerWorkerReceipt?, supervision: Supervision, normal: Bool, exitCode: Int32?, files: [String: FileIdentity]) {
        self.attempt = attempt; self.worker = worker; workerReaped = supervision.reaped
        workerExitedNormally = normal; workerExitCode = exitCode; hardKillRequested = supervision.hardKillRequested
        interruption = supervision.interruption; self.files = files
        teardownProven = Self.eligible(worker: worker, supervision: supervision, normal: normal, exitCode: exitCode) && Set(files.keys) == Workspace.pairedFiles
        quarantined = !teardownProven
    }
}
public enum ViewerAction: Equatable { case start, stop, finish, unknown }
// Called only on the main VM queue. Starting/stopping transitions remain bounded.
public final class ViewerLifecycle {
    public private(set) var receipt = ViewerWorkerReceipt()
    private var begun = false
    private var finished = false
    private var stopIssued = false
    private var stopDeadline: TimeInterval?
    public init() {}
    public func begin() -> [ViewerAction] {
        guard !begun, !finished, stopDeadline == nil else { return [] }
        begun = true; receipt.startRequested = true; return [.start]
    }
    public func started(running: Bool) { if !finished { receipt.startCallbackObserved = true; receipt.runningObserved = running } }
    public func stop(reason: String, now: TimeInterval) {
        guard !finished else { return }
        if stopDeadline == nil { stopDeadline = now + 15; receipt.reason = reason }
        receipt.stopRequested = true
    }
    public func failed(_ errors: [SafePlatformError]) { receipt.failure = "worker"; receipt.platformErrors = errors }
    public func tick(now: TimeInterval, stopped: Bool, canStop: Bool) -> [ViewerAction] {
        guard !finished else { return [] }
        if stopped, begun, receipt.startCallbackObserved {
            receipt.stoppedObserved = true; finished = true; return [.finish]
        }
        guard let stopDeadline else { return [] }
        if now >= stopDeadline { receipt.failure = "teardownUnknown"; finished = true; return [.unknown] }
        if canStop && !stopIssued { stopIssued = true; return [.stop] }
        return []
    }
}
