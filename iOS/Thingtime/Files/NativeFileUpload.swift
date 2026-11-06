import AppleFileSync
import Foundation

/// File-backed PUT with no ambient credentials, no redirects, a bounded response
/// and cancellation that also covers a request waiting to start.
final class NativeFileUpload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var task: URLSessionUploadTask?
    private var continuation: CheckedContinuation<Void, Error>?
    private var cancelled = false
    private var failure: Error?
    private var received = 0
    private var target: URL?
    private var accepted = false
    func cancel() {
        lock.lock(); cancelled = true; let current = task; lock.unlock(); current?.cancel()
    }
    func send(_ request: URLRequest, file: URL, configuration: URLSessionConfiguration = .ephemeral) async throws {
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false; configuration.urlCache = nil
        configuration.timeoutIntervalForResource = 900
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
                lock.lock()
                if cancelled { lock.unlock(); done.resume(throwing: CancellationError()); return }
                target = request.url; continuation = done
                let upload = session.uploadTask(with: request, fromFile: file); task = upload
                lock.unlock(); upload.resume()
            }
        }, onCancel: { self.cancel() })
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
        let result = failure ?? error ?? (cancelled ? CancellationError() : (!accepted ? MobileFolderStore.Failure.unavailable : nil))
        lock.unlock()
        if let result { done?.resume(throwing: result) } else { done?.resume() }
    }
}
