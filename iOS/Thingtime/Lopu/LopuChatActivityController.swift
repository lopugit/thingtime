import ActivityKit
import Foundation
import UIKit

/// ActivityKit displays progress; it does not grant the app execution time.
/// Server-managed chats continue independently and update/end through APNs.
@MainActor
final class LopuChatActivityController {
    typealias Registration = (URL, String, String, String?, String, [LopuChatActivitySnapshot.Chat]) async -> Void
    var register: Registration?
    var sendToWeb: ((String, [String: Any]) -> Void)?
    private var desired: (snapshot: LopuChatActivitySnapshot, root: URL)?
    private var currentOwner: String?
    private var currentRoot: URL?
    private var currentContext: String?
    private var resetRequested = false
    private let client: LopuChatActivityClient
    private var activity: LopuChatActivityClient.Handle?
    private var token: String?
    private var tokenTask: Task<Void, Never>?
    private var worker: Task<Void, Never>?
    private var revision = 0
    private var restored = false
    private var dismissed = false
    private var lastUpdate = Date.distantPast
    private var lastSnapshot: LopuChatActivitySnapshot?
    private var lastContent: LopuChatActivityAttributes.ContentState?

    init(client: LopuChatActivityClient? = nil) { self.client = client ?? .system }

    func sync(_ snapshot: LopuChatActivitySnapshot, root: URL) {
        if snapshot.chats.isEmpty || desired?.snapshot.ownerId != snapshot.ownerId || desired?.root != root || desired?.snapshot.contextKey != snapshot.contextKey {
            resetRequested = true
        }
        desired = (snapshot, root)
        revision += 1
        drain()
    }

    func reset() {
        desired = nil
        resetRequested = true
        revision += 1
        tokenTask?.cancel()
        drain()
    }

    private func drain() {
        guard worker == nil else { return }
        worker = Task { [weak self] in
            guard let self else { return }
            while true {
                let generation = revision
                await reconcile()
                if generation == revision { break }
            }
            worker = nil
        }
    }

    private func reconcile() async {
        if !restored {
            restored = true
            // Process-restored activities have no verified web identity yet.
            // Retire them before displaying the newly authenticated snapshot.
            for previous in client.activities() {
                await previous.end(nil, .immediate)
            }
        }
        let generation = revision
        let next = desired
        let changedIdentity = next?.snapshot.ownerId != currentOwner || next?.root != currentRoot || next?.snapshot.contextKey != currentContext
        if resetRequested || changedIdentity || next?.snapshot.chats.isEmpty != false {
            resetRequested = false
            await endCurrent(immediate: changedIdentity || next?.snapshot.ownerId == nil)
            guard generation == revision else { return }
            dismissed = false
        }
        guard let next, let owner = next.snapshot.ownerId, !next.snapshot.chats.isEmpty else {
            currentOwner = nil
            currentRoot = nil
            currentContext = nil
            return
        }
        currentOwner = owner
        currentRoot = next.root
        currentContext = next.snapshot.contextKey
        if let activity, [.dismissed, .ended].contains(activity.state()) {
            dismissed = true
            await endCurrent(immediate: true)
        }
        guard !dismissed else { return }
        let content = next.snapshot.content
        guard lastSnapshot != next.snapshot || lastContent != content || Date().timeIntervalSince(lastUpdate) >= 30 else { return }
        let update = ActivityContent(state: content, staleDate: Date().addingTimeInterval(120))
        if let activity {
            await activity.update(update)
        } else {
            guard client.foreground() else { return }
            guard client.enabled() else { return }
            do {
                let started = try client.request(update)
                activity = started
                tokenTask = started.observeToken { [weak self] value in
                    guard let self, !Task.isCancelled, self.activity?.id == started.id else { return }
                    self.token = value
                    await self.registerCurrent()
                }
            } catch {
                sendToWeb?("lopu-chat-activity-unavailable", ["message": "Chat work continues, but iOS could not show its Live Activity."])
                return
            }
        }
        lastContent = content
        lastSnapshot = next.snapshot
        lastUpdate = Date()
        guard generation == revision else { return }
        await registerCurrent()
    }

    private func registerCurrent() async {
        guard let activity, let token, let next = desired, let owner = next.snapshot.ownerId,
              owner == currentOwner, next.root == currentRoot, next.snapshot.contextKey == currentContext,
              next.snapshot.contextKey != "unresolved" else { return }
        await register?(next.root, owner, activity.id, token, next.snapshot.contextKey, next.snapshot.chats)
    }

    private func endCurrent(immediate: Bool) async {
        tokenTask?.cancel()
        tokenTask = nil
        let old = activity, owner = currentOwner, root = currentRoot, context = currentContext
        activity = nil
        token = nil
        lastContent = nil
        lastSnapshot = nil
        lastUpdate = .distantPast
        guard let old else { return }
        await old.end(ActivityContent(state: .init(activeCount: 0, serverCount: 0, phase: "finished"), staleDate: nil),
                      immediate ? .immediate : .after(Date().addingTimeInterval(30)))
        if let owner, let root, let context, context != "unresolved" { await register?(root, owner, old.id, nil, context, []) }
    }
}
