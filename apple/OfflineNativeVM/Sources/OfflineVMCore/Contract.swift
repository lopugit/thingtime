import Foundation
import CryptoKit
import Darwin

public enum VMFailure: String, Error { case guestReadinessUnavailable, arguments, manifest, path, ownership, integrity, consumed, configuration, worker, deadline, cancelled, teardownUnknown }
public enum Contract {
    public static let version = "1.0.0"
    public static let feature = "native.offline-vm"
    public static let manifest: [String: Any] = ["feature": feature, "version": version, "guest": "macos-arm64", "commands": ["manifest", "init", "validate", "plan", "inspect-restore", "prepare", "install", "run"], "networkDevices": 0, "directoryShares": 0, "socketDevices": 0, "guestOutputTrusted": false, "runConsumesTask": true, "runAvailable": false, "prepareStartsGuest": false]
}
public struct Disk: Codable, Equatable { public let file: String; public let sha256: String; public let format: String }
public struct Toolchain: Codable, Equatable {
    public let xcode: String
    public let macOSSDK: String
    public let simulatorSDK: String
    public let xcodegen: String
    public let offlineDependenciesSHA256: String
}
public struct GuestManifest: Codable {
    public let contractVersion: String
    public let taskID: String
    public let sourceSHA: String
    public let guestOS: String
    public let architecture: String
    public let toolchain: Toolchain // Expected prerequisite labels, never claimed installed by prepare.
    public let restoreImage: Disk
    public let input: Disk
    public let outputGiB: UInt64
    public let bootGiB: UInt64
    public let cpuCount: Int
    public let memoryGiB: UInt64
    public let deadlineSeconds: Int
    public var disks: [Disk] { [restoreImage, input] }
    public func check() throws {
        guard contractVersion == Contract.version, UUID(uuidString: taskID) != nil,
              sourceSHA.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil,
              architecture == "arm64", !guestOS.isEmpty,
              !toolchain.xcode.isEmpty, !toolchain.macOSSDK.isEmpty, !toolchain.simulatorSDK.isEmpty,
              !toolchain.xcodegen.isEmpty, Self.digest(toolchain.offlineDependenciesSHA256),
              cpuCount > 0, memoryGiB > 0, bootGiB > 0, outputGiB > 0,
              [memoryGiB, bootGiB, outputGiB].allSatisfy({$0 <= UInt64(Int64.max) / (1024*1024*1024)}),
              deadlineSeconds > 0, deadlineSeconds <= 86400,
              Set(disks.map(\.file)).count == disks.count, restoreImage.format == "ipsw", input.format == "raw" else { throw VMFailure.manifest }
        for disk in disks {
            guard disk.file.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]*$", options: .regularExpression) != nil,
                  disk.file != ".", disk.file != "..", Self.digest(disk.sha256) else { throw VMFailure.manifest }
        }
    }
    static func digest(_ value: String) -> Bool { value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
}
public struct FileIdentity: Codable, Equatable {
    public let device: Int32; public let inode: UInt64; public let bytes: Int64
    public init(_ path: URL) throws {
        let file = try SecureFile(path); var s = stat()
        guard fstat(file.fd, &s) == 0 else { throw VMFailure.path }
        device = s.st_dev; inode = s.st_ino; bytes = s.st_size
    }
}
public struct PreparationReceipt: Codable {
    public let contractVersion: String
    public let taskID: String
    public let runID: String
    public let sourceSHA: String
    public let manifestSHA256: String
    public let state: String
    public let restoreOS: String
    public let restoreBuild: String
    public let guestStarted: Bool
    public let installed: Bool
    public let setupComplete: Bool
    public let toolchainVerified: Bool
    public let freshIdentity: Bool
    public let hardwareSHA256: String
    public let machineIdentifierSHA256: String
    public let files: [String: FileIdentity]
    public init(taskID: String, runID: String, sourceSHA: String, manifestSHA256: String, restoreOS: String, restoreBuild: String, hardwareSHA256: String, machineIdentifierSHA256: String, files: [String: FileIdentity]) {
        contractVersion = Contract.version; self.taskID = taskID; self.runID = runID; self.sourceSHA = sourceSHA
        self.manifestSHA256 = manifestSHA256; self.restoreOS = restoreOS; self.restoreBuild = restoreBuild; state = "prepared-empty"; guestStarted = false; installed = false
        setupComplete = false; toolchainVerified = false; freshIdentity = true
        self.hardwareSHA256 = hardwareSHA256; self.machineIdentifierSHA256 = machineIdentifierSHA256; self.files = files
    }
}
public struct Owner: Codable { public let taskID: String; public let uid: UInt32; public let device: Int32; public let inode: UInt64 }
public struct Prepared: Codable { public let runID: String; public let taskID: String; public let sourceSHA: String }
public struct WorkerReceipt: Codable {
    public var contractVersion = Contract.version
    public var startRequested = false
    public var runningObserved = false
    public var stoppedObserved = false
    public var stopRequested = false
    public var failure: String? = nil
    public var networkDevices = 0
    public var directoryShares = 0
    public var socketDevices = 0
    public var guestOutputTrusted = false
    public init() {}
}
public struct Receipt: Codable {
    public let contractVersion: String
    public let taskID: String
    public let runID: String
    public let sourceSHA: String
    public let outcome: String
    public let workerReaped: Bool
    public let teardownProven: Bool
    public let worker: WorkerReceipt?
    public let isolationEvidence: String
    public let guestAcceptance: Bool
    public init(contractVersion: String, taskID: String, runID: String, sourceSHA: String, outcome: String, workerReaped: Bool, teardownProven: Bool, worker: WorkerReceipt?, isolationEvidence: String, guestAcceptance: Bool) {
        self.contractVersion = contractVersion; self.taskID = taskID; self.runID = runID; self.sourceSHA = sourceSHA
        self.outcome = outcome; self.workerReaped = workerReaped; self.teardownProven = teardownProven
        self.worker = worker; self.isolationEvidence = isolationEvidence; self.guestAcceptance = guestAcceptance
    }
}
public enum Lifecycle {
    public static func teardownProven(worker: WorkerReceipt?, reaped: Bool, hardKillRequested: Bool) -> Bool {
        reaped && !hardKillRequested && worker?.stoppedObserved == true
    }
    public static func outcome(worker: WorkerReceipt?, reaped: Bool, interrupted: String?) -> String {
        guard reaped, let worker, worker.stoppedObserved else { return VMFailure.teardownUnknown.rawValue }
        if let interrupted { return interrupted }
        if let failure = worker.failure { return failure }
        return worker.runningObserved ? "stopped" : VMFailure.worker.rawValue
    }
}
public func writeJSON<T: Encodable>(_ object: T, to path: URL) throws {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(object)
    let temporary = path.deletingLastPathComponent().appendingPathComponent(".receipt-\(UUID().uuidString)")
    let fd = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard fd >= 0 else { throw VMFailure.path }
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    do { try handle.write(contentsOf: data); try handle.synchronize(); try handle.close(); guard rename(temporary.path, path.path) == 0 else { throw VMFailure.path } }
    catch { try? handle.close(); unlink(temporary.path); throw error }
}
