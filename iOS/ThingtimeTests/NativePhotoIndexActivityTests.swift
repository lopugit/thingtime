@testable import AppleFileSync
import XCTest
@testable import Thingtime

final class NativePhotoIndexActivityTests: XCTestCase {
    func testTerminalNilProgressPreservesLastActualItemButNewPassAndEmptyReset() {
        let item = PhotoLibraryReader.InventoryProgress.Item(kind: .photo, capturedAt: Date(timeIntervalSince1970: 100))
        let activity = NativePhotoRunActivity()
        _ = activity.capture(.enumerating(.init(inspected: 13, total: 13, indexed: .init(), latest: item)))
        _ = activity.capture(.enumerating(.init(inspected: 13, total: 13, indexed: .init(), latest: nil)))
        XCTAssertEqual(activity.snapshot().latestFound, item)
        XCTAssertEqual(activity.measuredIndexingWork(), 13)
        _ = activity.capture(.enumerating(.init(inspected: 1, total: 14, indexed: .init(), latest: item)))
        XCTAssertEqual(activity.measuredIndexingWork(), 14)
        XCTAssertEqual(activity.snapshot().events.first?.discovered, 1)
        _ = activity.capture(.enumerating(.init(inspected: 0, total: 14, indexed: .init(), latest: nil)))
        XCTAssertNil(activity.snapshot().latestFound)
        _ = activity.capture(.enumerating(.init(inspected: 1, total: 14, indexed: .init(), latest: item)))
        _ = activity.capture(.enumerating(.init(inspected: 0, total: 0, indexed: .init(), latest: nil)))
        XCTAssertNil(activity.snapshot().latestFound)
    }
    func testOnlyMatchingSameRunHistoryRestoresMissingLatestItem() {
        let item = PhotoLibraryReader.InventoryProgress.Item(kind: .photo, capturedAt: Date(timeIntervalSince1970: 100))
        var saved = NativePhotoRunActivity.Snapshot()
        saved.indexing = .init(unit: .assets, completed: 13, total: 13)
        saved.events = [.init(phase: .indexing, at: Date(), discovered: 13, item: item)]
        XCTAssertEqual(NativePhotoRunActivity(saved).snapshot().latestFound, item)
        saved.indexing = .init(unit: .assets, completed: 0, total: 14)
        XCTAssertNil(NativePhotoRunActivity(saved).snapshot().latestFound)
        saved.indexing = .init(unit: .assets, completed: 12, total: 13)
        XCTAssertNil(NativePhotoRunActivity(saved).snapshot().latestFound)
    }
}
