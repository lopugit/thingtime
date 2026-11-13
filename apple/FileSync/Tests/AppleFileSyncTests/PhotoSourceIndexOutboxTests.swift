import XCTest
@testable import AppleFileSync

final class PhotoSourceIndexOutboxTests: XCTestCase {
    private func fixture() throws -> (URL, UUID) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("source-index-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return (url, UUID())
    }
    private func resource(_ n: Int = 0) -> PhotoResource {
        .init(asset: "asset-\(n)", index: 0, name: "original.jpg", revision: "revision-\(n)",
              capturedAt: Date(timeIntervalSince1970: Double(n)), assetKind: "photo")
    }
    func testUncertainDeliverySurvivesRestartWithImmutableIdentity() throws {
        let (url, epoch) = try fixture(), pass = UUID().uuidString.lowercased()
        let outbox = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        let progress = PhotoSourceIndexPage.Progress(inspectedAssets: 1, totalAssets: 100, indexedResources: 1, complete: false)
        try outbox.append([resource()], passId: pass, progress: progress)
        let original = try XCTUnwrap(outbox.first())
        let reopened = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        XCTAssertEqual(try reopened.first(), original)
        // A restarted discovery does not duplicate an unchanged observation.
        try reopened.append([resource()], passId: pass, progress: progress)
        try reopened.acknowledge(original)
        XCTAssertNil(try reopened.first())
        try reopened.append([resource()], passId: pass, progress: progress, unavailable: [resource().path], reasons: [resource().path: "photo-read"])
        let unavailable = try XCTUnwrap(reopened.first())
        XCTAssertEqual(unavailable.sequence, original.sequence + 1)
        XCTAssertEqual(unavailable.entries.first?.availability, "unavailable")
        XCTAssertEqual(unavailable.entries.first?.reason, "photo-read")
        XCTAssertFalse(unavailable.progress.complete)
    }
    func testCrashBetweenPageAndCounterNeverReusesSequence() throws {
        let (url, epoch) = try fixture(), pass = UUID().uuidString
        let outbox = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        let progress = PhotoSourceIndexPage.Progress(inspectedAssets: 1, totalAssets: 2, indexedResources: 1, complete: false)
        try outbox.append([resource()], passId: pass, progress: progress)
        let first = try XCTUnwrap(outbox.first())
        try FileManager.default.removeItem(at: url.appendingPathComponent("state.json"))
        let reopened = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        try reopened.append([resource(1)], passId: pass, progress: .init(inspectedAssets: 2, totalAssets: 2, indexedResources: 2, complete: true))
        XCTAssertEqual(try reopened.first(), first)
        try reopened.acknowledge(first)
        let next = try XCTUnwrap(reopened.first())
        XCTAssertEqual(next.sequence, first.sequence + 1)
        XCTAssertNotEqual(next.requestId, first.requestId)
        XCTAssertThrowsError(try reopened.acknowledge(first))
        XCTAssertEqual(try reopened.first(), next)
    }
    func testCounterWriteFailureKeepsAlreadyAllocatedPageImmutableInSameProcess() throws {
        let (url, epoch) = try fixture(), pass = UUID().uuidString
        let outbox = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        XCTAssertEqual(try outbox.pendingCount(), 0)
        let state = url.appendingPathComponent("state.json", isDirectory: true)
        try FileManager.default.createDirectory(at: state, withIntermediateDirectories: true)
        XCTAssertThrowsError(try outbox.append([resource()], passId: pass,
            progress: .init(inspectedAssets: 1, totalAssets: 2, indexedResources: 1, complete: false)))
        let allocated = try XCTUnwrap(outbox.first())
        try FileManager.default.removeItem(at: state)
        try outbox.append([resource(1)], passId: pass,
            progress: .init(inspectedAssets: 2, totalAssets: 2, indexedResources: 2, complete: true))
        XCTAssertEqual(try outbox.first(), allocated)
        try outbox.acknowledge(allocated)
        XCTAssertEqual(try outbox.first()?.sequence, allocated.sequence + 1)
    }

