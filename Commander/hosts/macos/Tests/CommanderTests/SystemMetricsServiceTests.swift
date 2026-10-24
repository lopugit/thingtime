import XCTest
@testable import Commander

@MainActor
final class SystemMetricsServiceTests: XCTestCase {
  func testParsesMacOSGPUUtilizationWithOrWithoutSpacing() {
    XCTAssertEqual(
      SystemMetricsService.gpuUtilization(
        fromIORegistry: #""PerformanceStatistics" = {"Device Utilization %"=52}"#
      ),
      52
    )
    XCTAssertEqual(
      SystemMetricsService.gpuUtilization(
        fromIORegistry: #""Device Utilization %" = 101"#
      ),
      100
    )
    XCTAssertNil(SystemMetricsService.gpuUtilization(fromIORegistry: "no performance statistics"))
  }

  func testSnapshotHasBoundedMachineAndCommanderMetrics() {
    let service = SystemMetricsService(daemonPID: Int32(getpid()))
    let first = service.snapshot()
    let second = service.snapshot()

    let commander = try? XCTUnwrap(second["commander"] as? [String: Any])
    let machine = try? XCTUnwrap(second["machine"] as? [String: Any])
    XCTAssertNotNil(first["sampledAtMs"])
    XCTAssertNotNil(commander)
    XCTAssertNotNil(machine)
    XCTAssertEqual(commander?["processCount"] as? Int, 1)
    XCTAssertGreaterThanOrEqual(commander?["residentMemoryBytes"] as? UInt64 ?? 0, 0)

    let cpu = machine?["cpuPercent"] as? Double ?? -1
    XCTAssertGreaterThanOrEqual(cpu, 0)
    XCTAssertLessThanOrEqual(cpu, 100)
    XCTAssertGreaterThan(machine?["logicalCpuCount"] as? Int ?? 0, 0)
    let memoryUsed = machine?["memoryUsedBytes"] as? UInt64 ?? 0
    let memoryTotal = machine?["memoryTotalBytes"] as? UInt64 ?? 0
    XCTAssertGreaterThan(memoryTotal, 0)
    XCTAssertLessThanOrEqual(memoryUsed, memoryTotal)
    let filesystemTotal = machine?["filesystemTotalBytes"] as? UInt64 ?? 0
    let filesystemAvailable = machine?["filesystemAvailableBytes"] as? UInt64 ?? 0
    XCTAssertGreaterThan(filesystemTotal, 0)
    XCTAssertLessThanOrEqual(filesystemAvailable, filesystemTotal)
    XCTAssertNotNil(machine?["gpu"] as? [String: Any])
  }
}
