import CryptoKit
import Darwin
import Foundation

/// Home-relative, descriptor-based filesystem access. No shell, URL fetch,
/// symlink traversal, overwrites or permanent deletes are part of this contract.
public struct RemoteFilesystem {
    public static let chunkBytes = 65_536
    public static let maximumFileBytes = 32 * 1024 * 1024
    private let root: URL
    public init(root: URL = FileManager.default.homeDirectoryForCurrentUser) { self.root = root }

    static func components(_ path: String) throws -> [String] {
        guard path.utf8.count <= 1024, !path.hasPrefix("/"), !path.contains("\\"),
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) || $0.properties.generalCategory == .format }) else {
            throw ThingtimeNodeError.invalidRequest("Choose a path within the device home folder.")
        }
        if path.isEmpty { return [] }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard parts.count <= 64, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.hasPrefix(".thingtime-upload-") }) else {
            throw ThingtimeNodeError.invalidRequest("The filesystem path is invalid.")
        }
        return parts
    }

    static func validate(_ input: [String: JSONValue]) -> String? {
        do {
            guard let op = input["op"]?.stringValue, let path = input["path"]?.stringValue else { return "File operations require op and path." }
            _ = try components(path)
            let allowed: Set<String>
            switch op {
            case "list":
                allowed = ["op", "path", "cursor", "hidden"]
                if let cursor = input["cursor"] { guard let n = cursor.numberValue, n >= 0, n <= 10_000, n.rounded() == n else { return "Invalid directory cursor." } }
                if let hidden = input["hidden"], case .bool = hidden {} else if input["hidden"] != nil { return "Invalid hidden-file preference." }
            case "read":
                allowed = ["op", "path", "version", "offset"]
                guard validVersion(input["version"]), validOffset(input["offset"]) else { return "File reads require version and offset." }
            case "write":
                allowed = ["op", "path", "transferId", "offset", "total", "sha256", "data"]
                guard !path.isEmpty, let id = input["transferId"]?.stringValue, UUID(uuidString: id) != nil,
                      validOffset(input["offset"]), let total = input["total"]?.numberValue,
                      total >= 0, total <= Double(maximumFileBytes), total.rounded() == total,
                      let sha = input["sha256"]?.stringValue, sha.count == 64, sha.allSatisfy({ $0.isHexDigit && !$0.isUppercase }),
                      let encoded = input["data"]?.stringValue, encoded.utf8.count <= 87_384,
                      let data = Data(base64Encoded: encoded), data.count <= chunkBytes,
                      let offset = input["offset"]?.numberValue, offset + Double(data.count) <= total,
                      !data.isEmpty || total == 0 else { return "Invalid bounded file chunk." }
            case "copy", "move":
                allowed = ["op", "path", "destination", "version"]
                guard !path.isEmpty, validVersion(input["version"]), let destination = input["destination"]?.stringValue, !destination.isEmpty else { return "Choose a source and destination." }
                _ = try components(destination)
                guard destination != path, !destination.hasPrefix(path + "/") else { return "A folder cannot contain itself." }
            case "mkdir":
                allowed = ["op", "path"]
                guard !path.isEmpty else { return "Choose a new folder name." }
            case "trash":
                allowed = ["op", "path", "version"]
                guard !path.isEmpty, path != ".Trash", !path.hasPrefix(".Trash/"), validVersion(input["version"]) else { return "Choose an item outside Trash." }
            default: return "Unknown filesystem operation."
            }
            return Set(input.keys).isSubset(of: allowed) ? nil : "Unknown filesystem input field."
        } catch { return "Choose a valid path within the device home folder." }
    }

    private static func validVersion(_ value: JSONValue?) -> Bool {
        guard let s = value?.stringValue else { return false }
        return !s.isEmpty && s.utf8.count <= 160 && s.allSatisfy { $0.isNumber || $0 == ":" || $0 == "-" }
    }
    private static func validOffset(_ value: JSONValue?) -> Bool {
        guard let n = value?.numberValue else { return false }
        return n.isFinite && n >= 0 && n <= Double(maximumFileBytes) && n.rounded() == n
    }
    private func failure() -> ThingtimeNodeError { .policyDenied("The file is unavailable, changed, already exists, or macOS denied access. Refresh the folder and try again.") }
    private func openPath(_ path: String, directory: Bool = false) throws -> Int32 {
        let parts = try Self.components(path)
        var fd = Darwin.open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw failure() }
        for (index, name) in parts.enumerated() {
            let next = openat(fd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK | ((index < parts.count - 1 || directory) ? O_DIRECTORY : 0))
            close(fd)
            guard next >= 0 else { throw failure() }
            fd = next
        }
        return fd
    }
    private func parent(_ path: String) throws -> (Int32, String) {
        let parts = try Self.components(path)
        guard let name = parts.last else { throw failure() }
        return (try openPath(parts.dropLast().joined(separator: "/"), directory: true), name)
    }
    private func info(_ fd: Int32) throws -> stat {
        var value = stat()
        guard fstat(fd, &value) == 0 else { throw failure() }
        return value
    }
    private func version(_ value: stat) -> String {
        "\(value.st_dev):\(value.st_ino):\(value.st_size):\(value.st_mtimespec.tv_sec):\(value.st_mtimespec.tv_nsec):\(value.st_ctimespec.tv_sec):\(value.st_ctimespec.tv_nsec)"
    }
    private func entry(_ value: stat, path: String, name: String) -> JSONValue {
        let type = value.st_mode & S_IFMT
        return .object([
            "path": .string(path), "name": .string(name),
            "type": .string(type == S_IFDIR ? "folder" : type == S_IFREG ? "file" : type == S_IFLNK ? "symlink" : "other"),
            "inode": .string("\(value.st_dev):\(value.st_ino)"), "version": .string(version(value)),
            "size": .number(Double(value.st_size)),
            "modifiedAt": .string(ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: Double(value.st_mtimespec.tv_sec))))
        ])
    }
    private func names(_ fd: Int32, includeStaging: Bool = false) throws -> [String] {
        let listingFD = openat(fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard listingFD >= 0 else { throw failure() }
        guard let directory = fdopendir(listingFD) else { close(listingFD); throw failure() }
        defer { closedir(directory) }
        var values: [String] = []
        while let ent = readdir(directory) {
            let name = withUnsafePointer(to: &ent.pointee.d_name) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: Int(ent.pointee.d_namlen) + 1) { String(cString: $0) }
            }
            if name == "." || name == ".." || (!includeStaging && name.hasPrefix(".thingtime-upload-")) { continue }
            values.append(name)
            guard values.count <= 10_000 else { throw ThingtimeNodeError.policyDenied("This folder exceeds the 10,000-entry browsing limit.") }
        }
        return values.sorted { $0.utf8.lexicographicallyPrecedes($1.utf8) }
    }

    // Interrupted chunks are private temporary files, reclaimed after 24 hours
    // when this directory is next browsed or written. Never follow links or
    // remove an active/foreign file; mutation receipts remain in the journal.
    private func clearExpiredUploads(_ directory: Int32) {
        guard let children = try? names(directory, includeStaging: true) else { return }
        for name in children where name.hasPrefix(".thingtime-upload-") {
            let suffix = String(name.dropFirst(".thingtime-upload-".count))
            guard suffix.count == 101, UUID(uuidString: String(suffix.prefix(36))) != nil,
                  suffix.dropFirst(36).first == "-", suffix.suffix(64).allSatisfy({ $0.isHexDigit }) else { continue }
            let fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
            guard fd >= 0 else { continue }
            defer { close(fd) }
            guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { continue }
            defer { flock(fd, LOCK_UN) }
            guard let value = try? info(fd), value.st_mode & S_IFMT == S_IFREG,
                  value.st_uid == geteuid(), value.st_nlink == 1,
                  Date().timeIntervalSince1970 - Double(value.st_mtimespec.tv_sec) > 86_400 else { continue }
            var current = stat()
            guard fstatat(directory, name, &current, AT_SYMLINK_NOFOLLOW) == 0,
                  version(current) == version(value) else { continue }
            unlinkat(directory, name, 0)
        }
    }

    public func execute(_ input: [String: JSONValue]) throws -> JSONValue {
        if let invalid = Self.validate(input) { throw ThingtimeNodeError.invalidRequest(invalid) }
        let op = input["op"]!.stringValue!, path = input["path"]!.stringValue!
        if op == "write" { return .object(["filesystem": try write(input, path: path)]) }
        if op == "mkdir" {
            let (fd, name) = try parent(path); defer { close(fd) }
            guard mkdirat(fd, name, 0o700) == 0 else { throw failure() }
            return .object(["filesystem": .object(["path": .string(path)])])
        }
        let fd = try openPath(path, directory: op == "list"); defer { close(fd) }
        let before = try info(fd)
        if let expected = input["version"]?.stringValue, expected != version(before) { throw failure() }
        let result: JSONValue
        switch op {
        case "list":
            clearExpiredUploads(fd)
            let showHidden = input["hidden"] == .bool(true)
            let all = try names(fd).filter { showHidden || !$0.hasPrefix(".") }
            let offset = Int(input["cursor"]?.numberValue ?? 0)
            guard offset <= all.count else { throw failure() }
            let page = all.dropFirst(offset).prefix(25)
            var entries: [JSONValue] = []
            for name in page {
                guard (try? Self.components(path.isEmpty ? name : path + "/" + name)) != nil else {
                    throw ThingtimeNodeError.policyDenied("This directory contains a filename that cannot be represented safely. Rename that item locally before browsing it.")
                }
                var value = stat()
                guard fstatat(fd, name, &value, AT_SYMLINK_NOFOLLOW) == 0 else { continue }
                entries.append(entry(value, path: path.isEmpty ? name : path + "/" + name, name: name))
            }
            result = .object(["path": .string(path), "entries": .array(entries), "nextCursor": offset + page.count < all.count ? .number(Double(offset + page.count)) : .null])
        case "read":
            guard before.st_mode & S_IFMT == S_IFREG, before.st_size <= Self.maximumFileBytes else { throw failure() }
            let offset = Int(input["offset"]!.numberValue!)
            guard offset <= before.st_size else { throw failure() }
            var bytes = [UInt8](repeating: 0, count: min(Self.chunkBytes, Int(before.st_size) - offset))
            let count = bytes.withUnsafeMutableBytes { pread(fd, $0.baseAddress, $0.count, off_t(offset)) }
            guard count >= 0, version(try info(fd)) == version(before) else { throw failure() }
            result = .object(["data": .string(Data(bytes.prefix(count)).base64EncodedString()), "offset": .number(Double(offset)), "size": .number(Double(before.st_size)), "version": .string(version(before))])
        case "copy", "move", "trash":
            guard before.st_mode & S_IFMT == S_IFDIR || before.st_mode & S_IFMT == S_IFREG else { throw failure() }
            let destination: String
            if op == "trash" {
                let rootFD = try openPath("", directory: true); defer { close(rootFD) }
                if mkdirat(rootFD, ".Trash", 0o700) != 0 && errno != EEXIST { throw failure() }
                var label = try Self.components(path).last!
                while label.utf8.count > 180 { label.removeLast() }
                destination = ".Trash/" + UUID().uuidString + "-" + label
            } else { destination = input["destination"]!.stringValue! }
            let (targetFD, targetName) = try parent(destination); defer { close(targetFD) }
            if op == "copy" {
                var budget = (entries: 0, bytes: 0)
                let staging = ".thingtime-upload-copy-" + UUID().uuidString
                guard mkdirat(targetFD, staging, 0o700) == 0 else { throw failure() }
                let stagingFD = openat(targetFD, staging, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard stagingFD >= 0 else { throw failure() }
                defer { clearStaging(stagingFD); close(stagingFD); unlinkat(targetFD, staging, AT_REMOVEDIR) }
                try copy(fd, into: stagingFD, name: "item", budget: &budget)
                guard renameatx_np(stagingFD, "item", targetFD, targetName, UInt32(RENAME_EXCL)) == 0 else { throw failure() }
            } else {
                let (sourceFD, sourceName) = try parent(path); defer { close(sourceFD) }
                var current = stat()
                guard fstatat(sourceFD, sourceName, &current, AT_SYMLINK_NOFOLLOW) == 0, version(current) == version(before),
                      renameatx_np(sourceFD, sourceName, targetFD, targetName, UInt32(RENAME_EXCL)) == 0 else { throw failure() }
            }
            result = .object(["path": .string(destination)])
        default: throw failure()
        }
        return .object(["filesystem": result])
    }

    private func clearStaging(_ fd: Int32) {
        guard let children = try? names(fd) else { return }
        for name in children {
            let child = openat(fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            if child >= 0 { clearStaging(child); close(child); unlinkat(fd, name, AT_REMOVEDIR) }
            else { unlinkat(fd, name, 0) }
        }
    }

    private func copy(_ source: Int32, into parentFD: Int32, name: String, budget: inout (entries: Int, bytes: Int)) throws {
        let before = try info(source)
        budget.entries += 1
        guard budget.entries <= 500 else { throw ThingtimeNodeError.policyDenied("Copy at most 500 items at a time.") }
        if before.st_mode & S_IFMT == S_IFDIR {
            guard mkdirat(parentFD, name, 0o700) == 0 else { throw failure() }
            let target = openat(parentFD, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard target >= 0 else { throw failure() }; defer { close(target) }
            for child in try names(source) {
                let fd = openat(source, child, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
                guard fd >= 0 else { throw failure() }; defer { close(fd) }
                try copy(fd, into: target, name: child, budget: &budget)
            }
        } else {
            guard before.st_mode & S_IFMT == S_IFREG else { throw failure() }
            budget.bytes += Int(before.st_size)
            guard budget.bytes <= Self.maximumFileBytes else { throw ThingtimeNodeError.policyDenied("Copy at most 32 MiB at a time.") }
            let target = openat(parentFD, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard target >= 0 else { throw failure() }; defer { close(target) }
            var offset = 0
            while offset < before.st_size {
                var bytes = [UInt8](repeating: 0, count: min(Self.chunkBytes, Int(before.st_size) - offset))
                let count = bytes.withUnsafeMutableBytes { pread(source, $0.baseAddress, $0.count, off_t(offset)) }
                guard count > 0 else { throw failure() }
                try writeAll(Data(bytes.prefix(count)), to: target, offset: offset)
                offset += count
            }
            guard fsync(target) == 0 else { throw failure() }
        }
        guard version(try info(source)) == version(before) else { throw failure() }
    }

    private func writeAll(_ data: Data, to fd: Int32, offset: Int) throws {
        try data.withUnsafeBytes { bytes in
            var written = 0
            while written < data.count {
                let count = pwrite(fd, bytes.baseAddress!.advanced(by: written), data.count - written, off_t(offset + written))
                guard count > 0 else { throw failure() }
                written += count
            }
        }
    }

    private func write(_ input: [String: JSONValue], path: String) throws -> JSONValue {
        let (parentFD, name) = try parent(path); defer { close(parentFD) }
        clearExpiredUploads(parentFD)
        let transferID = input["transferId"]!.stringValue!, offset = Int(input["offset"]!.numberValue!)
        let total = Int(input["total"]!.numberValue!), digest = input["sha256"]!.stringValue!
        let data = Data(base64Encoded: input["data"]!.stringValue!)!
        // Include the destination and digest in the staging identity. A chunk
        // for a different destination cannot append to an earlier transfer.
        let binding = SHA256.hash(data: Data((path + ":" + digest + ":" + String(total)).utf8)).map { String(format: "%02x", $0) }.joined()
        let staging = ".thingtime-upload-" + transferID + "-" + binding
        let fd = openat(parentFD, staging, O_RDWR | O_NOFOLLOW | O_CLOEXEC | (offset == 0 ? O_CREAT : 0), 0o600)
        guard fd >= 0 else { throw failure() }; defer { close(fd) }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { throw failure() }; defer { flock(fd, LOCK_UN) }
        let state = try info(fd)
        guard state.st_mode & S_IFMT == S_IFREG, state.st_nlink == 1, state.st_size <= total else { throw failure() }
        if state.st_size == offset { try writeAll(data, to: fd, offset: offset) }
        else {
            guard state.st_size >= offset + data.count else { throw failure() }
            var old = [UInt8](repeating: 0, count: data.count)
            let count = old.withUnsafeMutableBytes { pread(fd, $0.baseAddress, $0.count, off_t(offset)) }
            guard count == data.count, Data(old) == data else { throw failure() }
        }
        let complete = offset + data.count == total
        if complete {
            defer { unlinkat(parentFD, staging, 0) }
            var hasher = SHA256(), position = 0
            while position < total {
                var bytes = [UInt8](repeating: 0, count: min(Self.chunkBytes, total - position))
                let count = bytes.withUnsafeMutableBytes { pread(fd, $0.baseAddress, $0.count, off_t(position)) }
                guard count > 0 else { throw failure() }
                hasher.update(data: Data(bytes.prefix(count))); position += count
            }
            guard hasher.finalize().map({ String(format: "%02x", $0) }).joined() == digest, fsync(fd) == 0,
                  renameatx_np(parentFD, staging, parentFD, name, UInt32(RENAME_EXCL)) == 0 else { throw failure() }
        }
        return .object(["path": .string(path), "offset": .number(Double(offset + data.count)), "complete": .bool(complete)])
    }
}
