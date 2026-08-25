import XCTest
import ApplicationServices
@testable import Commander

@MainActor
final class SystemMetricsServiceTests: XCTestCase {
  func testFullDiskAccessProbeReportsTheInjectedPermissionState() {
    XCTAssertTrue(FullDiskAccessService.isGranted { path in
      XCTAssertEqual(path, FullDiskAccessService.protectedProbePath)
      return true
    })
    XCTAssertFalse(FullDiskAccessService.isGranted { _ in false })
  }

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
    let memory = machine?["memory"] as? [String: Any]
    XCTAssertEqual(memory?["totalBytes"] as? UInt64, memoryTotal)
    XCTAssertLessThanOrEqual(memory?["activeBytes"] as? UInt64 ?? 0, memoryTotal)
    XCTAssertLessThanOrEqual(memory?["wiredBytes"] as? UInt64 ?? 0, memoryTotal)
    XCTAssertLessThanOrEqual(memory?["cachedBytes"] as? UInt64 ?? 0, memoryTotal)
    XCTAssertLessThanOrEqual(memory?["compressedBytes"] as? UInt64 ?? 0, memoryTotal)
    XCTAssertLessThanOrEqual(memory?["purgeableBytes"] as? UInt64 ?? 0, memoryTotal)
    let filesystemTotal = machine?["filesystemTotalBytes"] as? UInt64 ?? 0
    let filesystemAvailable = machine?["filesystemAvailableBytes"] as? UInt64 ?? 0
    XCTAssertGreaterThan(filesystemTotal, 0)
    XCTAssertLessThanOrEqual(filesystemAvailable, filesystemTotal)
    let filesystem = machine?["filesystem"] as? [String: Any]
    XCTAssertEqual(filesystem?["totalBytes"] as? UInt64, filesystemTotal)
    XCTAssertLessThanOrEqual(filesystem?["purgeableBytes"] as? UInt64 ?? 0, filesystemTotal)
    let processes = machine?["processes"] as? [[String: Any]]
    XCTAssertNotNil(processes)
    XCTAssertTrue((processes ?? []).allSatisfy { row in
      row["pid"] is Int && row["parentPid"] is Int && row["name"] is String &&
        row["cpuPercent"] is Double && row["residentMemoryBytes"] is UInt64 &&
        row["diskReadBytesPerSecond"] is Double && row["diskWriteBytesPerSecond"] is Double
    })
    XCTAssertNotNil(machine?["responsivenessApplications"] as? [[String: Any]])
    XCTAssertNotNil(machine?["gpu"] as? [String: Any])
  }

  func testResponsivenessSignalsSeparateConfirmedUIFromAgentAndServiceProbeLimits() {
    XCTAssertEqual(ApplicationResponsivenessService.applicationKind(for: .regular), .ui)
    XCTAssertEqual(ApplicationResponsivenessService.applicationKind(for: .accessory), .agent)
    XCTAssertEqual(ApplicationResponsivenessService.applicationKind(for: .prohibited), .service)

    XCTAssertEqual(
      ApplicationResponsivenessService.signal(
        for: .ui,
        firstProbe: .timedOut,
        confirmationProbe: .timedOut
      ),
      .repeatedAccessibilityTimeout
    )
    XCTAssertNil(
      ApplicationResponsivenessService.signal(
        for: .ui,
        firstProbe: .timedOut,
        confirmationProbe: .responded
      )
    )
    XCTAssertEqual(
      ApplicationResponsivenessService.signal(for: .agent, firstProbe: .timedOut),
      .accessibilityProbeInconclusive
    )
    XCTAssertEqual(
      ApplicationResponsivenessService.signal(for: .service, firstProbe: .timedOut),
      .accessibilityProbeInconclusive
    )
  }
}