    func testLargeResourceGroupUsesBoundedPagesAndSealsOnlyLast() throws {
        let (url, epoch) = try fixture(), pass = UUID().uuidString
        let outbox = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        try outbox.append((0..<65).map(resource), passId: pass,
            progress: .init(inspectedAssets: 65, totalAssets: 65, indexedResources: 65, complete: true))
        var sizes: [Int] = [], complete: [Bool] = []
        while let page = try outbox.first() {
            sizes.append(page.entries.count); complete.append(page.progress.complete)
            let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(page)) as! [String: Any]
            let entries = json["entries"] as! [[String: Any]]
            XCTAssertTrue(entries[0]["reason"] is NSNull)
            XCTAssertTrue(entries[0]["modifiedAt"] is NSNull)
            try outbox.acknowledge(page)
        }
        XCTAssertEqual(sizes, [32,32,1]); XCTAssertEqual(complete, [false,false,true])
    }
    func testAcknowledgedIndexCheckpointIsDurableEmptyAndDoesNotDuplicatePendingWork() throws {
        let (url, epoch) = try fixture(), pass = UUID().uuidString.lowercased()
        let box = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        try box.checkpointAcknowledgedIndex()
        XCTAssertNil(try box.first(), "An initial empty outbox has no progress to assert")
        let progress = PhotoSourceIndexPage.Progress(inspectedAssets: 1, totalAssets: 1, indexedResources: 1, complete: true)
        try box.append([resource()], passId: pass, progress: progress)
        let resourcePage = try XCTUnwrap(box.first())
        try box.checkpointAcknowledgedIndex()
        XCTAssertEqual(try box.first(), resourcePage, "Existing unacknowledged work is the probe; never replace or append behind it")
        try box.acknowledge(resourcePage)
        try box.checkpointAcknowledgedIndex()
        let checkpoint = try XCTUnwrap(box.first())
        XCTAssertEqual(checkpoint.entries, []); XCTAssertEqual(checkpoint.progress, progress)
        XCTAssertEqual(checkpoint.epoch, resourcePage.epoch); XCTAssertEqual(checkpoint.passId, pass)
        XCTAssertEqual(checkpoint.sequence, resourcePage.sequence + 1)
        XCTAssertNotEqual(checkpoint.requestId, resourcePage.requestId)
        let reopened = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        XCTAssertEqual(try reopened.first(), checkpoint)
        try reopened.checkpointAcknowledgedIndex()
        XCTAssertEqual(try reopened.first(), checkpoint, "An uncertain send retains its exact UUID and payload")
        try reopened.acknowledge(checkpoint)
        try reopened.checkpointAcknowledgedIndex()
        let nextPass = try XCTUnwrap(reopened.first())
        XCTAssertEqual(nextPass.sequence, checkpoint.sequence + 1)
        XCTAssertNotEqual(nextPass.requestId, checkpoint.requestId)
        XCTAssertEqual(nextPass.progress, checkpoint.progress)
    }
    func testCheckpointCounterFailureRetainsAllocatedIdentityAcrossRecovery() throws {
        let (url, epoch) = try fixture(), pass = UUID().uuidString.lowercased()
        let box = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        try box.append([resource()], passId: pass, progress: .init(inspectedAssets: 1, totalAssets: 1, indexedResources: 1, complete: true))
        try box.acknowledge(try XCTUnwrap(box.first()))
        let stateURL = url.appendingPathComponent("state.json"), prior = try Data(contentsOf: stateURL)
        try FileManager.default.removeItem(at: stateURL)
        try FileManager.default.createDirectory(at: stateURL, withIntermediateDirectories: false)
        XCTAssertThrowsError(try box.checkpointAcknowledgedIndex())
        let allocated = try XCTUnwrap(box.first())
        XCTAssertEqual(allocated.entries, [])
        try box.checkpointAcknowledgedIndex()
        XCTAssertEqual(try box.first(), allocated)
        try FileManager.default.removeItem(at: stateURL); try prior.write(to: stateURL)
        let reopened = PhotoSourceIndexOutbox(directory: url, epoch: epoch)
        XCTAssertEqual(try reopened.first(), allocated)
        try reopened.checkpointAcknowledgedIndex()
        XCTAssertEqual(try reopened.first(), allocated)
    }

}
