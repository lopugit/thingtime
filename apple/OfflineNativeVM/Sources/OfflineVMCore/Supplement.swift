import Foundation
import Darwin

/// Host-only immutable binding. Neither media contents nor this receipt establish guest readiness.
public struct ReadOnlySupplement: Codable, Equatable {
    public let contractVersion: String
    public let id: String
    public let taskID: String
    public let runID: String
    public let installedSourceSHA: String
    public let manifestSHA256: String
    public let candidateCommit: String
    public let relativePath: String
    public let imageSHA256: String
    public let mediaReceiptSHA256: String
    public let identity: FileIdentity
}

private struct BuildMediaHeader: Decodable {
    struct Image: Decodable { let file: String; let bytes: Int64; let sha256: String }
    let contractVersion: String
    let taskID: String
    let buildID: String
    let sourceCommit: String
    let input: Image
    let format: String
    let candidateAdmission: Bool
    let guestStarted: Bool
}

extension Workspace {
    /// Only an exact task's private builder output can become the fourth read-only disk.
    public func supplementURL(relativePath: String) throws -> URL {
        let parts = relativePath.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 4, parts[0] == "build-media", UUID(uuidString: parts[1]) == UUID(uuidString: owner.taskID),
              UUID(uuidString: parts[2]) != nil, parts[3] == "build-input.iso" else { throw VMFailure.path }
        let url = root.appendingPathComponent("inputs").appendingPathComponent(relativePath)
        try Self.privateDirectory(url.deletingLastPathComponent())
        return url
    }

    private func inspectSupplement(relativePath: String, expectedSHA256: String, candidateCommit: String) throws -> (URL, FileIdentity, String) {
        guard GuestManifest.digest(expectedSHA256), candidateCommit.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil else { throw VMFailure.manifest }
        for file in retainedSupplementFiles.values { try file.unchanged() }
        let url = try supplementURL(relativePath: relativePath)
        let image = try SecureFile(url)
        let identity = try FileIdentity(url)
        guard identity.bytes > 0, identity.bytes % 512 == 0, try image.hash() == expectedSHA256 else { throw VMFailure.integrity }
        let metadata = try SecureFile(url.deletingLastPathComponent().appendingPathComponent("media.json"))
        let header = try JSONDecoder().decode(BuildMediaHeader.self, from: metadata.data())
        guard header.contractVersion == Contract.version, UUID(uuidString: header.taskID) == UUID(uuidString: owner.taskID),
              header.buildID == url.deletingLastPathComponent().lastPathComponent,
              header.sourceCommit == candidateCommit, header.input.file == "build-input.iso",
              header.input.bytes == identity.bytes, header.input.sha256 == expectedSHA256,
              header.format == "RAW-UDF", !header.candidateAdmission, !header.guestStarted else { throw VMFailure.ownership }
        let metadataHash = try metadata.hash()
        try image.unchanged()
        retainedSupplementFiles = ["image": image, "metadata": metadata]
        return (url, identity, metadataHash)
    }

    /// Registration only: no VM/configuration construction, hotplug, copy, mount or guest operation.
    public func registerSupplement(_ runID: String, relativePath: String, expectedSHA256: String, candidateCommit: String) throws -> ReadOnlySupplement {
        try acquireLease()
        let run = try stoppedViewerRun(runID)
        let receipt = run.appendingPathComponent("viewer-supplement.json")
        var value = stat()
        guard lstat(receipt.path, &value) != 0, errno == ENOENT else { throw VMFailure.consumed }
        let (_, identity, metadataHash) = try inspectSupplement(relativePath: relativePath, expectedSHA256: expectedSHA256, candidateCommit: candidateCommit)
        let binding = ReadOnlySupplement(contractVersion: Contract.version, id: UUID().uuidString,
            taskID: owner.taskID, runID: runID, installedSourceSHA: manifest.sourceSHA, manifestSHA256: manifestHash,
            candidateCommit: candidateCommit, relativePath: relativePath, imageSHA256: expectedSHA256,
            mediaReceiptSHA256: metadataHash, identity: identity)
        try Preparation.writeExclusive(JSONEncoder().encode(binding), to: receipt)
        return binding
    }

    public func viewerSupplement(_ run: URL) throws -> ReadOnlySupplement? {
        let receipt = run.appendingPathComponent("viewer-supplement.json")
        var value = stat()
        if lstat(receipt.path, &value) != 0 {
            guard errno == ENOENT else { throw VMFailure.path }
            return nil
        }
        let binding = try JSONDecoder().decode(ReadOnlySupplement.self, from: SecureFile(receipt).data())
        guard binding.contractVersion == Contract.version, UUID(uuidString: binding.id) != nil,
              binding.taskID == owner.taskID, binding.runID == run.lastPathComponent,
              binding.installedSourceSHA == manifest.sourceSHA, binding.manifestSHA256 == manifestHash else { throw VMFailure.ownership }
        let (_, identity, metadataHash) = try inspectSupplement(relativePath: binding.relativePath,
            expectedSHA256: binding.imageSHA256, candidateCommit: binding.candidateCommit)
        guard identity == binding.identity, metadataHash == binding.mediaReceiptSHA256 else { throw VMFailure.integrity }
        return binding
    }

    public func verifiedSupplementURL(_ binding: ReadOnlySupplement, run: URL) throws -> URL {
        guard try viewerSupplement(run) == binding else { throw VMFailure.integrity }
        return try supplementURL(relativePath: binding.relativePath)
    }
}
