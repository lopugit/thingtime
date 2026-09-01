import Darwin
import Foundation
import Metal
import OSLog

@MainActor
final class SystemMetricsService {
  private let daemonPID: pid_t
  private let applicationResponsiveness: ApplicationResponsivenessService
  private let logger = Logger(subsystem: "com.thingtime.Commander", category: "Metrics")
  private var previousMachineCPU: (total: UInt64, idle: UInt64)?
  private var previousCommanderCPU: (nanoseconds: UInt64, sampledAt: UInt64)?
  private var cachedStorage: (sampledAt: Date, bytes: UInt64)?
  private var cachedGPU: (sampledAt: Date, utilization: Double?)?
  private var previousProcesses: [pid_t: ProcessCounters] = [:]
  private var loggedFirstSample = false

  private struct ProcessCounters {
    let cpuNanoseconds: UInt64
    let diskReadBytes: UInt64
    let diskWriteBytes: UInt64
    let sampledAt: UInt64
  }

  init(daemonPID: Int32, applicationResponsiveness: ApplicationResponsivenessService = ApplicationResponsivenessService()) {
    self.daemonPID = daemonPID
    self.applicationResponsiveness = applicationResponsiveness
  }

  func snapshot() -> [String: Any] {
    let processMetrics = commanderProcessMetrics()
    let machineCPU = machineCPUPercent()
    let memory = machineMemory()
    let filesystem = filesystemUsage()
    let gpu = gpuUsage()
    let processes = machineProcesses()

    if !loggedFirstSample {
      logger.info("Commander activity sampling started")
      loggedFirstSample = true
    }

    return [
      "sampledAtMs": Int(Date().timeIntervalSince1970 * 1_000),
      "commander": [
        "cpuPercent": processMetrics.cpuPercent,
        "residentMemoryBytes": processMetrics.residentBytes,
        "virtualMemoryBytes": processMetrics.virtualBytes,
        "storageBytes": storageUsageBytes(),
        "processCount": processMetrics.processCount,
      ],
      "machine": [
        "cpuPercent": machineCPU,
        "logicalCpuCount": ProcessInfo.processInfo.processorCount,
        "memoryUsedBytes": memory.usedBytes,
        "memoryTotalBytes": memory.totalBytes,
        "thermalState": thermalState(),
        "filesystemUsedBytes": filesystem.usedBytes,
        "filesystemTotalBytes": filesystem.totalBytes,
        "filesystemAvailableBytes": filesystem.availableBytes,
        "memory": [
          "usedBytes": memory.usedBytes,
          "totalBytes": memory.totalBytes,
          "activeBytes": memory.activeBytes,
          "wiredBytes": memory.wiredBytes,
          "cachedBytes": memory.cachedBytes,
          "compressedBytes": memory.compressedBytes,
          "purgeableBytes": memory.purgeableBytes,
        ],
        "filesystem": [
          "usedBytes": filesystem.usedBytes,
          "totalBytes": filesystem.totalBytes,
          "availableBytes": filesystem.availableBytes,
          "purgeableBytes": filesystem.purgeableBytes,
        ],
        "responsivenessApplications": applicationResponsiveness.snapshot(),
        "processes": processes,
        "gpu": gpu,
      ],
    ]
  }

  private func commanderProcessMetrics() -> (
    cpuPercent: Double, residentBytes: UInt64, virtualBytes: UInt64, processCount: Int
  ) {
    let pids = Array(Set([getpid(), daemonPID])).filter { $0 > 1 }
    let records = pids.compactMap(processMetrics(for:))
    let cpuNanoseconds = records.reduce(UInt64(0)) { $0 + $1.cpuNanoseconds }
    let now = DispatchTime.now().uptimeNanoseconds
    let cpuPercent: Double
    if let previous = previousCommanderCPU, now > previous.sampledAt, cpuNanoseconds >= previous.nanoseconds {
      cpuPercent = min(
        Double(ProcessInfo.processInfo.processorCount * 100),
        (Double(cpuNanoseconds - previous.nanoseconds) / Double(now - previous.sampledAt)) * 100
      )
    } else {
      cpuPercent = 0
    }
    previousCommanderCPU = (cpuNanoseconds, now)
    return (
      cpuPercent,
      records.reduce(UInt64(0)) { $0 + $1.residentBytes },
      records.reduce(UInt64(0)) { $0 + $1.virtualBytes },
      records.count
    )
  }

