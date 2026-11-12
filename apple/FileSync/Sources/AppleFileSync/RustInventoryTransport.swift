import Foundation

/// Private native pipe or in-process Rust bridge. Each invocation consumes one
/// UTF-8 JSON request terminated by LF and delivers response lines without LF.
/// Transport implementations must call onLine serially on the caller's thread.
public protocol RustInventoryTransport: Sendable {
    func run(request: Data, isCancelled: @escaping @Sendable () -> Bool,
             onLine: @escaping @Sendable (Data) throws -> Void) throws
}

/// Streaming backup additionally uses a private stop message while stdout is live.
public protocol RustStreamingInventoryTransport: RustInventoryTransport {
    func runStreaming(request: Data, isCancelled: @escaping @Sendable () -> Bool,
                      nextInput: @escaping @Sendable () throws -> Data?,
                      onLine: @escaping @Sendable (Data) throws -> Void) throws
}

public enum RustInventoryTransportFailure: Error, LocalizedError, Sendable {
    case unavailable
    case invalidResponse
    /// Stable machine code only; never a helper message with local paths.
    case operation(String)

    public var errorDescription: String? {
        switch self {
        case .unavailable: return "The shared filesystem indexer is unavailable. Reopen or update the native app before indexing this folder."
        case .invalidResponse: return "The shared filesystem indexer returned an incompatible response. Update the native app and try again."
        case .operation("strict_watcher_unavailable"):
            return "This device cannot verify a complete folder capture. Use one-way backup."
        case .operation("strict_volume_unavailable"):
            return "This volume cannot verify a complete folder capture. Use one-way backup."
        case .operation("inventory_busy"):
            return "Another folder scan is using the shared filesystem index. Wait for it to finish or pause it before retrying."
        case .operation: return "The shared filesystem index is unavailable or the folder changed. Refresh and try again."
        }
    }
}

#if os(macOS)
import Darwin

public struct RustProcessInventoryTransport: RustStreamingInventoryTransport {
    public let database: URL
    private let helper: URL

    public init(helper: URL, database: URL = Self.defaultDatabase) {
        self.helper = helper; self.database = database
    }

    public static var defaultDatabase: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let path = ProcessInfo.processInfo.environment["COMMANDER_DATA_DIR"]
        let directory = path.flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0, isDirectory: true) }
            ?? home.appendingPathComponent("Library/Application Support/Commander", isDirectory: true)
        return directory.appendingPathComponent("filesystem-index.sqlite3")
    }

    public static var bundledHelper: URL? {
        // Packagers embed the signed helper. A command line test can inject its
        // own executable explicitly; never search PATH or pick a browser URL.
        Bundle.main.url(forAuxiliaryExecutable: "commander-indexer")
    }

    public func run(request: Data, isCancelled: @escaping @Sendable () -> Bool,
                    onLine: @escaping @Sendable (Data) throws -> Void) throws {
        try launch(command: "inventory", request: request, isCancelled: isCancelled, nextInput: nil, onLine: onLine)
    }

    public func runStreaming(request: Data, isCancelled: @escaping @Sendable () -> Bool,
                             nextInput: @escaping @Sendable () throws -> Data?,
                             onLine: @escaping @Sendable (Data) throws -> Void) throws {
        try launch(command: "backup", request: request, isCancelled: isCancelled, nextInput: nextInput, onLine: onLine)
    }

    private func launch(command: String, request: Data, isCancelled: @escaping @Sendable () -> Bool,
                        nextInput: (@Sendable () throws -> Data?)?, onLine: @escaping @Sendable (Data) throws -> Void) throws {
        guard FileManager.default.isExecutableFile(atPath: helper.path) else { throw RustInventoryTransportFailure.unavailable }
        guard !isCancelled() else { throw CancellationError() }
        let input = Pipe(), output = Pipe(), diagnostics = Pipe(), process = Process()
        process.executableURL = helper; process.arguments = [command, "--database", database.path]
        process.environment = ["PATH": "/usr/bin:/bin"]
        process.standardInput = input; process.standardOutput = output; process.standardError = diagnostics
        do { try process.run() } catch { throw RustInventoryTransportFailure.unavailable }
        defer {
            try? input.fileHandleForWriting.close()
            try? output.fileHandleForReading.close()
            try? diagnostics.fileHandleForReading.close()
            if process.isRunning {
                process.terminate()
                for _ in 0..<20 { if !process.isRunning { break }; usleep(50_000) }
                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            }
        }
        guard fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1) == 0 else {
            throw RustInventoryTransportFailure.invalidResponse
        }
        try input.fileHandleForWriting.write(contentsOf: request)
        if nextInput == nil { try input.fileHandleForWriting.close() }
        let fd = output.fileHandleForReading.fileDescriptor, err = diagnostics.fileHandleForReading.fileDescriptor
        guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0, fcntl(err, F_SETFL, O_NONBLOCK) == 0 else { throw RustInventoryTransportFailure.invalidResponse }
        var pending = Data(), errorPrefix = Data(), buffer = [UInt8](repeating: 0, count: 65_536)
        var streams = [pollfd(fd: fd, events: Int16(POLLIN | POLLHUP), revents: 0), pollfd(fd: err, events: Int16(POLLIN | POLLHUP), revents: 0)]
        while streams.contains(where: { $0.fd >= 0 }) || process.isRunning {
            guard !isCancelled() else { throw CancellationError() }
            if streams[0].fd >= 0, let message = try nextInput?() { try input.fileHandleForWriting.write(contentsOf: message) }
            let ready = poll(&streams, nfds_t(streams.count), 100)
            if ready < 0 { if errno == EINTR { continue }; throw RustInventoryTransportFailure.invalidResponse }
            if ready == 0 { continue }
            for index in streams.indices where streams[index].revents != 0 {
                let n = Darwin.read(streams[index].fd, &buffer, buffer.count)
                if n == 0 { streams[index].fd = -1; continue }
                if n < 0 { if errno == EAGAIN || errno == EINTR { continue }; throw RustInventoryTransportFailure.invalidResponse }
                if index == 1 {
                    if errorPrefix.count < 128 { errorPrefix.append(contentsOf: buffer.prefix(min(n, 128 - errorPrefix.count))) }
                    continue
                }
                pending.append(contentsOf: buffer.prefix(n))
                while let end = pending.firstIndex(of: 10) {
                    let line = pending.subdata(in: pending.startIndex..<end)
                    guard !line.isEmpty, line.count <= 1024 * 1024 else { throw RustInventoryTransportFailure.invalidResponse }
                    try onLine(line)
                    pending.removeSubrange(pending.startIndex...end)
                }
                guard pending.count <= 1024 * 1024 else { throw RustInventoryTransportFailure.invalidResponse }
            }
        }
        guard !isCancelled() else { throw CancellationError() }
        if process.terminationStatus != 0 {
            let code = errorPrefix.prefix(while: { $0 != 58 })
            guard (1...64).contains(code.count), code.allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || $0 == 95 }) else { throw RustInventoryTransportFailure.invalidResponse }
            throw RustInventoryTransportFailure.operation(String(decoding: code, as: UTF8.self))
        }
        guard pending.isEmpty else { throw RustInventoryTransportFailure.invalidResponse }
    }
}
#endif
