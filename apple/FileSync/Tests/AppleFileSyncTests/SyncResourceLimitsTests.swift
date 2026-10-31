import Foundation
import CryptoKit
import Darwin
import XCTest
@testable import AppleFileSync

final class SyncResourceLimitsTests: XCTestCase {
    func testClosedNativePolicyAndExactIEEE754Fields() throws {
        let value = try SyncResourceLimits(uploadBytesPerSecond: 312.5, downloadBytesPerSecond: 1e-7, transferConcurrency: 2, indexingConcurrency: 3, cpuPercent: 1)
        XCTAssertEqual(value.canonicalFields, ["4073880000000000", "3e7ad7f29abcaf48", "4000000000000000", "4008000000000000", "3ff0000000000000"])
        for json in ["{\"cpuPercent\":0}", "{\"cpuPercent\":1.5}", "{\"indexingConcurrency\":0}", "{\"deviceCpu\":20}", "{\"uploadBytesPerSecond\":null}"] {
            XCTAssertThrowsError(try JSONDecoder().decode(SyncResourceLimits.self, from: Data(json.utf8)))
        }
    }
    func testNestedHashChunksDoNotDoubleCountThreadCPU() throws {
        let meter = SyncSourceCpuMeter(cpuPercent: nil)
        var before = timespec(), after = timespec()
        XCTAssertEqual(clock_gettime(CLOCK_THREAD_CPUTIME_ID, &before), 0)
        let digest = try meter.measure {
            try meter.measure({ SHA256.hash(data: Data(repeating: 7, count: 8 * 1024 * 1024)) }, admit: false)
        }
        XCTAssertEqual(Array(digest).count, 32)
        XCTAssertEqual(clock_gettime(CLOCK_THREAD_CPUTIME_ID, &after), 0)
        let actual = Double(after.tv_sec - before.tv_sec) + Double(after.tv_nsec - before.tv_nsec) / 1_000_000_000
        XCTAssertGreaterThan(meter.measuredCpuSeconds, 0)
        XCTAssertLessThanOrEqual(meter.measuredCpuSeconds, actual * 1.05 + 0.0001)
    }
    func testThreadCPUCounterSharesQuotaAndCancellation() async throws {
        let meter = SyncSourceCpuMeter(cpuPercent: 1, concurrency: 4)
        let task = Task.detached {
            try meter.measure { var total = 0; for i in 0..<200_000 { total &+= i }; return total }
            try meter.checkpoint()
        }
        task.cancel()
        do { try await task.value; XCTFail("CPU wait ignored cancellation") } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertLessThanOrEqual(meter.effectiveConcurrency, 4)
    }
}
