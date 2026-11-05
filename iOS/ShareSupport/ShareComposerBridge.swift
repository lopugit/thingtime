import Foundation
import WebKit

/// Narrow extension-safe bridge, shared by the extension and recovery webview.
/// Auth remains in the webview's ordinary origin-scoped cookie store.
final class ShareComposerBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "thingtimeShare"
    private let origin: URL
    private let allowedRequest: UUID?
    private let queue = DispatchQueue(label: "com.thingtime.share-composer")
    private var session: ShareComposerSession?
    private let makeInbox: () throws -> ShareInbox
    weak var webView: WKWebView?
    var onComplete: (() -> Void)?

    init(origin: URL, requestId: UUID? = nil, makeInbox: @escaping () throws -> ShareInbox = ShareInbox.shared) {
        self.origin = origin; allowedRequest = requestId; self.makeInbox = makeInbox
    }
    static func script(origin: URL) -> WKUserScript {
        let expected = ShareComposerSession.origin(origin)
        let encoded = (try? JSONSerialization.data(withJSONObject: [expected])).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return WKUserScript(source: """
        (() => {
          if (location.origin !== \(encoded)[0] || window.top !== window) return;
          Object.defineProperty(window, 'thingtimeShare', { configurable: false, value: Object.freeze({
            version: '1.0.0',
            request: body => window.webkit.messageHandlers.thingtimeShare.postMessage(body)
          }) });
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.name == Self.name, message.frameInfo.isMainFrame,
              let webView, message.webView === webView, let current = webView.url,
              ShareComposerSession.origin(current) == ShareComposerSession.origin(origin),
              let frame = message.frameInfo.request.url,
              ShareComposerSession.origin(frame) == ShareComposerSession.origin(origin),
              current.path == "/share", let components = URLComponents(url: current, resolvingAgainstBaseURL: false),
              let rawId = components.queryItems?.first(where: { $0.name == "requestId" })?.value,
              let id = UUID(uuidString: rawId), allowedRequest == nil || allowedRequest == id,
              let body = message.body as? [String: Any], let method = body["method"] as? String else {
            replyHandler(nil, "Share access is restricted to the selected Thingtime composer.")
            return
        }
        if method == "manifest" {
            replyHandler(["version": ShareComposerSession.version, "origin": ShareComposerSession.origin(origin),
                          "requestId": id.uuidString, "maxChunkBytes": ShareComposerSession.maxChunkBytes,
                          "thumbnailMaxDimension": 640, "thumbnailMaxBytes": 512 * 1024], nil)
            return
        }
        guard let requestId = body["requestId"] as? String, UUID(uuidString: requestId) == id,
              let account = body["accountId"] as? String, !account.isEmpty else { replyHandler(nil, "An authenticated account and matching share are required."); return }
        queue.async { [weak self] in
            guard let self else { return }
            do {
                if self.session?.id != id { self.session = try ShareComposerSession(inbox: self.makeInbox(), id: id, origin: self.origin) }
                guard let session = self.session else { throw ShareComposerSession.Failure.unavailable }
                let result: Any
                switch method {
                case "getIncomingShare": result = try session.incoming(accountId: account)
                case "read":
                    guard let fileId = body["fileId"] as? String,
                          let offset = body["offset"] as? NSNumber, let length = body["length"] as? NSNumber,
                          CFGetTypeID(offset) != CFBooleanGetTypeID(), CFGetTypeID(length) != CFBooleanGetTypeID(),
                          offset.doubleValue.isFinite, offset.doubleValue >= 0, offset.doubleValue.rounded() == offset.doubleValue,
                          offset.doubleValue <= 9_007_199_254_740_991,
                          length.doubleValue > 0, length.doubleValue <= Double(ShareComposerSession.maxChunkBytes), length.doubleValue.rounded() == length.doubleValue else { throw ShareComposerSession.Failure.invalidRequest }
                    result = try session.read(accountId: account, fileId: fileId, offset: offset.uint64Value, length: length.intValue)
                case "thumbnail":
                    guard let fileId = body["fileId"] as? String, let dimension = body["maxDimension"] as? NSNumber,
                          CFGetTypeID(dimension) != CFBooleanGetTypeID(), dimension.doubleValue > 0, dimension.doubleValue <= 640,
                          dimension.doubleValue.rounded() == dimension.doubleValue else { throw ShareComposerSession.Failure.invalidRequest }
                    result = try session.thumbnail(accountId: account, fileId: fileId, maxDimension: dimension.intValue) as Any? ?? NSNull()
                case "beginSubmission", "recordOutcome":
                    guard let destination = body["destination"] as? String, let operationId = body["operationId"] as? String,
                          body["targetId"] == nil || body["targetId"] is String,
                          body["recoveryPayload"] == nil || body["recoveryPayload"] is String else { throw ShareComposerSession.Failure.invalidRequest }
                    let submission = ShareComposerSubmission(destination: destination, operationId: operationId, targetId: body["targetId"] as? String, recoveryPayload: body["recoveryPayload"] as? String)
                    if method == "beginSubmission" { result = try session.beginSubmission(accountId: account, submission: submission) }
                    else {
                        guard let ids = body["outcomeIds"] as? [String] else { throw ShareComposerSession.Failure.invalidRequest }
                        result = try session.recordOutcome(accountId: account, submission: submission, outcomeIds: ids)
                    }
                case "complete": try session.complete(accountId: account); result = ["ok": true]
                default: throw ShareComposerSession.Failure.invalidRequest
                }
                DispatchQueue.main.async {
                    replyHandler(result, nil)
                    if method == "complete" { self.onComplete?() }
                }
            } catch { DispatchQueue.main.async { replyHandler(nil, error.localizedDescription) } }
        }
    }
}
