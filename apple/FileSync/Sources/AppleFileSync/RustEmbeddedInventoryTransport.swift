import Foundation
import CCommanderInventory

/// Uses the same Rust database and protocol as the desktop helper, without
/// spawning a process (which iOS does not permit). Only native code chooses DB.
public struct RustEmbeddedInventoryTransport: RustInventoryTransport {
    public let database: URL
    public init(database: URL) { self.database = database }
    public static var isAvailable: Bool { tt_inventory_available() }
    public static var `default`: Self {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ThingtimeIndex", isDirectory: true)
        return Self(database: directory.appendingPathComponent("filesystem-index.sqlite3"))
    }
    public func run(request: Data, isCancelled: @escaping @Sendable () -> Bool,
                    onLine: @escaping @Sendable (Data) throws -> Void) throws {
        guard Self.isAvailable else { throw RustInventoryTransportFailure.unavailable }
        guard !isCancelled() else { throw CancellationError() }
        try FileManager.default.createDirectory(at: database.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let path = Data(database.path.utf8)
        guard let session = path.withUnsafeBytes({ tt_inventory_create($0.bindMemory(to: UInt8.self).baseAddress, $0.count) }) else {
            throw RustInventoryTransportFailure.unavailable
        }
        // Output is backpressured to one bounded chunk. The original caller
        // consumes lines and checks cancellation even while Rust hashes a file.
        let channel = EmbeddedInventoryChannel(session: session)
        let context = Unmanaged.passUnretained(channel).toOpaque()
        DispatchQueue.global(qos: .utility).async {
            let status = request.withUnsafeBytes { bytes in
                tt_inventory_execute(channel.session, bytes.bindMemory(to: UInt8.self).baseAddress, bytes.count, context) { context, bytes, count in
                    guard let context, let bytes else { return false }
                    let channel = Unmanaged<EmbeddedInventoryChannel>.fromOpaque(context).takeUnretainedValue()
                    return channel.send(bytes: bytes, count: count)
                }
            }
            channel.finish(status)
        }
        var pending = Data()
        do {
            while true {
                guard !isCancelled() else { throw CancellationError() }
                let item = channel.receive()
                if let bytes = item.bytes {
                    pending.append(bytes)
                    while let end = pending.firstIndex(of: 10) {
                        let line = pending.subdata(in: pending.startIndex..<end)
                        guard !line.isEmpty else { throw RustInventoryTransportFailure.invalidResponse }
                        try onLine(line)
                        pending.removeSubrange(pending.startIndex...end)
                    }
                }
                if let status = item.status {
                    guard status != 3 else { throw CancellationError() }
                    guard status == 0 else {
                        var bytes = [UInt8](repeating: 0, count: 64)
                        let count = tt_inventory_error_code(session, &bytes, bytes.count)
                        let code = count > 0 ? String(decoding: bytes.prefix(count), as: UTF8.self) : "embedded_indexer_failed"
                        throw RustInventoryTransportFailure.operation(code)
                    }
                    guard pending.isEmpty else { throw RustInventoryTransportFailure.invalidResponse }
                    break
                }
            }
        } catch {
            channel.cancelAndJoin()
            tt_inventory_destroy(session)
            throw error
        }
        // All Rust execution and callbacks have joined before freeing session.
        tt_inventory_destroy(session)
    }
}

private final class EmbeddedInventoryChannel: @unchecked Sendable {
    let session: OpaquePointer
    private let condition = NSCondition()
    private var pending: Data?
    private var status: Int32?
    private var cancelled = false
    init(session: OpaquePointer) { self.session = session }
    func send(bytes: UnsafePointer<UInt8>, count: Int) -> Bool {
        // Rust writes may be large; transport chunks never require a second
        // unbounded copy or impose a maximum valid file size.
        var offset = 0
        while offset < count {
            condition.lock()
            while pending != nil && !cancelled { condition.wait() }
            if cancelled { condition.unlock(); return false }
            let length = min(65_536, count - offset)
            pending = Data(bytes: bytes.advanced(by: offset), count: length)
            offset += length
            condition.broadcast(); condition.unlock()
        }
        return true
    }
    func receive() -> (bytes: Data?, status: Int32?) {
        condition.lock(); defer { condition.unlock() }
        if pending == nil && status == nil { _ = condition.wait(until: Date().addingTimeInterval(0.05)) }
        let bytes = pending; pending = nil
        condition.broadcast()
        return (bytes, status)
    }
    func finish(_ result: Int32) {
        condition.lock(); status = result; condition.broadcast(); condition.unlock()
    }
    func cancelAndJoin() {
        condition.lock(); cancelled = true
        tt_inventory_cancel(session)
        condition.broadcast()
        while status == nil { condition.wait() }
        condition.unlock()
    }
}
