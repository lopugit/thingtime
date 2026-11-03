import Foundation
import Darwin

/// A committed share is entirely local, independent of the selected web origin/account.
final class ShareInbox {
    struct Batch {
        let id: UUID
        let directory: URL
        var payload: URL { directory.appendingPathComponent("payload", isDirectory: true) }
    }
    enum Failure: LocalizedError {
        case unavailable, empty, unsafeFile
        case waitingBatches(Int)
        var errorDescription: String? {
            switch self {
            case .unavailable: return "Local shared storage is unavailable. Open Thingtime once and try again."
            case .empty: return "The source did not provide any files or text to save."
            case .unsafeFile: return "The source provided an unsupported symbolic link or special file."
            case .waitingBatches(let count): return "\(count) saved share batches could not be moved into Files. They remain in local shared storage; unlock the device, check available storage and try again."
            }
        }
    }
    private let root: URL
    private let files: FileManager
    init(root: URL, files: FileManager = .default) {
        self.root = root
        self.files = files
    }
    static func shared() throws -> ShareInbox {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "ThingtimeWidgetGroup") as? String,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
        else { throw Failure.unavailable }
        return ShareInbox(root: container.appendingPathComponent("ShareInbox", isDirectory: true))
    }
    /// Do not describe an unavailable container as pending saved shares. Actual
    /// committed-batch failures still throw so the host can offer retry.
    @discardableResult static func drainAvailable(to destination: URL, makeInbox: () throws -> ShareInbox = ShareInbox.shared) throws -> Bool {
        let inbox: ShareInbox
        do { inbox = try makeInbox() } catch Failure.unavailable { return false }
        try inbox.drain(to: destination)
        return true
    }
    func begin() throws -> Batch {
        let id = UUID()
        let directory = root.appendingPathComponent("staging/\(id.uuidString)", isDirectory: true)
        let batch = Batch(id: id, directory: directory)
        try createDirectory(batch.payload)
        return batch
    }
    func rollback(_ batch: Batch) { try? files.removeItem(at: batch.directory) }
    func commit(_ batch: Batch) throws {
        guard !(try files.contentsOfDirectory(atPath: batch.payload.path)).isEmpty else { throw Failure.empty }
        try Data(batch.id.uuidString.utf8).write(to: batch.directory.appendingPathComponent("receipt"), options: .atomic)
        try createDirectory(root.appendingPathComponent("ready", isDirectory: true))
        try files.moveItem(at: batch.directory, to: root.appendingPathComponent("ready/\(batch.id.uuidString)", isDirectory: true))
    }
    func uniqueURL(in directory: URL, suggestedName: String) -> URL {
        let cleaned = (suggestedName as NSString).lastPathComponent
        let name = cleaned.isEmpty || cleaned == "." || cleaned == ".." ? "Shared item" : cleaned
        var target = directory.appendingPathComponent(name)
        var index = 2
        while files.fileExists(atPath: target.path) {
            let stem = (name as NSString).deletingPathExtension
            let ext = (name as NSString).pathExtension
            target = directory.appendingPathComponent("\(stem) (\(index))\(ext.isEmpty ? "" : ".\(ext)")")
            index += 1
        }
        return target
    }
    /// Anchor the selected root once. Descendants are opened relative to held
    /// directory descriptors, never through paths a sender can replace mid-copy.
    func copy(_ source: URL, into directory: URL, suggestedName: String? = nil, checkCancellation: () throws -> Void = {}) throws -> URL {
        try checkCancellation()
        let descriptor = source.withUnsafeFileSystemRepresentation { pointer in
            pointer.map { open($0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK) } ?? -1
        }
        guard descriptor >= 0 else { throw descriptorError() }
        defer { close(descriptor) }
        return try copyDescriptor(descriptor, into: directory, name: suggestedName ?? source.lastPathComponent, checkCancellation: checkCancellation)
    }
    private func descriptorError() -> Error {
        if errno == ELOOP || errno == ENOTDIR { return Failure.unsafeFile }
        return NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }
    private func copyDescriptor(_ descriptor: Int32, into directory: URL, name: String, checkCancellation: () throws -> Void) throws -> URL {
        try checkCancellation()
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0 else { throw descriptorError() }
        let kind = metadata.st_mode & mode_t(S_IFMT)
        guard kind == mode_t(S_IFREG) || kind == mode_t(S_IFDIR) else { throw Failure.unsafeFile }
        let target = uniqueURL(in: directory, suggestedName: name)
        do {
            if kind == mode_t(S_IFDIR) {
                try createDirectory(target)
                let duplicate = dup(descriptor)
                guard duplicate >= 0 else { throw descriptorError() }
                guard let stream = fdopendir(duplicate) else { close(duplicate); throw descriptorError() }
                defer { closedir(stream) }
                while true {
                    errno = 0
                    guard let entry = readdir(stream) else {
                        if errno != 0 { throw descriptorError() }
                        break
                    }
                    let childName = withUnsafePointer(to: entry.pointee.d_name) {
                        $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) { String(cString: $0) }
                    }
                    if childName == "." || childName == ".." { continue }
                    try checkCancellation()
                    let child = openat(descriptor, childName, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
                    guard child >= 0 else { throw descriptorError() }
                    defer { close(child) }
                    _ = try copyDescriptor(child, into: target, name: childName, checkCancellation: checkCancellation)
                }
            } else {
                guard files.createFile(atPath: target.path, contents: nil,
                                       attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw CocoaError(.fileWriteUnknown) }
                let input = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
                let output = try FileHandle(forWritingTo: target)
                defer { try? output.close() }
                while true {
                    try checkCancellation()
                    guard let bytes = try input.read(upToCount: 1024 * 1024), !bytes.isEmpty else { break }
                    try output.write(contentsOf: bytes)
                }
                try output.synchronize()
            }
            let created = Date(timeIntervalSince1970: Double(metadata.st_birthtimespec.tv_sec) + Double(metadata.st_birthtimespec.tv_nsec) / 1_000_000_000)
            let modified = Date(timeIntervalSince1970: Double(metadata.st_mtimespec.tv_sec) + Double(metadata.st_mtimespec.tv_nsec) / 1_000_000_000)
            try files.setAttributes([.creationDate: created, .modificationDate: modified], ofItemAtPath: target.path)
            try checkCancellation()
            return target
        } catch { try? files.removeItem(at: target); throw error }
    }
    private func createDirectory(_ directory: URL) throws {
        try files.createDirectory(at: directory, withIntermediateDirectories: true,
                                  attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    }
    /// Idempotent across termination: copy privately, publish by rename, then acknowledge.
    func drain(to sharedDirectory: URL) throws {
        let ready = root.appendingPathComponent("ready", isDirectory: true)
        guard files.fileExists(atPath: ready.path) else { return }
        try createDirectory(sharedDirectory)
        var failures = 0
        for source in try files.contentsOfDirectory(at: ready, includingPropertiesForKeys: nil) {
            do { try drainBatch(source, to: sharedDirectory) } catch { failures += 1 }
        }
        if failures > 0 { throw Failure.waitingBatches(failures) }
    }
    private func drainBatch(_ source: URL, to sharedDirectory: URL) throws {
            guard let id = UUID(uuidString: source.lastPathComponent),
                  try String(contentsOf: source.appendingPathComponent("receipt"), encoding: .utf8) == id.uuidString else {
                throw Failure.unsafeFile
            }
            let destination = sharedDirectory.appendingPathComponent(id.uuidString, isDirectory: true)
            let acknowledgement = destination.appendingPathComponent(".thingtime-share-receipt")
            if files.fileExists(atPath: destination.path) {
                guard (try? String(contentsOf: acknowledgement, encoding: .utf8)) == id.uuidString else { throw CocoaError(.fileWriteFileExists) }
            } else {
                let incoming = sharedDirectory.appendingPathComponent(".incoming-\(id.uuidString)", isDirectory: true)
                // Only this batch's private unpublished copy is ever replaced.
                if files.fileExists(atPath: incoming.path) { try files.removeItem(at: incoming) }
                try createDirectory(incoming)
                do {
                    let payload = incoming.appendingPathComponent("Files", isDirectory: true)
                    try createDirectory(payload)
                    for file in try files.contentsOfDirectory(at: source.appendingPathComponent("payload"), includingPropertiesForKeys: nil) {
                        _ = try copy(file, into: payload)
                    }
                    try Data(id.uuidString.utf8).write(to: incoming.appendingPathComponent(".thingtime-share-receipt"), options: .atomic)
                    try files.moveItem(at: incoming, to: destination)
                } catch { try? files.removeItem(at: incoming); throw error }
            }
            try files.removeItem(at: source)
    }
}
