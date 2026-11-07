import XCTest
@testable import Thingtime

final class DestinationNavigationFenceTests: XCTestCase {
    private let production = URL(string: "https://thingtime.com")!
    private let preview = URL(string: "https://pr-996.previews.dev.thingtime.com")!

    func testFailedClearRetainsAuthorityAndDoesNotRetryOnRender() {
        var fence = DestinationNavigationFence()
        let initial = DestinationNavigationFence.Request(url: production, id: UUID())
        XCTAssertEqual(fence.prepare(initial, clearAuthority: { XCTFail("Initial load has no previous authority"); return false }), .allowed)
        let request = DestinationNavigationFence.Request(url: preview, id: UUID())
        var clearAttempts = 0
        XCTAssertEqual(fence.prepare(request, clearAuthority: { clearAttempts += 1; return false }), .failed)
        XCTAssertEqual(fence.loadedRootURL, production)
        XCTAssertEqual(fence.prepare(request, clearAuthority: { clearAttempts += 1; return true }), .blocked)
        XCTAssertEqual(clearAttempts, 1)
        XCTAssertEqual(fence.loadedRootURL, production)
    }

    func testExplicitRetryCanSwitchAfterUnlock() {
        var fence = DestinationNavigationFence()
        _ = fence.prepare(.init(url: production, id: UUID()), clearAuthority: { true })
        _ = fence.prepare(.init(url: preview, id: UUID()), clearAuthority: { false })
        let retry = DestinationNavigationFence.Request(url: preview, id: UUID())
        XCTAssertEqual(fence.prepare(retry, clearAuthority: { true }), .allowed)
        XCTAssertEqual(fence.loadedRootURL, preview)
        XCTAssertEqual(fence.latestRequest, retry)
    }

    func testNewTargetReplacesFailedAttemptAndFencesItsDelayedCallback() {
        var fence = DestinationNavigationFence()
        _ = fence.prepare(.init(url: production, id: UUID()), clearAuthority: { true })
        let failed = DestinationNavigationFence.Request(url: preview, id: UUID())
        _ = fence.prepare(failed, clearAuthority: { false })
        let newer = DestinationNavigationFence.Request(url: URL(string: "https://dev.thingtime.com")!, id: UUID())
        XCTAssertEqual(fence.prepare(newer, clearAuthority: { true }), .allowed)
        XCTAssertNotEqual(fence.latestRequest, failed)
        XCTAssertEqual(fence.loadedRootURL, newer.url)
    }

    func testRollbackToLoadedDestinationDoesNotClearItsAuthority() {
        var fence = DestinationNavigationFence()
        let requestID = UUID()
        _ = fence.prepare(.init(url: production, id: requestID), clearAuthority: { true })
        _ = fence.prepare(.init(url: preview, id: requestID), clearAuthority: { false })
        let rollback = DestinationNavigationFence.Request(url: production, id: requestID)
        XCTAssertEqual(fence.prepare(rollback, clearAuthority: { XCTFail("Rollback must retain current credentials"); return false }), .unchanged)
        XCTAssertEqual(fence.loadedRootURL, production)
        XCTAssertEqual(fence.latestRequest, rollback)
    }
}
