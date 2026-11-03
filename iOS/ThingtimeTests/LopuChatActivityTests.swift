import ActivityKit
import XCTest
@testable import Thingtime

final class LopuChatActivityTests: XCTestCase {
    @MainActor
    func testAggregateLifecycleAndAccountResetAreSerialized() async throws {
        var handles: [FakeChatActivity] = []
        let client = LopuChatActivityClient(activities: { [] }, request: { content in
            let activity = FakeChatActivity(content: content)
            handles.append(activity)
            return activity.handle
        }, enabled: { true }, foreground: { true })
        let controller = LopuChatActivityController(client: client)
        let root = URL(string: "https://thingtime.test")!
        func snapshot(_ owner: String, _ ids: [String]) -> LopuChatActivitySnapshot {
            LopuChatActivitySnapshot(payload: ["ownerId": owner, "chats": ids.map { ["chatId": $0, "status": "running", "management": "server"] }])!
        }
        func settle() async { for _ in 0..<30 { await Task.yield() } }
        controller.sync(snapshot("a", ["one", "two"]), root: root)
        await settle()
        XCTAssertEqual(handles.count, 1)
        XCTAssertEqual(handles[0].content.state.activeCount, 2)
        controller.sync(snapshot("a", ["two"]), root: root)
        await settle()
        XCTAssertEqual(handles.count, 1)
        XCTAssertEqual(handles[0].content.state.activeCount, 1)
        controller.sync(snapshot("b", ["three"]), root: root)
        await settle()
        XCTAssertEqual(handles.count, 2)
        XCTAssertEqual(handles[0].state, .ended)
        XCTAssertEqual(handles[1].state, .active)
        controller.sync(snapshot("b", []), root: root)
        await settle()
        XCTAssertEqual(handles[1].state, .ended)
        XCTAssertFalse(handles.contains { $0.state == .active })
    }

    @MainActor
    func testCoalescedSourceChangeRetiresEarlierActivity() async {
        var handles: [FakeChatActivity] = []
        let controller = LopuChatActivityController(client: .init(activities: { [] }, request: { content in
            let activity = FakeChatActivity(content: content); handles.append(activity); return activity.handle
        }, enabled: { true }, foreground: { true }))
        let root = URL(string: "https://thingtime.test")!
        func snapshot(_ context: String, empty: Bool = false) -> LopuChatActivitySnapshot {
            LopuChatActivitySnapshot(payload: ["ownerId": "a", "contextKey": context, "chats": empty ? [] : [["chatId": "one", "status": "running", "management": "server"]]])!
        }
        controller.sync(snapshot("source-a"), root: root)
        for _ in 0..<30 { await Task.yield() }
        controller.sync(snapshot("source-a", empty: true), root: root)
        controller.sync(snapshot("source-b"), root: root)
        for _ in 0..<30 { await Task.yield() }
        XCTAssertEqual(handles.count, 2)
        XCTAssertEqual(handles[0].state, .ended)
        XCTAssertEqual(handles[1].state, .active)
        controller.reset()
        for _ in 0..<30 { await Task.yield() }
    }

    @MainActor
    func testDismissalIsRespectedUntilNextRunAndDestinationChangeEndsOldActivity() async {
        var handles: [FakeChatActivity] = []
        let controller = LopuChatActivityController(client: .init(activities: { [] }, request: { content in
            let activity = FakeChatActivity(content: content); handles.append(activity); return activity.handle
        }, enabled: { true }, foreground: { true }))
        let root = URL(string: "https://thingtime.test")!
        let snapshot = LopuChatActivitySnapshot(payload: ["ownerId": "a", "chats": [["chatId": "one", "status": "running", "management": "server"]]])!
        controller.sync(snapshot, root: root)
        for _ in 0..<30 { await Task.yield() }
        handles[0].state = .dismissed
        controller.sync(snapshot, root: root)
        for _ in 0..<30 { await Task.yield() }
        controller.sync(snapshot, root: root)
        for _ in 0..<30 { await Task.yield() }
        XCTAssertEqual(handles.count, 1)
        controller.sync(snapshot, root: URL(string: "https://other.test")!)
        for _ in 0..<30 { await Task.yield() }
        XCTAssertEqual(handles.count, 2)
        controller.reset()
        for _ in 0..<30 { await Task.yield() }
        XCTAssertEqual(handles[1].state, .ended)
    }

