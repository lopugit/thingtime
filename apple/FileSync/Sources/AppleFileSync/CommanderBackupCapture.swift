#if os(macOS)
import Foundation
import Darwin

extension MobileFolderReader {
    private struct CommanderRequest: Encodable {
        let version = 1
        let root: String
        let rootIdentity: String
        let excludedPaths: [String]
        let ignoreRules: String?
        let resourceLimits = Limits()
        struct Limits: Encodable {
            let maxThreads = 4, maxParallelism = 4, maxOpenDirectories = 16
            let maxCpuPercent = 60, maxMemoryMiB = 512
        }
    }
    private struct CommanderEvent: Decodable {
        let event: String
        let version: Int?
        let entry: Entry?
        let gap: Gap?
        struct Gap: Decodable { let path: String?; let reason: ScanFailure.Reason; let scope: BackupGap.Scope }
    }

    /// A task-owned helper from the signed app, not the user's Commander search
    /// database. Private pipes provide backpressure; the host keeps the bookmark
    /// scoped and revalidates returned paths before retaining provisional rows.
    static func captureBackupWithCommander(helper: URL, bookmark: Data, excludedPaths: [String], ignoreRules: String?,
                                          ignored: () throws -> Void, append: (Entry) throws -> Bool, skip: (BackupGap) throws -> Void) throws {
        let exclusions = try canonicalExclusions(excludedPaths), rules = try MobileFolderIgnoreRules(ignoreRules)
        try access(bookmark) { root in
            var path = [CChar](repeating: 0, count: Int(MAXPATHLEN))
            guard fcntl(root, F_GETPATH, &path) == 0 else { throw Failure.unavailable }
            let rootInfo = try info(root)
            let input = Pipe(), output = Pipe(), process = Process()
            process.executableURL = helper; process.arguments = ["backup"]
            process.environment = ["PATH": "/usr/bin:/bin"]
            process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
            try process.run()
            defer {
                try? input.fileHandleForWriting.close()
                try? output.fileHandleForReading.close()
                if process.isRunning {
                    process.terminate()
                    // Only this capture's child is eligible for escalation.
                    // A helper ignoring TERM must not hold cancellation forever.
                    for _ in 0..<20 { if !process.isRunning { break }; usleep(50_000) }
                    if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                }
            }
            let request = CommanderRequest(root: String(cString: path), rootIdentity: "\(rootInfo.st_dev):\(rootInfo.st_ino)",
                excludedPaths: exclusions, ignoreRules: rules.text)
            var requestData = try JSONEncoder().encode(request); requestData.append(10)
            try input.fileHandleForWriting.write(contentsOf: requestData); try input.fileHandleForWriting.close()
            let fd = output.fileHandleForReading.fileDescriptor
            guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else { throw Failure.storage }
            var bytes = Data(), buffer = [UInt8](repeating: 0, count: 65_536), hello = false, complete = false
            func consume(_ data: Data) throws {
                try Task.checkCancellation()
                let event = try JSONDecoder().decode(CommanderEvent.self, from: data)
                guard !complete else { throw Failure.storage }
                if !hello {
                    guard event.event == "hello", event.version == 1 else { throw Failure.storage }
                    hello = true; return
                }
                switch event.event {
                case "entry":
                    guard let entry = event.entry else { throw Failure.storage }
                    _ = try components(entry.path)
                    let key = entry.path.precomposedStringWithCanonicalMapping.lowercased()
                    guard !exclusions.contains(where: { key == $0 || key.hasPrefix($0 + "/") }),
                          !rules.ignores(entry.path, isDirectory: entry.kind == "folder") else { throw Failure.storage }
                    do {
                        let current = try openPath(root, path: entry.path); defer { close(current) }
                        let stat = try info(current), type = stat.st_mode & S_IFMT
                        guard stamp(stat) == entry.version, entry.id == "\(stat.st_dev):\(stat.st_ino)",
                              (entry.kind == "folder" && type == S_IFDIR && entry.size == 0 && entry.sha256 == nil && entry.fingerprint == nil) ||
                              (entry.kind == "file" && type == S_IFREG && entry.size == stat.st_size && validCommanderDigest(entry)) else { throw Failure.changed }
                        _ = try append(entry)
                    } catch Failure.unavailable { try skip(.init(path: entry.path, reason: .unreadable, scope: .subtree)) }
                    catch Failure.changed { try skip(.init(path: entry.path, reason: .changed, scope: .subtree)) }
                case "skipped":
                    guard let gap = event.gap else { throw Failure.storage }
                    let value = BackupGap(path: gap.path, reason: gap.reason, scope: gap.scope)
                    guard value.path == gap.path, value.reason == gap.reason, value.scope == gap.scope else { throw Failure.storage }
                    try skip(value)
                case "ignored": try ignored()
                case "complete": complete = true
                default: throw Failure.storage
                }
            }
            while true {
                try Task.checkCancellation()
                var ready = pollfd(fd: fd, events: Int16(POLLIN | POLLHUP), revents: 0)
                let polled = poll(&ready, 1, 100)
                if polled < 0 { if errno == EINTR { continue }; throw Failure.storage }
                if polled == 0 { continue }
                let count = Darwin.read(fd, &buffer, buffer.count)
                if count == 0 { break }
                if count < 0 { if errno == EAGAIN || errno == EINTR { continue }; throw Failure.storage }
                bytes.append(contentsOf: buffer.prefix(count))
                while let newline = bytes.firstIndex(of: 10) {
                    try consume(bytes.subdata(in: bytes.startIndex..<newline)); bytes.removeSubrange(bytes.startIndex...newline)
                }
                guard bytes.count <= 65_536 else { throw Failure.storage }
            }
            // stdout EOF is not proof that the child exited. Keep the native
            // job's cancellation/lifetime checks effective until it really does.
            while process.isRunning { try Task.checkCancellation(); usleep(50_000) }
            guard process.terminationStatus == 0, hello, complete, bytes.isEmpty else { throw Failure.storage }
            guard try info(root).st_dev == rootInfo.st_dev, try info(root).st_ino == rootInfo.st_ino else { throw Failure.changed }
            try Task.checkCancellation()
        }
    }

