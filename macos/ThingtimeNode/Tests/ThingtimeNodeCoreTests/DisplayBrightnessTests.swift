import XCTest
import CoreGraphics
@testable import ThingtimeNodeCore

final class DisplayBrightnessTests: XCTestCase {
    func testHardwareBrightnessRoundTripWhenRequested() throws {
        guard ProcessInfo.processInfo.environment["TT_BRIGHTNESS_HARDWARE_TEST"] == "1" else { throw XCTSkip("Explicit hardware acceptance only") }
        let display = CGMainDisplayID()
        let before = try XCTUnwrap(SystemDisplayBrightness.snapshot(for: display))
        XCTAssertTrue(before.canSet)
        let target = before.level > 0.5 ? before.level - 0.05 : before.level + 0.05
        defer { try? SystemDisplayBrightness.setDisplayBrightness(before.level, displayID: display) }
        try SystemDisplayBrightness.setDisplayBrightness(target, displayID: display)
        Thread.sleep(forTimeInterval: 0.2)
        let after = try XCTUnwrap(SystemDisplayBrightness.snapshot(for: display))
        XCTAssertEqual(after.level, target, accuracy: 0.025)
        try SystemDisplayBrightness.setDisplayBrightness(before.level, displayID: display)
        Thread.sleep(forTimeInterval: 0.2)
        XCTAssertEqual(try XCTUnwrap(SystemDisplayBrightness.snapshot(for: display)).level, before.level, accuracy: 0.025)
    }

    func testNativeDisplayDoesNotRequireLegacyIOKitService() {
        var observed: UInt32?
        let snapshot = SystemDisplayBrightness.readSnapshot(displayID: 42, nativeRead: {
            observed = $0
            return 0.65
        }, nativeWritable: true, legacyRead: { _ in XCTFail("Native reading must win"); return nil })
        XCTAssertEqual(observed, 42)
        XCTAssertEqual(snapshot, DisplayBrightnessSnapshot(level: 0.65, canSet: true))
    }

    func testUnavailableAndInvalidNativeReadFallsBackToSameDisplay() {
        for value in [nil, .nan, .infinity, -0.1, 1.1] as [Double?] {
            let snapshot = SystemDisplayBrightness.readSnapshot(displayID: 73, nativeRead: { _ in value }, nativeWritable: true, legacyRead: {
                XCTAssertEqual($0, 73)
                return DisplayBrightnessSnapshot(level: 0.3, canSet: true)
            })
            XCTAssertEqual(snapshot?.level, 0.3)
        }
    }

    func testReadOnlyAndUnsupportedDisplaysStayHonest() {
        let readOnly = SystemDisplayBrightness.readSnapshot(displayID: 1, nativeRead: { _ in 0 }, nativeWritable: false, legacyRead: { _ in nil })
        XCTAssertEqual(readOnly, DisplayBrightnessSnapshot(level: 0, canSet: false))
        XCTAssertNil(SystemDisplayBrightness.readSnapshot(displayID: 2, nativeRead: { _ in nil }, nativeWritable: true, legacyRead: { _ in nil }))
    }
}