    @MainActor
    func testNativeControllerUsesOneActivityAcrossConcurrentChatsAndEndsIt() async throws {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { throw XCTSkip("Live Activities are disabled on this simulator.") }
        let controller = LopuChatActivityController()
        var warning: String?
        controller.sendToWeb = { _, payload in warning = payload["message"] as? String }
        let root = URL(string: "https://thingtime.test")!
        func snapshot(_ ids: [String]) -> LopuChatActivitySnapshot {
            LopuChatActivitySnapshot(payload: ["ownerId": "test-owner", "chats": ids.map { ["chatId": $0, "status": "running", "management": "server"] }])!
        }
        controller.sync(snapshot(["one", "two"]), root: root)
        for _ in 0..<100 {
            if !Activity<LopuChatActivityAttributes>.activities.isEmpty || warning != nil { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        if let warning { throw XCTSkip("ActivityKit request unavailable in this host: \(warning)") }
        let activities = Activity<LopuChatActivityAttributes>.activities
        XCTAssertEqual(activities.count, 1)
        let activity = try XCTUnwrap(activities.first)
        XCTAssertEqual(activity.content.state.activeCount, 2)
        controller.sync(snapshot(["two"]), root: root)
        for _ in 0..<100 {
            if activity.content.state.activeCount == 1 { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(Activity<LopuChatActivityAttributes>.activities.count, 1)
        XCTAssertEqual(activity.content.state.activeCount, 1)
        controller.sync(snapshot([]), root: root)
        for _ in 0..<100 {
            if [.ended, .dismissed].contains(activity.activityState) { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertTrue([.ended, .dismissed].contains(activity.activityState))
        controller.reset()
    }

    func testMultipleChatsAggregateAndDeduplicateWithoutPrivateContent() throws {
        let snapshot = try XCTUnwrap(LopuChatActivitySnapshot(payload: ["ownerId": "account-a", "chats": [
            ["chatId": "one", "status": "running", "management": "server", "title": "private title"],
            ["chatId": "two", "status": "retrying", "management": "client"],
            ["chatId": "one", "status": "running", "management": "server"]
        ]]))
        XCTAssertEqual(snapshot.content.activeCount, 2)
        XCTAssertEqual(snapshot.content.serverCount, 1)
        XCTAssertEqual(snapshot.content.phase, "running")
        let content = String(data: try JSONEncoder().encode(snapshot.content), encoding: .utf8)!
        XCTAssertFalse(content.contains("private"))
        XCTAssertFalse(content.contains("account-a"))
        XCTAssertFalse(content.contains("one"))
    }

    func testAnonymousSnapshotCannotStartAndEmptySnapshotFinishes() throws {
        XCTAssertNil(LopuChatActivitySnapshot(payload: ["chats": [["chatId": "one", "status": "running", "management": "server"]]]))
        let empty = try XCTUnwrap(LopuChatActivitySnapshot(payload: ["ownerId": NSNull(), "chats": []]))
        XCTAssertEqual(empty.content.activeCount, 0)
        XCTAssertEqual(empty.content.phase, "finished")
    }

    func testMalformedAndOversizedSnapshotsFailClosed() {
        for chat in [
            ["chatId": "one", "status": "completed", "management": "server"],
            ["chatId": "one", "status": "running", "management": "unknown"],
            ["chatId": "bad\nidentifier", "status": "running", "management": "client"]
        ] { XCTAssertNil(LopuChatActivitySnapshot(payload: ["ownerId": "owner", "chats": [chat]])) }
        let chat = ["chatId": "one", "status": "running", "management": "server"]
        XCTAssertNil(LopuChatActivitySnapshot(payload: ["ownerId": "owner", "chats": Array(repeating: chat, count: 101)]))
    }

    func testRetriesKeepOneAggregateActiveAndNativeCapabilityIsExplicit() throws {
        let snapshot = try XCTUnwrap(LopuChatActivitySnapshot(payload: ["ownerId": "owner", "chats": [
            ["chatId": "one", "status": "retrying", "management": "server"],
            ["chatId": "two", "status": "retrying", "management": "server"]
        ]]))
        XCTAssertEqual(snapshot.content.phase, "retrying")
        XCTAssertEqual(snapshot.content.activeCount, 2)
        XCTAssertEqual(ThingtimeBridgeScript.lopuChatActivityVersion, "'1.0.0'")
    }
}


@MainActor
private final class FakeChatActivity {
    let id = UUID().uuidString
    var state = ActivityState.active
    var content: LopuChatActivityClient.Content
    init(content: LopuChatActivityClient.Content) { self.content = content }
    var handle: LopuChatActivityClient.Handle {
        .init(id: id, state: { self.state }, update: { self.content = $0 }, end: { content, _ in
            if let content { self.content = content }
            self.state = .ended
        }, observeToken: { _ in Task {} })
    }
}
