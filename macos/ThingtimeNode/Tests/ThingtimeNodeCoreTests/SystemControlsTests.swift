import CoreFoundation
import XCTest
@testable import ThingtimeNodeCore

final class SystemControlsTests: XCTestCase {
    func testBatteryDetailsUseWhitelistedReadingsAndIgnoreInvalidEstimates() {
        let basic = BatteryTelemetry(level: 0.8, isCharging: false, isExternalPower: false, isPreventingIdleSleep: false)
        let result = SystemBattery.enriched(basic, battery: [
            "CycleCount": 280, "DesignCycleCount9C": 1000, "DesignCapacity": 6200,
            "BatteryData": ["FullChargeCapacity": 5200, "RemainingCapacity": 4100],
            "Amperage": -1200, "Voltage": 12000, "Temperature": 3150,
            "TimeRemaining": 65535, "Serial": "must-not-leave-device"
        ], adapter: ["Watts": 100, "AdapterVoltage": 20000, "Current": 5000])
        XCTAssertEqual(result.cycleCount, 280)
        XCTAssertEqual(result.fullChargeCapacityMAh, 5200)
        XCTAssertEqual(result.currentMA, -1200)
        XCTAssertEqual(result.temperatureC, 31.5)
        XCTAssertNil(result.timeToEmptyMinutes)
        XCTAssertEqual(result.adapterWatts, 100)
        let encoded = String(data: try! JSONEncoder().encode(result), encoding: .utf8)!
        XCTAssertFalse(encoded.contains("must-not-leave-device"))
        XCTAssertFalse(encoded.contains("Serial"))
    }

    func testBatteryAdapterFallsBackToSmartBatteryRegistry() {
        let basic = BatteryTelemetry(level: 1, isCharging: false, isExternalPower: true, isPreventingIdleSleep: false)
        let result = SystemBattery.enriched(basic, battery: [
            "CycleCount": 282, "InstantAmperage": 0,
            "AdapterDetails": ["Watts": 100, "AdapterVoltage": 20000, "Current": 5000]
        ], adapter: [:])
        XCTAssertEqual(result.cycleCount, 282)
        XCTAssertEqual(result.currentMA, 0)
        XCTAssertEqual(result.adapterWatts, 100)
        XCTAssertEqual(result.adapterVoltageMV, 20000)
        XCTAssertEqual(result.adapterCurrentMA, 5000)
    }

    func testPrinterStringNormalizesSDKOwnershipVariants() {
        let value = "Office printer" as CFString

        XCTAssertEqual(SystemPrinters.printerString("Office printer"), "Office printer")
        XCTAssertEqual(SystemPrinters.printerString(value), "Office printer")
        XCTAssertEqual(
            SystemPrinters.printerString(Unmanaged.passUnretained(value)),
            "Office printer"
        )
    }
}