  private func processMetrics(for pid: pid_t) -> (cpuNanoseconds: UInt64, residentBytes: UInt64, virtualBytes: UInt64)? {
    var info = proc_taskinfo()
    guard proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, Int32(MemoryLayout<proc_taskinfo>.size)) == Int32(MemoryLayout<proc_taskinfo>.size) else {
      return nil
    }
    return (
      info.pti_total_user + info.pti_total_system,
      info.pti_resident_size,
      info.pti_virtual_size
    )
  }

  private func machineCPUPercent() -> Double {
    var processors: natural_t = 0
    var count: mach_msg_type_number_t = 0
    var values: processor_info_array_t?
    guard host_processor_info(
      mach_host_self(),
      PROCESSOR_CPU_LOAD_INFO,
      &processors,
      &values,
      &count
    ) == KERN_SUCCESS, let values else { return 0 }
    defer {
      vm_deallocate(
        mach_task_self_,
        vm_address_t(UInt(bitPattern: values)),
        vm_size_t(count) * vm_size_t(MemoryLayout<integer_t>.size)
      )
    }

    var total: UInt64 = 0
    var idle: UInt64 = 0
    let states = Int(CPU_STATE_MAX)
    for processor in 0..<Int(processors) {
      let base = processor * states
      for state in 0..<states {
        total += UInt64(max(0, values[base + state]))
      }
      idle += UInt64(max(0, values[base + Int(CPU_STATE_IDLE)]))
    }
    defer { previousMachineCPU = (total, idle) }
    guard let previous = previousMachineCPU, total > previous.total, idle >= previous.idle else { return 0 }
    let elapsed = total - previous.total
    return min(100, max(0, (Double(elapsed - (idle - previous.idle)) / Double(elapsed)) * 100))
  }

  private func machineMemory() -> (
    usedBytes: UInt64,
    totalBytes: UInt64,
    activeBytes: UInt64,
    wiredBytes: UInt64,
    cachedBytes: UInt64,
    compressedBytes: UInt64,
    purgeableBytes: UInt64
  ) {
    var statistics = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &statistics) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
      }
    }
    guard result == KERN_SUCCESS else {
      return (0, ProcessInfo.processInfo.physicalMemory, 0, 0, 0, 0, 0)
    }
    var pageSize: vm_size_t = 0
    host_page_size(mach_host_self(), &pageSize)
    let bytesPerPage = UInt64(pageSize)
    let activeBytes = UInt64(statistics.active_count) * bytesPerPage
    let wiredBytes = UInt64(statistics.wire_count) * bytesPerPage
    let cachedBytes = UInt64(statistics.external_page_count) * bytesPerPage
    let compressedBytes = UInt64(statistics.compressor_page_count) * bytesPerPage
    let purgeableBytes = UInt64(statistics.purgeable_count) * bytesPerPage
    let usedPages = UInt64(statistics.wire_count) + UInt64(statistics.active_count) +
      UInt64(statistics.inactive_count) + UInt64(statistics.compressor_page_count) -
      UInt64(min(statistics.purgeable_count, statistics.inactive_count))
    return (
      usedPages * bytesPerPage,
      ProcessInfo.processInfo.physicalMemory,
      activeBytes,
      wiredBytes,
      cachedBytes,
      compressedBytes,
      purgeableBytes
    )
  }

  private func filesystemUsage() -> (
    usedBytes: UInt64, totalBytes: UInt64, availableBytes: UInt64, purgeableBytes: UInt64
  ) {
    guard let attributes = try? FileManager.default.attributesOfFileSystem(forPath: NSHomeDirectory()),
          let total = attributes[.systemSize] as? NSNumber,
          let available = attributes[.systemFreeSize] as? NSNumber else { return (0, 0, 0, 0) }
    let totalBytes = total.uint64Value
    let availableBytes = available.uint64Value
    let volume = URL(fileURLWithPath: NSHomeDirectory())
    let values = try? volume.resourceValues(forKeys: [
      .volumeAvailableCapacityForOpportunisticUsageKey,
    ])
    let opportunistic = values?.volumeAvailableCapacityForOpportunisticUsage.map { UInt64(max(0, $0)) } ?? availableBytes
    let purgeableBytes = opportunistic >= availableBytes ? opportunistic - availableBytes : 0
    return (
      totalBytes >= availableBytes ? totalBytes - availableBytes : 0,
      totalBytes,
      availableBytes,
      purgeableBytes
    )
  }

  private func machineProcesses() -> [[String: Any]] {
    let now = DispatchTime.now().uptimeNanoseconds
    var next: [pid_t: ProcessCounters] = [:]
    var rows: [[String: Any]] = []
    for pid in activePIDs() {
      guard let task = processMetrics(for: pid), let bsd = processBSDInfo(for: pid) else { continue }
      let usage = processResourceUsage(for: pid)
      let counters = ProcessCounters(
        cpuNanoseconds: task.cpuNanoseconds,
        diskReadBytes: usage?.readBytes ?? 0,
        diskWriteBytes: usage?.writeBytes ?? 0,
        sampledAt: now
      )
      let previous = previousProcesses[pid]
      let elapsed = previous.map { now > $0.sampledAt ? now - $0.sampledAt : 0 } ?? 0
      let cpuPercent: Double
      let diskReadPerSecond: Double
      let diskWritePerSecond: Double
      if let previous, elapsed > 0 {
        cpuPercent = task.cpuNanoseconds >= previous.cpuNanoseconds
          ? min(
            Double(ProcessInfo.processInfo.processorCount * 100),
            Double(task.cpuNanoseconds - previous.cpuNanoseconds) / Double(elapsed) * 100
          )
          : 0
        diskReadPerSecond = counters.diskReadBytes >= previous.diskReadBytes
          ? Double(counters.diskReadBytes - previous.diskReadBytes) / Double(elapsed) * 1_000_000_000
          : 0
        diskWritePerSecond = counters.diskWriteBytes >= previous.diskWriteBytes
          ? Double(counters.diskWriteBytes - previous.diskWriteBytes) / Double(elapsed) * 1_000_000_000
          : 0
      } else {
        cpuPercent = 0
        diskReadPerSecond = 0
        diskWritePerSecond = 0
      }
      next[pid] = counters
      rows.append([
        "pid": Int(pid),
        "parentPid": Int(bsd.pbi_ppid),
        "name": processName(for: pid),
        "cpuPercent": cpuPercent,
        "residentMemoryBytes": task.residentBytes,
        "diskReadBytesPerSecond": diskReadPerSecond,
        "diskWriteBytesPerSecond": diskWritePerSecond,
      ])
    }
    previousProcesses = next
    return rows.sorted {
      ($0["cpuPercent"] as? Double ?? 0) > ($1["cpuPercent"] as? Double ?? 0)
    }
  }

  private func activePIDs() -> [pid_t] {
    let bytes = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
    guard bytes > 0 else { return [] }
    var pids = [pid_t](repeating: 0, count: Int(bytes) / MemoryLayout<pid_t>.size)
    let written = pids.withUnsafeMutableBufferPointer {
      proc_listpids(
        UInt32(PROC_ALL_PIDS),
        0,
        $0.baseAddress,
        Int32($0.count * MemoryLayout<pid_t>.size)
      )
    }
    guard written > 0 else { return [] }
    return pids.prefix(Int(written) / MemoryLayout<pid_t>.size).filter { $0 > 1 }
  }

  private func processBSDInfo(for pid: pid_t) -> proc_bsdinfo? {
    var info = proc_bsdinfo()
    return proc_pidinfo(
      pid,
      PROC_PIDTBSDINFO,
      0,
      &info,
      Int32(MemoryLayout<proc_bsdinfo>.size)
    ) == Int32(MemoryLayout<proc_bsdinfo>.size) ? info : nil
  }

  private func processResourceUsage(for pid: pid_t) -> (readBytes: UInt64, writeBytes: UInt64)? {
    var usage = rusage_info_v4()
    let result = withUnsafeMutablePointer(to: &usage) {
      $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
        proc_pid_rusage(pid, RUSAGE_INFO_V4, $0)
      }
    }
    guard result == 0 else { return nil }
    return (usage.ri_diskio_bytesread, usage.ri_diskio_byteswritten)
  }

  private func processName(for pid: pid_t) -> String {
    var name = [CChar](repeating: 0, count: 256)
    let count = proc_name(pid, &name, UInt32(name.count))
    guard count > 0 else { return "Process \(pid)" }
    return String(decoding: name.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
  }

  private func storageUsageBytes() -> UInt64 {
    if let cachedStorage, Date().timeIntervalSince(cachedStorage.sampledAt) < 10 { return cachedStorage.bytes }
    let home = FileManager.default.homeDirectoryForCurrentUser
    let locations = [
      Bundle.main.bundleURL,
      home.appendingPathComponent("Library/Application Support/Commander", isDirectory: true),
      home.appendingPathComponent("Library/Caches/Commander", isDirectory: true),
    ]
    let bytes = locations.reduce(UInt64(0)) { $0 + directorySize(at: $1) }
    cachedStorage = (Date(), bytes)
    return bytes
  }

  private func directorySize(at url: URL) -> UInt64 {
    guard let enumerator = FileManager.default.enumerator(
      at: url,
      includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
      options: []
    ) else { return 0 }
    var total: UInt64 = 0
    for case let file as URL in enumerator {
      guard let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
            values.isRegularFile == true else { continue }
      total += UInt64(max(0, values.fileSize ?? 0))
    }
    return total
  }

  private func gpuUsage() -> [String: Any] {
    let device = MTLCreateSystemDefaultDevice()
    let utilization = gpuUtilization()
    var result: [String: Any] = [
      "name": device?.name ?? "No Metal GPU detected",
      "available": device != nil,
      "source": utilization == nil ? "unavailable" : "io-registry",
    ]
    if let utilization { result["utilizationPercent"] = utilization }
    return result
  }

  private func gpuUtilization() -> Double? {
    if let cachedGPU, Date().timeIntervalSince(cachedGPU.sampledAt) < 2 { return cachedGPU.utilization }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/ioreg")
    process.arguments = ["-r", "-c", "IOAccelerator", "-d", "1"]
    let output = Pipe()
    process.standardOutput = output
    process.standardError = Pipe()
    let utilization: Double?
    do {
      try process.run()
      process.waitUntilExit()
      guard process.terminationStatus == 0 else {
        cachedGPU = (Date(), nil)
        return nil
      }
      let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
      utilization = Self.gpuUtilization(fromIORegistry: text)
    } catch {
      utilization = nil
    }
    cachedGPU = (Date(), utilization)
    return utilization
  }

  static func gpuUtilization(fromIORegistry text: String) -> Double? {
    guard let expression = try? NSRegularExpression(pattern: #"Device Utilization %"\s*=\s*([0-9]+)"#) else {
      return nil
    }
    let range = NSRange(text.startIndex..., in: text)
    guard let match = expression.firstMatch(in: text, range: range),
          let valueRange = Range(match.range(at: 1), in: text),
          let value = Double(text[valueRange]) else { return nil }
    return min(100, max(0, value))
  }

  private func thermalState() -> String {
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: "nominal"
    case .fair: "fair"
    case .serious: "serious"
    case .critical: "critical"
    @unknown default: "fair"
    }
  }
}
