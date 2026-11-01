import Foundation

/// Dedicated one-operation duplex bridge. Indexed replies are closed callback
/// data, never executable commands. At most32 callbacks and one512KiB line live.
public final class NodeBatchDuplex: NSObject, ThingtimeNodeBatchCallback, @unchecked Sendable {
    private let input: FileHandle, output: FileHandle
    private let lock = NSLock()
    private var pending: [Int: (Data) -> Void] = [:], sequence = 0
    private var closed = false
    public init(input: FileHandle, output: FileHandle) { self.input = input; self.output = output }
    public func start() { Thread.detachNewThread { [self] in readReplies() } }
    public func exchange(_ data: Data, withReply reply: @escaping (Data) -> Void) {
        lock.lock()
        guard !closed, pending.count < 32, sequence < 4096, data.count <= 100_000,
              let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let kind = frame["kind"] as? String, ["prepare-ready", "chunk", "put-ready", "verify-ready"].contains(kind) else {
            lock.unlock(); reply(Data()); return
        }
        sequence += 1; let id = sequence; pending[id] = reply
        do {
            var bytes = try JSONSerialization.data(withJSONObject: ["type": "batch", "callbackId": id, "frame": frame]); bytes.append(10)
            try output.write(contentsOf: bytes); lock.unlock()
        } catch { lock.unlock(); fail() }
    }
    private func readReplies() {
        var line = Data()
        do {
            while true {
                let chunk = input.availableData
                guard !chunk.isEmpty else { break }
                for byte in chunk {
                    if byte == 10 { try accept(line); line.removeAll(keepingCapacity: true) }
                    else { guard line.count < 524_288 else { throw CancellationError() }; line.append(byte) }
                }
            }
        } catch { }
        fail()
    }
    private func accept(_ line: Data) throws {
        guard let object = try JSONSerialization.jsonObject(with: line) as? [String: Any],
              Set(object.keys) == ["callbackId", "reply"], let id = object["callbackId"] as? Int,
              let value = object["reply"], JSONSerialization.isValidJSONObject(value) else { throw CancellationError() }
        let data = try JSONSerialization.data(withJSONObject: value)
        lock.lock()
        guard !closed, let reply = pending.removeValue(forKey: id) else { lock.unlock(); throw CancellationError() }
        lock.unlock(); reply(data)
    }
    private func fail() {
        lock.lock(); closed = true; let replies = Array(pending.values); pending.removeAll(); lock.unlock()
        replies.forEach { $0(Data()) }
    }
    public func finish(_ data: Data) {
        lock.lock(); closed = true; let replies = Array(pending.values); pending.removeAll()
        if let object = try? JSONSerialization.jsonObject(with: data),
           var bytes = try? JSONSerialization.data(withJSONObject: ["type": "result", "response": object]) {
            bytes.append(10); try? output.write(contentsOf: bytes)
        }
        lock.unlock(); replies.forEach { $0(Data()) }
    }
}
