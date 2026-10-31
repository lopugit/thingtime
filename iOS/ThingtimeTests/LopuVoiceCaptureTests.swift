import XCTest
@testable import Thingtime

@MainActor
final class LopuVoiceCaptureTests: XCTestCase {
    private let context = LopuVoiceCaptures.Context(ownerId: "owner-a", origin: URL(string: "https://thingtime.test")!)
    private func directory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }
    private func response(_ request: URLRequest, _ body: [String: Any], status: Int = 200, url: URL? = nil) throws -> (Data, HTTPURLResponse) {
        (try JSONSerialization.data(withJSONObject: body), HTTPURLResponse(url: url ?? request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
    private var manifest: [String: Any] {
        ["schemaVersion": 1, "origin": context.origin.absoluteString,
         "features": ["api.auth-me": ["version": "1.0.0"], "api.lopu-voice-capture": ["version": "1.0.0"]]]
    }
    private func enqueue(_ queue: LopuVoiceCaptures, event: String = "event-1", text: String = "Remember this voice note") throws -> LopuVoiceCaptures.Entry {
        try queue.enqueue(context: context, sessionId: "session-1", eventId: event, chatId: "chat-1", role: "user", text: text, localId: event)
    }

    func testInterruptedSaveSurvivesRelaunchWithSameIdentityAndNoCredentialsOnDisk() async throws {
        let dir = directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        var bodies: [Data] = []
        let transport: LopuVoiceCaptures.Transport = { request in
            switch request.url!.path {
            case LopuVoiceContract.manifestPath:
                XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
                return try self.response(request, self.manifest)
            case "/api/v1/auth/me": return try self.response(request, ["user": ["id": "owner-a"]])
            default:
                XCTAssertEqual(request.url!.path, "/api/v1/lopu/voice/capture")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), self.context.origin.absoluteString)
                bodies.append(request.httpBody!)
                if bodies.count == 1 { throw URLError(.networkConnectionLost) }
                return try self.response(request, ["ok": true, "ownerId": "owner-a", "chatId": "chat-1", "messages": [["id": "message-1"]]])
            }
        }
        let first = LopuVoiceCaptures(directory: dir, transport: transport)
        let entry = try enqueue(first)
        do { _ = try await first.deliver(entry, cookie: "first-cookie"); XCTFail("Expected interrupted save") } catch {}
        let second = LopuVoiceCaptures(directory: dir, transport: transport)
        let recovered = try XCTUnwrap(second.pending().first)
        XCTAssertEqual(recovered.id, entry.id)
        let receipt = try await second.deliver(recovered, cookie: "refreshed-cookie")
        XCTAssertEqual(receipt.chatId, "chat-1")
        XCTAssertEqual(receipt.messageIds, ["message-1"])
        let a = try JSONSerialization.jsonObject(with: bodies[0]) as! NSDictionary
        let b = try JSONSerialization.jsonObject(with: bodies[1]) as! NSDictionary
        XCTAssertEqual(a, b)
        let stored = try String(contentsOf: dir.appendingPathComponent(entry.id + ".json"), encoding: .utf8)
        XCTAssertFalse(stored.contains("cookie")); XCTAssertFalse(stored.contains("token"))
    }

    func testOwnerMismatchAndAccountSwitchCannotSendTranscript() async throws {
        for switchDuringRead in [false, true] {
            let dir = directory()
            defer { try? FileManager.default.removeItem(at: dir) }
            var current = true, writes = 0
            let queue = LopuVoiceCaptures(directory: dir) { request in
                if request.httpMethod == "POST" { writes += 1 }
                if request.url!.path == LopuVoiceContract.manifestPath { return try self.response(request, self.manifest) }
                if switchDuringRead { current = false }
                return try self.response(request, ["user": ["id": switchDuringRead ? "owner-a" : "owner-b"]])
            }
            let entry = try enqueue(queue)
            do { _ = try await queue.deliver(entry, cookie: "session", stillCurrent: { current }); XCTFail("Must reject switched account") } catch {}
            XCTAssertEqual(writes, 0); XCTAssertEqual(queue.pending().count, 1)
        }
    }

    func testContractAndRedirectFailuresRetainRecoveryData() async throws {
        for mode in ["old", "redirect", "bad-receipt"] {
            let dir = directory()
            defer { try? FileManager.default.removeItem(at: dir) }
            var writes = 0
            let queue = LopuVoiceCaptures(directory: dir) { request in
                if request.httpMethod == "POST" { writes += 1 }
                if request.url!.path == LopuVoiceContract.manifestPath {
                    var manifest = self.manifest
                    if mode == "old" { manifest["features"] = ["api.lopu-voice-capture": ["version": "2.0.0"]] }
                    return try self.response(request, manifest, url: mode == "redirect" ? URL(string: "https://other.test") : nil)
                }
                if request.url!.path == "/api/v1/auth/me" { return try self.response(request, ["user": ["id": "owner-a"]]) }
                return try self.response(request, ["ok": true, "ownerId": "owner-b", "chatId": "chat-1", "messages": [["id": "message-1"]]])
            }
            let entry = try enqueue(queue)
            do { _ = try await queue.deliver(entry, cookie: "session"); XCTFail("Must reject invalid origin or receipt") } catch {}
            XCTAssertEqual(writes, mode == "bad-receipt" ? 1 : 0)
            XCTAssertEqual(queue.pending().count, 1)
        }
    }

    func testQueueBoundsDuplicateIdentityAndChronologicalRecovery() throws {
        let dir = directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let queue = LopuVoiceCaptures(directory: dir)
        let first = try enqueue(queue)
        XCTAssertEqual(try enqueue(queue).id, first.id)
        XCTAssertThrowsError(try enqueue(queue, text: "Changed content"))
        XCTAssertThrowsError(try enqueue(queue, event: "../invalid"))
        for index in 2...50 { _ = try enqueue(queue, event: "event-\(index)") }
        XCTAssertEqual(queue.pending().first?.id, first.id)
        XCTAssertEqual(queue.pending().count, 50)
        XCTAssertThrowsError(try enqueue(queue, event: "event-51"))
        XCTAssertEqual(LopuVoiceCaptures(directory: dir).pending().count, 50)
    }

    func testNativeHistoryIsBoundedTextOnlyAndDoesNotRequestResponse() throws {
        let input = [["role": "system", "text": "Do not send this"], ["role": "user", "text": "Earlier context"], ["role": "assistant", "text": "An earlier reply"]]
        let events = LopuVoiceHistory.events(input)
        XCTAssertEqual(events.count, 2)
        XCTAssertTrue(events.allSatisfy { $0["type"] as? String == "conversation.item.create" })
        let first = events[0]["item"] as! [String: Any]
        XCTAssertEqual(first["role"] as? String, "user")
        let many = (0..<30).map { ["role": "user", "text": "Message \($0)"] }
        XCTAssertEqual(LopuVoiceHistory.bounded(many).count, 20)
        let long = LopuVoiceHistory.bounded((0..<3).map { _ in ["role": "assistant", "text": String(repeating: "🦄", count: 14000)] })
        XCTAssertEqual(long.reduce(0) { $0 + $1["text"]!.unicodeScalars.count }, 24000)
        XCTAssertEqual(long.count, 2)
    }

    func testWorkerRemovesOnlyAcknowledgedEntriesAndDoesNotDrainOtherAccount() async throws {
        let dir = directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        var writes = 0
        let queue = LopuVoiceCaptures(directory: dir) { request in
            if request.url!.path == LopuVoiceContract.manifestPath { return try self.response(request, self.manifest) }
            if request.url!.path == "/api/v1/auth/me" { return try self.response(request, ["user": ["id": "owner-a"]]) }
            writes += 1
            return try self.response(request, ["ok": true, "ownerId": "owner-a", "chatId": "chat-1", "messages": [["id": "message-1"]]])
        }
        _ = try enqueue(queue)
        let other = LopuVoiceCaptures.Context(ownerId: "owner-b", origin: context.origin)
        try queue.enqueue(context: other, sessionId: "other", eventId: "event-1", chatId: "chat-b", role: "user", text: "Other account text", localId: "other")
        let saved = expectation(description: "Canonical transcript acknowledged")
        queue.notify = { type, payload in
            if type == "lopu-voice-capture-saved" {
                XCTAssertEqual(payload["ownerId"] as? String, "owner-a")
                XCTAssertEqual(payload["chatId"] as? String, "chat-1")
                saved.fulfill()
            }
        }
        queue.activate(context, cookie: "session")
        await fulfillment(of: [saved], timeout: 3)
        XCTAssertEqual(writes, 1)
        XCTAssertEqual(queue.pending().map(\.context.ownerId), ["owner-b"])
        queue.activate(nil, cookie: "")
    }
}
