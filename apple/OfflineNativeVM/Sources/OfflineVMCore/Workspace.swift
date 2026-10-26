import Foundation
import Darwin
import CryptoKit

// Fresh offline guest provisioning and independent readiness admission are not implemented.
// Never convert imported manifest assertions into authority to boot an existing VM.
public enum PreparationAdmission { public static let available = false }

public final class SecureFile {
    public let url: URL
    public let fd: Int32
    private let initial: stat
    public init(_ url: URL) throws {
        self.url = url
        fd = open(url.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw VMFailure.path }
        var value = stat()
        guard fstat(fd, &value) == 0, (value.st_mode & S_IFMT) == S_IFREG,
              value.st_uid == geteuid(), value.st_nlink == 1, value.st_mode & 0o077 == 0 else {
            close(fd); throw VMFailure.ownership
        }
        initial = value
    }
    deinit { close(fd) }
    public func unchanged() throws {
        var value = stat(); var named = stat()
        guard fstat(fd, &value) == 0, lstat(url.path, &named) == 0,
              value.st_dev == initial.st_dev, value.st_ino == initial.st_ino,
              named.st_dev == initial.st_dev, named.st_ino == initial.st_ino,
              value.st_size == initial.st_size, value.st_nlink == 1,
              value.st_mtimespec.tv_sec == initial.st_mtimespec.tv_sec,
              value.st_mtimespec.tv_nsec == initial.st_mtimespec.tv_nsec,
              value.st_ctimespec.tv_sec == initial.st_ctimespec.tv_sec,
              value.st_ctimespec.tv_nsec == initial.st_ctimespec.tv_nsec else { throw VMFailure.integrity }
    }
    public func data() throws -> Data {
        try unchanged(); guard lseek(fd, 0, SEEK_SET) >= 0 else { throw VMFailure.path }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 1024*1024)
        while true {
            let count = read(fd, &buffer, buffer.count)
            guard count >= 0 else { throw VMFailure.path }
            if count == 0 { break }; data.append(contentsOf: buffer.prefix(count))
        }
        try unchanged(); return data
    }
    public func hash(copyTo destination: URL? = nil) throws -> String {
        try unchanged(); guard lseek(fd, 0, SEEK_SET) >= 0 else { throw VMFailure.path }
        let output: Int32
        if let destination {
            output = open(destination.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard output >= 0 else { throw VMFailure.path }
        } else { output = -1 }
        defer { if output >= 0 { close(output) } }
        var hasher = SHA256(); var buffer = [UInt8](repeating: 0, count: 1024*1024)
        while true {
            let count = read(fd, &buffer, buffer.count)
            guard count >= 0 else { throw VMFailure.path }
            if count == 0 { break }
            hasher.update(data: Data(buffer.prefix(count)))
            if output >= 0 {
                try buffer.withUnsafeBytes { bytes in
                    var offset = 0
                    while offset < count {
                        let n = write(output, bytes.baseAddress!.advanced(by: offset), count-offset)
                        guard n > 0 else { throw VMFailure.path }; offset += n
                    }
                }
            }
        }
        if output >= 0, fsync(output) != 0 { throw VMFailure.path }
        try unchanged()
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
public final class Workspace {
    public let root: URL
    public let owner: Owner
    public let manifest: GuestManifest
    public let manifestHash: String
    private var files: [String: SecureFile] = [:]
    private var lease: Int32 = -1
    public static func privateDirectory(_ url: URL) throws {
        guard url.path.hasPrefix("/"), !url.pathComponents.contains(".."), !url.pathComponents.contains(".") else { throw VMFailure.path }
        var current = URL(fileURLWithPath: "/")
        for component in url.pathComponents.dropFirst() {
            current.appendPathComponent(component)
            var s = stat()
            guard lstat(current.path, &s) == 0, s.st_mode & S_IFMT == S_IFDIR else { throw VMFailure.path }
        }
        var s = stat()
        guard lstat(url.path, &s) == 0, s.st_uid == geteuid(), s.st_mode & 0o077 == 0 else { throw VMFailure.ownership }
    }
    public static func initialize(parent: URL, taskID: String) throws -> URL {
        guard UUID(uuidString: taskID) != nil else { throw VMFailure.arguments }
        try privateDirectory(parent)
        let root = parent.appendingPathComponent(taskID)
        guard mkdir(root.path, 0o700) == 0 else { throw VMFailure.path }
        var s = stat(); guard lstat(root.path, &s) == 0 else { throw VMFailure.path }
        let owner = Owner(taskID: taskID, uid: geteuid(), device: s.st_dev, inode: s.st_ino)
        try writeJSON(owner, to: root.appendingPathComponent("owner.json"))
        for directory in ["inputs", "runs"] {
            guard mkdir(root.appendingPathComponent(directory).path, 0o700) == 0 else { throw VMFailure.path }
        }
        return root
    }
    public init(root: URL) throws {
        self.root = root; try Self.privateDirectory(root)
        owner = try JSONDecoder().decode(Owner.self, from: SecureFile(root.appendingPathComponent("owner.json")).data())
        var s = stat(); guard lstat(root.path, &s) == 0, owner.uid == geteuid(), owner.device == s.st_dev,
            owner.inode == s.st_ino, UUID(uuidString: owner.taskID) != nil else { throw VMFailure.ownership }
        let inputRoot = root.appendingPathComponent("inputs"); try Self.privateDirectory(inputRoot)
        let manifestFile = try SecureFile(inputRoot.appendingPathComponent("guest.json"))
        let raw = try manifestFile.data()
        // JSONDecoder ignores unknown keys; forbid alternate device/transport fields explicitly.
        let json = try JSONSerialization.jsonObject(with: raw) as? [String: Any]
        let allowed: Set<String> = ["contractVersion","taskID","sourceSHA","guestOS","architecture","toolchain","restoreImage","input","outputGiB","bootGiB","cpuCount","memoryGiB","deadlineSeconds"]
        guard let json, Set(json.keys) == allowed else { throw VMFailure.manifest }
        for key in ["restoreImage", "input"] {
            guard let disk = json[key] as? [String: Any], Set(disk.keys) == ["file", "sha256", "format"] else { throw VMFailure.manifest }
        }
        guard let toolchain = json["toolchain"] as? [String: Any], Set(toolchain.keys) == ["xcode", "macOSSDK", "simulatorSDK", "xcodegen", "offlineDependenciesSHA256"] else { throw VMFailure.manifest }
        manifest = try JSONDecoder().decode(GuestManifest.self, from: raw); try manifest.check()
        manifestHash = try manifestFile.hash()
        guard manifest.taskID == owner.taskID else { throw VMFailure.ownership }
        files["guest.json"] = manifestFile
        for disk in manifest.disks {
            let file = try SecureFile(inputRoot.appendingPathComponent(disk.file))
            guard try file.hash() == disk.sha256 else { throw VMFailure.integrity }
            if disk.format == "raw" {
                var statValue = stat()
                guard fstat(file.fd, &statValue) == 0, statValue.st_size > 0, statValue.st_size % 512 == 0 else { throw VMFailure.manifest }
            }
            files[disk.file] = file
        }
    }
    deinit { if lease >= 0 { close(lease) } }
    public func requireAdmission() throws {
        // No imported declarations or prepared-empty receipt establish installation/readiness.
        throw VMFailure.guestReadinessUnavailable
    }
    public func beginPreparation() throws -> (URL, Prepared) {
        guard lease < 0 else { throw VMFailure.consumed }
        let lockURL = root.appendingPathComponent("lease")
        lease = open(lockURL.path, O_WRONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        var s = stat()
        guard lease >= 0, fstat(lease, &s) == 0, s.st_uid == geteuid(), s.st_nlink == 1,
              s.st_mode & S_IFMT == S_IFREG, s.st_mode & 0o077 == 0, flock(lease, LOCK_EX | LOCK_NB) == 0 else { throw VMFailure.ownership }
        let consumed = open(root.appendingPathComponent("consumed").path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard consumed >= 0 else { throw VMFailure.consumed }; close(consumed)
        let runs = root.appendingPathComponent("runs"); try Self.privateDirectory(runs)
        let prepared = Prepared(runID: UUID().uuidString, taskID: owner.taskID, sourceSHA: manifest.sourceSHA)
        let run = runs.appendingPathComponent(prepared.runID)
        guard mkdir(run.path, 0o700) == 0 else { throw VMFailure.path }
        try writeJSON(prepared, to: run.appendingPathComponent("prepared.json"))
        return (run, prepared)
    }
    public func input(_ disk: Disk) throws -> URL { guard let file = files[disk.file] else { throw VMFailure.path }; try file.unchanged(); return file.url }
    public func data(_ disk: Disk) throws -> Data { guard let file = files[disk.file] else { throw VMFailure.path }; return try file.data() }
}
