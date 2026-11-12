import AppleFileSync
import Foundation

final class MacSyncResources: @unchecked Sendable {
    @TaskLocal static var current: MacSyncResources?
    private var savedPolicy: SyncResourceLimits
    let scan: SyncScanBudget
    private var savedDevicePolicy: DeviceSyncResourcePolicy
    private var previousScan: (bytes: UInt64, at: Double)?
    private var scanRate: Double?
    var policy: SyncResourceLimits { lock.lock(); defer { lock.unlock() }; return savedPolicy }
    var devicePolicy: DeviceSyncResourcePolicy { lock.lock(); defer { lock.unlock() }; return savedDevicePolicy }
    let source: SyncSourceCpuMeter
    private let lock = NSLock()
    private var index: CommanderResourceUsage?
    private var indexAt = 0.0
    private var indexCpu: Double?
    private var cpuObservation: (cpu: UInt64, wall: UInt64)?
    private var sourceObservation: (cpu: Double, wall: Double)?
    private var sourceCpu: Double?
    init(_ policy: SyncResourceLimits, device: DeviceSyncResourcePolicy = .init()) { self.savedPolicy = policy; savedDevicePolicy = device; scan = SyncScanBudget(bytesPerSecond: device.scanBytesPerSecond / 2); source = SyncSourceCpuMeter(cpuPercent: policy.cpuPercent, concurrency: policy.transferConcurrency ?? 16) }
    func update(_ usage: CommanderResourceUsage) {
        lock.lock(); defer { lock.unlock() }; index = usage
        indexAt = ProcessInfo.processInfo.systemUptime
        if let old = cpuObservation, usage.cpuTimeNanoseconds >= old.cpu, usage.wallTimeNanoseconds > old.wall {
            indexCpu = min(100, Double(usage.cpuTimeNanoseconds - old.cpu) / Double(usage.wallTimeNanoseconds - old.wall) / Double(usage.effective.logicalCpuCount) * 100)
        } else { indexCpu = nil }
        cpuObservation = (usage.cpuTimeNanoseconds, usage.wallTimeNanoseconds)
        let now = ProcessInfo.processInfo.systemUptime
        if let bytes = usage.scanBytes {
            if let old = previousScan, bytes >= old.bytes, now > old.at { scanRate = Double(bytes - old.bytes) / (now - old.at) } else { scanRate = nil }
            previousScan = (bytes, now)
        }
    }
    func configure(_ device: DeviceSyncResourcePolicy, connection: SyncResourceLimits?) throws {
        lock.lock(); defer { lock.unlock() }
        savedDevicePolicy = device
        savedPolicy = try SyncResourceLimits(uploadBytesPerSecond: connection?.uploadBytesPerSecond, downloadBytesPerSecond: connection?.downloadBytesPerSecond, transferConcurrency: connection?.transferConcurrency, indexingConcurrency: connection?.indexingConcurrency, cpuPercent: min(device.cpuPercent, connection?.cpuPercent ?? 100))
        scan.setRate(device.scanBytesPerSecond / 2); source.setCpuTarget(savedPolicy.cpuPercent!)
    }
    func snapshot() -> JSONValue {
        lock.lock(); defer { lock.unlock() }
        let now = ProcessInfo.processInfo.systemUptime
        let indexing = index?.cpuMeasurementAvailable == true && now - indexAt < 2 ? index : nil
        let sourceSeconds = source.measuredCpuSeconds
        if let old = sourceObservation, now - old.wall >= 0.25 {
            sourceCpu = min(100, max(0, sourceSeconds - old.cpu) / (now - old.wall) / Double(ProcessInfo.processInfo.activeProcessorCount) * 100)
            sourceObservation = (sourceSeconds, now)
        } else if sourceObservation == nil { sourceObservation = (sourceSeconds, now) }
        let cpu = sourceCpu
        let helperScan = previousScan.map { now - $0.at < 2 } == true ? scanRate : nil
        let localScan = scan.currentBytesPerSecond
        let currentScan: Double? = helperScan == nil && localScan == nil ? nil : (helperScan ?? 0) + (localScan ?? 0)
        var value: [String: JSONValue] = ["version": .number(1), "measuredAt": .number(Date().timeIntervalSince1970 * 1000), "scanBytesPerSecond": currentScan.map(JSONValue.number) ?? .null, "memoryBytes": indexing?.residentMemoryBytes.map { .number(Double($0)) } ?? .null, "cpuPercent": cpu.map(JSONValue.number) ?? .null,
            "cpuStatus": .string(cpu == nil ? "unavailable" : "measured"),
            "sourceCpuPercent": cpu.map(JSONValue.number) ?? .null,
            "indexingCpuPercent": (indexing == nil ? nil : indexCpu).map(JSONValue.number) ?? .null,
            "cpuScopes": .array(cpu == nil ? [] : [.string("source-thread")]),
            "effectiveTransferConcurrency": .number(Double(source.effectiveConcurrency)),
            "effectiveIndexingConcurrency": .number(Double(indexing?.activeWorkerLimit ?? min(ProcessInfo.processInfo.activeProcessorCount, 64, savedPolicy.indexingConcurrency ?? 4)))]
        if indexing != nil, let indexCpu {
            value["cpuPercent"] = .number(min(100, (cpu ?? 0) + indexCpu)); value["cpuStatus"] = .string("measured")
            value["cpuScopes"] = .array(cpu == nil ? [.string("indexer-process")] : [.string("source-thread"), .string("indexer-process")])
        }
        if let v = savedPolicy.uploadBytesPerSecond { value["uploadBytesPerSecond"] = .number(v) }
        if let v = savedPolicy.downloadBytesPerSecond { value["downloadBytesPerSecond"] = .number(v) }
        if let v = savedPolicy.cpuPercent { value["scopeCpuBudgetPercent"] = .number(Double(v) / 3) }
        return .object(value)
    }
}
