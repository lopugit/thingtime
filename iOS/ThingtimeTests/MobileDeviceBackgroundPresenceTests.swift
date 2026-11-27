import UIKit
import XCTest
@testable import Thingtime

@MainActor
private final class PresenceTaskFixture: MobilePresenceRefreshTask {
    var expiration: (() -> Void)?
    var results: [Bool] = []
    func complete(success: Bool) { results.append(success) }
}
@MainActor
private final class PresenceSchedulerFixture: MobilePresenceScheduling {
    var handler: ((MobilePresenceRefreshTask) -> Void)?
    var registrations = 0, submissions = 0, cancellations = 0
    func register(_ handler: @escaping (MobilePresenceRefreshTask) -> Void) -> Bool {
        registrations += 1; self.handler = handler; return true
    }
    func submit() throws { submissions += 1 }
    func cancel() { cancellations += 1 }
}
@MainActor
final class MobileDeviceBackgroundPresenceTests: XCTestCase {
    private let scope = try! MobileDevicePairing.Scope(ownerId: "test-owner", url: URL(string: "https://example.test")!)
    func testUnapprovedTaskDoesNoWorkAndApprovalSchedulesOneRefresh() async {
        let scheduler = PresenceSchedulerFixture()
        var saved: MobileDevicePairing.Scope?, calls = 0
        let coordinator = MobileDeviceBackgroundPresence(scheduler: scheduler, load: { saved }, save: { saved = $0 }) { scope, check in
            try check(); calls += 1
            return .init(state: "paired", deviceId: "device")
        }
        coordinator.activate(); coordinator.activate()
        let rejected = PresenceTaskFixture(); scheduler.handler?(rejected)
        XCTAssertEqual(rejected.results, [false]); XCTAssertEqual(calls, 0)
        coordinator.approve(scope)
        XCTAssertEqual(saved, scope); XCTAssertEqual(scheduler.registrations, 1); XCTAssertEqual(scheduler.submissions, 1)
        let accepted = PresenceTaskFixture(); scheduler.handler?(accepted)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(calls, 1); XCTAssertEqual(accepted.results, [true]); XCTAssertEqual(scheduler.submissions, 2)
    }
    func testExpirationAndIdentityStopFenceLateCompletionExactlyOnce() async {
        let scheduler = PresenceSchedulerFixture()
        var resume: CheckedContinuation<Void, Never>?
        let coordinator = MobileDeviceBackgroundPresence(scheduler: scheduler, load: { self.scope }, save: { _ in }) { _, check in
            await withCheckedContinuation { resume = $0 }
            try check()
            return .init(state: "paired", deviceId: "device")
        }
        coordinator.activate()
        let first = PresenceTaskFixture(); scheduler.handler?(first)
        while resume == nil { await Task.yield() }
        let expiration = first.expiration
        expiration?(); expiration?()
        resume?.resume(); resume = nil
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(first.results, [false])
        let second = PresenceTaskFixture(); scheduler.handler?(second)
        while resume == nil { await Task.yield() }
        expiration?() // An expired older task cannot stop a newer run.
        XCTAssertTrue(second.results.isEmpty)
        coordinator.stop(matching: scope)
        resume?.resume()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(second.results, [false])
    }
    func testForegroundInvalidationPrecedesFreshApprovalWithoutDelayedClear() async {
        let scheduler = PresenceSchedulerFixture()
        var saved: MobileDevicePairing.Scope? = scope
        let coordinator = MobileDeviceBackgroundPresence(scheduler: scheduler, load: { saved }, save: { saved = $0 }) { _, _ in
            .init(state: "paired", deviceId: "device")
        }
        coordinator.activate()
        NotificationCenter.default.post(name: UIScene.willEnterForegroundNotification, object: nil)
        XCTAssertNil(saved, "Approval is cleared before the foreground notification returns")
        coordinator.approve(scope)
        await Task.yield()
        XCTAssertEqual(saved, scope, "No deferred foreground cleanup may remove a new authenticated approval")
    }

    func testRevocationClearsDurableScopeAndStaleIdentityCannotStopNewOwner() async throws {
        let scheduler = PresenceSchedulerFixture()
        var saved: MobileDevicePairing.Scope? = scope
        let coordinator = MobileDeviceBackgroundPresence(scheduler: scheduler, load: { saved }, save: { saved = $0 }) { _, _ in
            .init(state: "revoked", deviceId: nil)
        }
        coordinator.activate()
        coordinator.stop(matching: try .init(ownerId: "other", url: scope.origin))
        XCTAssertEqual(saved, scope)
        let task = PresenceTaskFixture(); scheduler.handler?(task)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertNil(saved); XCTAssertEqual(task.results, [false])
    }
}
