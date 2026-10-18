import Foundation
import AppKit
import Darwin
import XCTest
@testable import ThingtimeNodeCore
final class MenuBarTelemetryTests: XCTestCase {
    func testThumbnailPreservesAspectRatioWithinWireFormat() throws {
        let context = try XCTUnwrap(CGContext(data: nil, width: 240, height: 120, bitsPerComponent: 8, bytesPerRow: 240 * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(red: 0, green: 1, blue: 0, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 240, height: 120))
        let value = try XCTUnwrap(SystemMenuBar.thumbnail(try XCTUnwrap(context.makeImage())))
        XCTAssertTrue(value.hasPrefix("data:image/png;base64,"))
        let bytes = try XCTUnwrap(Data(base64Encoded: String(value.dropFirst(22))))
        let decoded = try XCTUnwrap(NSBitmapImageRep(data: bytes))
        XCTAssertEqual(decoded.pixelsWide, 64)
        XCTAssertEqual(decoded.pixelsHigh, 32)
        XCTAssertLessThan(value.count, 32768)
    }

    func testCPUTimeUsesMachTimebase() throws {
        XCTAssertEqual(try XCTUnwrap(SystemMenuBar.cpuSeconds(user: 18_000_000, system: 6_000_000,
            timebase: .init(numer: 125, denom: 3))), 1, accuracy: 0.000001)
        XCTAssertEqual(try XCTUnwrap(SystemMenuBar.cpuSeconds(user: 750_000_000, system: 250_000_000,
            timebase: .init(numer: 1, denom: 1))), 1, accuracy: 0.000001)
        XCTAssertNil(SystemMenuBar.cpuSeconds(user: 1, system: 1, timebase: .init(numer: 1, denom: 0)))
        XCTAssertNil(SystemMenuBar.cpuSeconds(user: 1, system: 1, timebase: .init(numer: 0, denom: 1)))
        XCTAssertTrue(try XCTUnwrap(SystemMenuBar.cpuSeconds(user: .max, system: .max)).isFinite)
    }

    func testCPUTimeMatchesIndependentGetrusage() throws {
        func seconds(_ value: rusage) -> Double {
            Double(value.ru_utime.tv_sec + value.ru_stime.tv_sec)
                + Double(value.ru_utime.tv_usec + value.ru_stime.tv_usec) / 1_000_000
        }
        var before = rusage(), after = rusage(), measured = rusage_info_v2()
        XCTAssertEqual(getrusage(RUSAGE_SELF, &before), 0)
        let status = withUnsafeMutablePointer(to: &measured) { pointer in
            pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
                proc_pid_rusage(getpid(), RUSAGE_INFO_V2, $0)
            }
        }
        XCTAssertEqual(status, 0)
        XCTAssertEqual(getrusage(RUSAGE_SELF, &after), 0)
        let actual = try XCTUnwrap(SystemMenuBar.cpuSeconds(user: measured.ri_user_time, system: measured.ri_system_time))
        XCTAssertGreaterThanOrEqual(actual, seconds(before) - 0.01)
        XCTAssertLessThanOrEqual(actual, seconds(after) + 0.01)
    }

    @MainActor func testLockedSnapshotContainsNoInventory() {
        let snapshot = SystemMenuBar.snapshot(locked: true)
        XCTAssertEqual(snapshot.status, "locked")
        XCTAssertTrue(snapshot.items.isEmpty)
    }
    func testMenuBarNegotiationRequiresCompatibleSelectedOrigin() throws {
        let origin = URL(string: "https://thingtime.test")!
        for (version, expected) in [("1.10.0", false), ("1.11.0", false), ("1.12.0", false), ("1.13.0", true), ("1.14.0", true), ("2.0.0", false)] {
            var features = ThingtimeAPIClient.capabilityRequirements.mapValues { ["version": $0] }
            features["api.devices-node-state"] = ["version": version]
            let bytes = try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "origin": origin.absoluteString, "features": features])
            XCTAssertEqual(ThingtimeAPIClient.supportsMenuBar(bytes, origin: origin), expected)
            XCTAssertFalse(ThingtimeAPIClient.supportsMenuBar(bytes, origin: URL(string: "https://other.test")!))
        }
    }
}
