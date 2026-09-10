import CryptoKit
import Foundation
import UIKit

final class VoiceCaptureRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Completed direct-voice text is durable before delivery. No cookies or provider
/// tokens are stored, and only the active origin/account can drain its entries.
@MainActor
final class LopuVoiceCaptures {
    typealias Context = LopuRecordingUploads.Context
    typealias Transport = (URLRequest) async throws -> (Data, HTTPURLResponse)
    struct Entry: Codable {
        let id: String
        let context: Context
        let sessionId: String
        let eventId: String
        let chatId: String?
        let role: String
        let text: String
        let localId: String
        let createdAt: Date
    }
    enum Failure: Error { case invalid, full, incompatible, wrongAccount, rejected }
    var notify: ((String, [String: Any]) -> Void)?
    private let directory: URL
    private let transport: Transport
    private var context: Context?
    private var cookie = ""
    private var worker: Task<Void, Never>?
    private var generation = UUID()

    init(directory: URL? = nil, transport: Transport? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Lopu Voice Captures", isDirectory: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        let session = URLSession(configuration: configuration, delegate: VoiceCaptureRedirectPolicy(), delegateQueue: nil)
        self.transport = transport ?? { request in
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw Failure.rejected }
            return (data, http)
        }
    }

    func activate(_ context: Context?, cookie: String) {
        if self.context != context || self.cookie != cookie {
            generation = UUID()
            worker?.cancel()
        }
        self.context = context
        self.cookie = cookie
        publishState()
        pump()
    }

    private static func identity(_ context: Context, _ session: String, _ role: String, _ event: String) -> String {
        let data = try! JSONEncoder().encode([context.origin.absoluteString, context.ownerId, session, role, event])
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func valid(_ entry: Entry) -> Bool {
        let pattern = "^[A-Za-z0-9_.:-]{1,128}$"
        return entry.sessionId.range(of: pattern, options: .regularExpression) != nil
            && entry.eventId.range(of: pattern, options: .regularExpression) != nil
            && ["user", "assistant"].contains(entry.role)
            && !entry.text.isEmpty && entry.text.unicodeScalars.count <= 12000
            && (entry.chatId == nil || entry.chatId!.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil)
            && entry.context == LopuRecordingUploads.context(ownerId: entry.context.ownerId, baseURL: entry.context.origin)
            && entry.id == identity(entry.context, entry.sessionId, entry.role, entry.eventId)
    }

    func pending() -> [Entry] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .isSymbolicLinkKey])) ?? []
        return urls.compactMap { url in
            guard url.pathExtension == "json", let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isSymbolicLinkKey]),
                  values.isSymbolicLink != true, (values.fileSize ?? Int.max) <= 200000,
                  let data = try? Data(contentsOf: url), let entry = try? JSONDecoder().decode(Entry.self, from: data),
                  Self.valid(entry), url.lastPathComponent == entry.id + ".json" else { return nil }
            return entry
        }.sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
    }

    @discardableResult
    func enqueue(context: Context, sessionId: String, eventId: String, chatId: String?, role: String, text: String, localId: String) throws -> Entry {
        let entry = Entry(id: Self.identity(context, sessionId, role, eventId), context: context, sessionId: sessionId,
                          eventId: eventId, chatId: chatId, role: role, text: text.trimmingCharacters(in: .whitespacesAndNewlines),
                          localId: localId, createdAt: Date())
        guard Self.valid(entry) else { throw Failure.invalid }
        let entries = pending()
        if let prior = entries.first(where: { $0.id == entry.id }) {
            guard prior.text == entry.text, prior.chatId == entry.chatId else { throw Failure.invalid }
            return prior
        }
        let own = entries.filter { $0.context == context }
        guard entries.count < 200, own.count < 50, own.reduce(0, { $0 + $1.text.unicodeScalars.count }) + entry.text.unicodeScalars.count <= 240000 else { throw Failure.full }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(entry).write(to: directory.appendingPathComponent(entry.id + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        publishState()
        pump()
        return entry
    }

    private func publishState(error: Bool = false) {
        guard let context else { return }
        notify?("lopu-voice-capture-state", ["ownerId": context.ownerId, "origin": context.origin.absoluteString, "pending": pending().filter { $0.context == context }.count,
            "error": error ? "Voice text is saved on this iPhone. Retry saving when connected to its Thingtime account." : ""])
    }

    private func pump() {
        guard worker == nil, let context, !cookie.isEmpty, pending().contains(where: { $0.context == context }) else { return }
        let token = generation, cookie = cookie
        worker = Task {
            let background = UIApplication.shared.beginBackgroundTask(withName: "Save Lopu voice text") {
                Task { @MainActor in if self.generation == token { self.worker?.cancel() } }
            }
            defer {
                if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
                worker = nil
                if generation != token { pump() }
            }
            while !Task.isCancelled, generation == token, let entry = pending().first(where: { $0.context == context }) {
                do {
                    let result = try await deliver(entry, cookie: cookie, stillCurrent: { self.generation == token && !Task.isCancelled })
                    guard generation == token, !Task.isCancelled else { return }
                    // A crash before removal only retries the exact server-side idempotency key.
                    try FileManager.default.removeItem(at: directory.appendingPathComponent(entry.id + ".json"))
                    notify?("lopu-voice-capture-saved", ["ownerId": context.ownerId, "origin": context.origin.absoluteString, "sessionId": entry.sessionId,
                        "chatId": result.chatId, "originalChatId": entry.chatId as Any? ?? NSNull(), "localId": entry.localId,
                        "messageIds": result.messageIds])
                    publishState()
                } catch {
                    if generation == token, !Task.isCancelled { publishState(error: true) }
                    return
                }
            }
        }
    }

    func deliver(_ entry: Entry, cookie: String, stillCurrent: () -> Bool = { true }) async throws -> (chatId: String, messageIds: [String]) {
        guard Self.valid(entry), !cookie.isEmpty else { throw Failure.invalid }
        func request(_ path: String, body: [String: Any]? = nil, authenticated: Bool = true) async throws -> [String: Any] {
            guard stillCurrent(), !Task.isCancelled, let url = URL(string: path, relativeTo: entry.context.origin)?.absoluteURL else { throw CancellationError() }
            var request = URLRequest(url: url)
            request.timeoutInterval = 30
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if authenticated { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
            if let body {
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue(entry.context.origin.absoluteString, forHTTPHeaderField: "Origin")
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let (data, http) = try await transport(request)
            guard stillCurrent(), !Task.isCancelled else { throw CancellationError() }
            guard http.statusCode == 200, let finalURL = http.url, LopuVoiceContract.sameOrigin(finalURL, entry.context.origin),
                  data.count <= 2_000_000, let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.rejected }
            return json
        }
        let manifest = try await request(LopuVoiceContract.manifestPath, authenticated: false)
        for (feature, version) in [("api.auth-me", [1, 0, 0]), ("api.lopu-voice-capture", [1, 0, 0])] {
            guard LopuVoiceContract.accepts(manifest, baseURL: entry.context.origin, feature: feature, minimum: version) else { throw Failure.incompatible }
        }
        let account = try await request("/api/v1/auth/me")
        guard (account["user"] as? [String: Any])?["id"] as? String == entry.context.ownerId else { throw Failure.wrongAccount }
        var body: [String: Any] = ["ownerId": entry.context.ownerId, "sessionId": entry.sessionId, "eventId": entry.eventId, "role": entry.role, "text": entry.text]
        if let chatId = entry.chatId { body["chatId"] = chatId }
        let saved = try await request("/api/v1/lopu/voice/capture", body: body)
        guard saved["ok"] as? Bool == true, saved["ownerId"] as? String == entry.context.ownerId,
              let chatId = saved["chatId"] as? String, !chatId.isEmpty, entry.chatId == nil || entry.chatId == chatId,
              let messages = saved["messages"] as? [[String: Any]], !messages.isEmpty else { throw Failure.rejected }
        let ids = messages.compactMap { $0["id"] as? String }.filter { !$0.isEmpty }
        guard ids.count == messages.count else { throw Failure.rejected }
        return (chatId, ids)
    }
}
