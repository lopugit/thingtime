import Foundation
import XCTest
@testable import ThingtimeNodeCore

final class DeviceResourcesTests: XCTestCase {
    func testCPUBusyTicksIncludeUserSystemAndNiceAcrossWrap() throws {
        typealias Ticks = DeviceResourceSampler.CPUTicks
        let first = Ticks(user: UInt32.max - 2, system: 12, idle: 25, nice: 15)
        let second = Ticks(user: 3, system: 13, idle: 45, nice: 18)
        XCTAssertNil(first.usage(since: first))
        XCTAssertEqual(try XCTUnwrap(second.usage(since: first)), 100 / 3, accuracy: 0.00001)
    }

    func testNetworkAndDiskUse64BitDeltasAndOmitUnstableSamples() throws {
        typealias Counters = DeviceResourceSampler.ByteCounters
        let first: [UInt16: Counters] = [1: .init(input: 6_000_000_000, output: 12), 2: .init(input: 7, output: 18)]
        let second: [UInt16: Counters] = [1: .init(input: 6_000_000_031, output: 12), 2: .init(input: 9, output: 18)]
        let rates = try XCTUnwrap(Counters.rates(previous: first, current: second, elapsed: 2))
        XCTAssertEqual(rates.input, 16.5)
        XCTAssertEqual(rates.output, 0)
        XCTAssertNil(Counters.rates(previous: first, current: [1: second[1]!], elapsed: 2))
        XCTAssertNil(Counters.rates(previous: second, current: first, elapsed: 2))
        XCTAssertNil(Counters.rates(previous: first, current: second, elapsed: 0))
        let empty: [UInt64: Counters] = [:]
        XCTAssertNil(Counters.rates(previous: empty, current: empty, elapsed: 2))
        let drive: UInt64 = 0x2_0000_0000
        let diskBefore = [drive: Counters(input: 8_000_000_000, output: 4_000_000_000)]
        let diskAfter = [drive: Counters(input: 8_000_001_000, output: 4_000_000_500)]
        let diskRates = try XCTUnwrap(Counters.rates(previous: diskBefore, current: diskAfter, elapsed: 0.5))
        XCTAssertEqual(diskRates.input, 2_000)
        XCTAssertEqual(diskRates.output, 1_000)
        XCTAssertNil(Counters.rates(previous: diskAfter, current: diskBefore, elapsed: 2))
        XCTAssertNil(Counters.rates(previous: diskBefore, current: nil, elapsed: 2))
    }

    func testFirstHostSampleOmitsRatesFromJSON() throws {
        var sampler = DeviceResourceSampler()
        let first = try XCTUnwrap(sampler.snapshot(uptime: 1))
        XCTAssertEqual(first.memoryTotalBytes, ProcessInfo.processInfo.physicalMemory)
        let encoded = try JSONEncoder().encode(first)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        for key in ["cpuPercent", "diskReadBytesPerSecond", "diskWriteBytesPerSecond", "networkRxBytesPerSecond", "networkTxBytesPerSecond", "networkLinkBitsPerSecond"] {
            XCTAssertNil(json[key])
        }
    }

    func testResourceNegotiationRequiresCompatibleSelectedOrigin() throws {
        let origin = URL(string: "https://thingtime.test")!
        let otherOrigin = URL(string: "https://other.test")!
        for (version, expected) in [(nil, false), ("1.13.9", false), ("1.14.0", true), ("1.15.1", true), ("2.0.0", false)] as [(String?, Bool)] {
            var features = ThingtimeAPIClient.capabilityRequirements.mapValues { ["version": $0] }
            features["api.devices-node-state"] = version.map { ["version": $0] }
            let bytes = try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "origin": origin.absoluteString, "features": features])
            XCTAssertEqual(ThingtimeAPIClient.supportsResources(bytes, origin: origin), expected)
            XCTAssertFalse(ThingtimeAPIClient.supportsResources(bytes, origin: otherOrigin))
        }
    }
}
