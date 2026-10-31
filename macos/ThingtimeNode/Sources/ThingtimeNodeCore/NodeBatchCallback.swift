import Foundation

private final class BatchCallbackReply: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?
    private var result: Result<Data, Error>?
    private var timer: Task<Void, Never>?
    func install(_ continuation: CheckedContinuation<Data, Error>) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if let result { continuation.resume(with: result); return false }
        self.continuation = continuation; return true
    }
    func timeout(_ seconds: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        guard result == nil else { return }
        timer = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(seconds)); self?.finish(.failure(CancellationError())) }
            catch { }
        }
    }
    func finish(_ result: Result<Data, Error>) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        self.result = result; let continuation = self.continuation; self.continuation = nil
        let timer = self.timer; self.timer = nil; lock.unlock()
        timer?.cancel(); continuation?.resume(with: result)
    }
}

public enum NodeBatchCallback {
    public static func exchange(_ peer: ThingtimeNodeBatchCallback, frame: JSONValue, timeout: TimeInterval) async throws -> JSONValue {
        try Task.checkCancellation()
        let governedPayload: Bool
        if case .object(let fields) = frame { governedPayload = fields["kind"] == .string("put-ready") && timeout == .infinity }
        else { governedPayload = false }
        guard timeout > 0, timeout <= 60 || governedPayload else { throw CancellationError() }
        let data = try JSONEncoder().encode(frame)
        guard data.count <= 100_000 else { throw ThingtimeNodeError.invalidRequest("Invalid batch callback.") }
        let reply = BatchCallbackReply()
        let response = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard reply.install(continuation) else { return }
                if timeout.isFinite { reply.timeout(timeout) }
                if Task.isCancelled { reply.finish(.failure(CancellationError())); return }
                peer.exchange(data) { value in
                    guard !value.isEmpty, value.count <= 524_288 else {
                        reply.finish(.failure(ThingtimeNodeError.invalidRequest("Invalid batch callback reply."))); return
                    }
                    reply.finish(.success(value))
                }
            }
        } onCancel: { reply.finish(.failure(CancellationError())) }
        try Task.checkCancellation()
        return try JSONDecoder().decode(JSONValue.self, from: response)
    }
}
