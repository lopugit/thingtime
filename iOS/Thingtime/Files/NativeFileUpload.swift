import AppleFileSync
import Foundation

/// File-backed PUT with no ambient credentials, no redirects, a bounded response
/// and cancellation that also covers a request waiting to start.
final class NativeFileUpload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    struct Measurement { let sent: Int64; let measured: Int64; let cellular: Bool? }
    private let lock = NSLock()
    private var task: URLSessionUploadTask?
    private var continuation: CheckedContinuation<Void, Error>?
    private var cancelled = false
    private var failure: Error?
    private var received = 0
    private var target: URL?
    private var accepted = false
    private var input: InputStream?
    private var callbackBytes: Int64 = 0
    private var metricBytes: Int64 = 0
    private var cellular: Bool?
    func measurement() -> Measurement {
        lock.lock(); defer { lock.unlock() }
        return .init(sent: max(callbackBytes, metricBytes), measured: metricBytes, cellular: cellular)
    }
    func cancel() {
        lock.lock(); cancelled = true; let current = task; lock.unlock(); current?.cancel()
    }
    func send(_ request: URLRequest, file: URL, configuration: URLSessionConfiguration = .ephemeral,
              rate: Int64? = nil, length: Int64 = 0, check: @escaping @Sendable () throws -> Void = {}) async throws {
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false; configuration.urlCache = nil
        configuration.timeoutIntervalForResource = rate.map { Self.timeout(length: length, rate: $0) } ?? 900
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        if let rate {
            let body = try PacedUploadBody(rate: rate, length: length, file: file, check: check)
            lock.withLock { input = body.input }
            let producer = Task.detached { [self] in
                do { try await body.produce() }
                catch { cancel(); throw error }
            }
            do {
                try await transfer(request, file: nil, session: session)
                try await producer.value
            } catch {
                producer.cancel()
                // A live power/network/source guard can be what cancelled
                // URLSession. Preserve that typed wait over its generic error.
                if case let .failure(failure) = await producer.result, !(failure is CancellationError) { throw failure }
                throw error
            }
        } else { try await transfer(request, file: file, session: session) }
    }

    static func timeout(length: Int64, rate: Int64) -> TimeInterval {
        min(86_400, max(900, 300 + Double(length) / Double(max(1, rate)) * 2))
    }

    private func transfer(_ request: URLRequest, file: URL?, session: URLSession) async throws {
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
                lock.lock()
                if cancelled { lock.unlock(); done.resume(throwing: CancellationError()); return }
                target = request.url; continuation = done
                let upload = file.map { session.uploadTask(with: request, fromFile: $0) } ?? session.uploadTask(withStreamedRequest: request)
                task = upload
                lock.unlock(); upload.resume()
            }
        }, onCancel: { self.cancel() })
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, needNewBodyStream completionHandler: @escaping (InputStream?) -> Void) {
        lock.lock(); let stream = input; input = nil; lock.unlock()
        // Refuse a silent HTTP retry; the durable runner accounts and retries.
        completionHandler(stream)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        lock.withLock { callbackBytes = max(callbackBytes, totalBytesSent) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        lock.withLock {
            let sent = metrics.transactionMetrics.filter { $0.countOfRequestBodyBytesSent > 0 }
            metricBytes = sent.reduce(0) { $0 + $1.countOfRequestBodyBytesSent }
            if let first = sent.first?.isCellular, sent.allSatisfy({ $0.isCellular == first }) { cellular = first }
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        lock.lock(); failure = MobileFolderStore.Failure.invalid; lock.unlock(); completionHandler(nil)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock()
        accepted = (response as? HTTPURLResponse).map { $0.url == target && (200..<300).contains($0.statusCode) } == true
            && response.expectedContentLength <= 65_536
        if !accepted { failure = MobileFolderStore.Failure.unavailable }
        let allow = accepted; lock.unlock(); completionHandler(allow ? .allow : .cancel)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); received += data.count
        let oversized = received > 65_536
        if oversized { failure = MobileFolderStore.Failure.limit }
        lock.unlock(); if oversized { dataTask.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let done = continuation; continuation = nil; self.task = nil
        callbackBytes = max(callbackBytes, task.countOfBytesSent)
        let result = failure ?? error ?? (cancelled ? CancellationError() : (!accepted ? MobileFolderStore.Failure.unavailable : nil))
        lock.unlock()
        if let result { done?.resume(throwing: result) } else { done?.resume() }
    }
}

/// A small bound stream is the sole source of request bytes. Every quantum is
/// paced against monotonic time and live policy, with no accumulated burst
/// credit when the network is stalled. A failed request is never reused.
private final class PacedUploadBody: @unchecked Sendable {
    let input: InputStream
    private let output: OutputStream
    private let rate: Int64, length: Int64
    private let file: URL
    private let check: @Sendable () throws -> Void

    init(rate: Int64, length: Int64, file: URL, check: @escaping @Sendable () throws -> Void) throws {
        var source: InputStream?, sink: OutputStream?
        Stream.getBoundStreams(withBufferSize: 16_384, inputStream: &source, outputStream: &sink)
        guard rate > 0, length > 0, let source, let sink else { throw MobileFolderStore.Failure.invalid }
        input = source; output = sink; self.rate = rate; self.length = length; self.file = file; self.check = check
    }

    func produce() async throws {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close(); output.close() }
        output.open()
        let quantum = max(1, min(16_384, rate / 10))
        var remaining = length
        while remaining > 0 {
            try Task.checkCancellation(); try check()
            let count = min(quantum, remaining)
            guard let bytes = try handle.read(upToCount: Int(count)), bytes.count == count else { throw MobileFolderStore.Failure.changed }
            let wait = max(1, Int64((Double(count) / Double(rate) * 1_000_000_000).rounded(.up)))
            try await Task.sleep(for: .nanoseconds(wait))
            var offset = 0
            while offset < bytes.count {
                try Task.checkCancellation(); try check()
                guard output.streamStatus != .error, output.streamStatus != .closed else { throw URLError(.networkConnectionLost) }
                if !output.hasSpaceAvailable { try await Task.sleep(for: .milliseconds(20)); continue }
                let written = bytes.withUnsafeBytes { buffer in
                    output.write(buffer.bindMemory(to: UInt8.self).baseAddress!.advanced(by: offset), maxLength: bytes.count - offset)
                }
                guard written >= 0 else { throw output.streamError ?? URLError(.networkConnectionLost) }
                if written == 0 { try await Task.sleep(for: .milliseconds(20)); continue }
                offset += written
            }
            remaining -= count
        }
    }
}