    /// The inventory replays folder rows from SQLite, keeping this check bounded
    /// even for millions of files. A changed nested directory is a coverage gap
    /// even when the root's own stamp stayed unchanged.
    static func recheckCommanderDirectories(bookmark: Data, replay: ((Entry) throws -> BackupGap?) throws -> Void) throws {
        try access(bookmark) { root in
            try replay { entry in
                guard entry.kind == "folder" else { return nil }
                try Task.checkCancellation()
                do {
                    let fd = try openPath(root, path: entry.path, directory: true); defer { close(fd) }
                    guard try stamp(info(fd)) == entry.version else { throw Failure.changed }
                } catch Failure.changed { return .init(path: entry.path, reason: .changed, scope: .subtree) }
                catch Failure.unavailable { return .init(path: entry.path, reason: .unreadable, scope: .subtree) }
                return nil
            }
        }
    }

    private static func validCommanderDigest(_ entry: Entry) -> Bool {
        func digest(_ value: String) -> Bool { value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
        if entry.size == 0 { return entry.fingerprint == nil && entry.sha256 == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }
        guard entry.size > 0, entry.sha256 == nil, let fp = entry.fingerprint else { return false }
        let mib: Int64 = 1_048_576, partSize = ((max(8 * mib, (entry.size + 9_999) / 10_000) + mib - 1) / mib) * mib
        return fp.algorithm == "sha256-parts-v1" && fp.partSizeBytes == partSize && fp.partCount == Int((entry.size + partSize - 1) / partSize) && digest(fp.sha256)
    }
}
#endif
