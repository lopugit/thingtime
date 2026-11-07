import Foundation

// One-shot arbitrary-thread callback handoff. Cancellation consumes the cell too:
// a late framework callback cannot publish into a timed-out preparation operation.
public final class LockedCompletion<Value> {
    private let lock = NSLock()
    private var pending = true
    private var value: Value?
    public init() {}
    @discardableResult public func complete(_ value: Value) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard pending else { return false }
        pending = false; self.value = value; return true
    }
    public func take() -> Value? {
        lock.lock(); defer { lock.unlock() }
        let result = value; value = nil; return result
    }
    public func cancel() {
        lock.lock(); defer { lock.unlock() }
        pending = false; value = nil
    }
}
