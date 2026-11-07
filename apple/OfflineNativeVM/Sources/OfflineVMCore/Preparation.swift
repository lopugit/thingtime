import Foundation
import Darwin

public struct RestoreMetadata {
    public let hardware: Data
    public let operatingSystem: String
    public let build: String
    public init(hardware: Data, operatingSystem: String, build: String) {
        self.hardware = hardware; self.operatingSystem = operatingSystem; self.build = build
    }
}
public protocol FreshPreparationBackend {
    // Implementations must derive hardware from verified local Apple restore metadata,
    // create a new VZ identity, and initialize new auxiliary storage (never adopt a VM).
    func hardwareModel(restoreImage: URL) throws -> RestoreMetadata
    func freshMachineIdentifier() -> Data
    func createAuxiliary(at: URL, hardware: Data) throws
}
public enum Preparation {
    static func createDisk(_ path: URL, giB: UInt64) throws {
        guard giB > 0, giB <= UInt64(Int64.max)/(1024*1024*1024) else { throw VMFailure.manifest }
        let fd = open(path.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw VMFailure.path }; defer { close(fd) }
        guard ftruncate(fd, Int64(giB*1024*1024*1024)) == 0, fsync(fd) == 0 else { throw VMFailure.path }
    }
    static func writeExclusive(_ data: Data, to path: URL) throws {
        let fd = open(path.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw VMFailure.path }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        try handle.write(contentsOf: data); try handle.synchronize(); try handle.close()
    }
    public static func perform(workspace: Workspace, backend: FreshPreparationBackend) throws -> URL {
        let (run, prepared) = try workspace.beginPreparation() // One-shot even if metadata/setup fails.
        let restore = try workspace.input(workspace.manifest.restoreImage)
        let metadata = try backend.hardwareModel(restoreImage: restore)
        let hardware = metadata.hardware
        guard metadata.operatingSystem == workspace.manifest.guestOS else { throw VMFailure.configuration }
        guard !hardware.isEmpty else { throw VMFailure.configuration }
        let identity = backend.freshMachineIdentifier()
        guard !identity.isEmpty else { throw VMFailure.configuration }
        try writeExclusive(hardware, to: run.appendingPathComponent("hardware.bin"))
        try writeExclusive(identity, to: run.appendingPathComponent("machine-id.bin"))
        try createDisk(run.appendingPathComponent("boot.img"), giB: workspace.manifest.bootGiB)
        try createDisk(run.appendingPathComponent("output.img"), giB: workspace.manifest.outputGiB)
        let auxiliary = run.appendingPathComponent("auxiliary.bin")
        try backend.createAuxiliary(at: auxiliary, hardware: hardware)
        guard chmod(auxiliary.path, 0o600) == 0 else { throw VMFailure.path }
        var identities: [String: FileIdentity] = [:]
        for name in ["hardware.bin", "machine-id.bin", "boot.img", "output.img", "auxiliary.bin"] {
            identities[name] = try FileIdentity(run.appendingPathComponent(name))
        }
        // Recheck original opened inputs before recording provenance. No disk is mounted or VM started.
        _ = try workspace.input(workspace.manifest.restoreImage); _ = try workspace.input(workspace.manifest.input)
        let receipt = PreparationReceipt(taskID: prepared.taskID, runID: prepared.runID, sourceSHA: prepared.sourceSHA,
            manifestSHA256: workspace.manifestHash, restoreOS: metadata.operatingSystem, restoreBuild: metadata.build,
            hardwareSHA256: try SecureFile(run.appendingPathComponent("hardware.bin")).hash(),
            machineIdentifierSHA256: try SecureFile(run.appendingPathComponent("machine-id.bin")).hash(), files: identities)
        try writeJSON(receipt, to: run.appendingPathComponent("preparation.json"))
        return run
    }
}
