import AppleFileSync
import Foundation

final class MacSyncResources: @unchecked Sendable {
    @TaskLocal static var current: MacSyncResources?
    var lastUsed = ProcessInfo.processInfo.systemUptime
    let policy: SyncResourceLimits
    let source: SyncSourceCpuMeter
    private let lock = NSLock()
    private var index: CommanderResourceUsage?
    init(_ policy: SyncResourceLimits) { self.policy = policy; source = SyncSourceCpuMeter(cpuPercent: policy.cpuPercent, concurrency: policy.transferConcurrency ?? 16) }
    func update(_ usage: CommanderResourceUsage) { lock.lock(); index = usage; lock.unlock() }
    func snapshot() -> JSONValue {
        lock.lock(); let indexing = index?.cpuMeasurementAvailable == true ? index : nil; lock.unlock()
        let cpu = source.percent
        var value: [String: JSONValue] = ["version": .number(1), "cpuPercent": cpu.map(JSONValue.number) ?? .null,
            "cpuStatus": .string(cpu == nil ? "unavailable" : "measured"),
            "sourceCpuPercent": cpu.map(JSONValue.number) ?? .null,
            "indexingCpuPercent": indexing?.attributedCpuPercent.map(JSONValue.number) ?? .null,
            "cpuScopes": .array(cpu == nil ? [] : [.string("source-thread")]),
            "effectiveTransferConcurrency": .number(Double(source.effectiveConcurrency)),
            "effectiveIndexingConcurrency": .number(Double(indexing?.activeWorkerLimit ?? min(ProcessInfo.processInfo.activeProcessorCount, 64, policy.indexingConcurrency ?? 4)))]
        if let indexing { value["cpuPercent"] = .number(min(100, (cpu ?? 0) + (indexing.attributedCpuPercent ?? 0))); value["cpuScopes"] = .array([.string("source-thread"), .string("indexer-process")]) }
        if let v = policy.uploadBytesPerSecond { value["uploadBytesPerSecond"] = .number(v) }
        if let v = policy.downloadBytesPerSecond { value["downloadBytesPerSecond"] = .number(v) }
        if let v = policy.cpuPercent { value["scopeCpuBudgetPercent"] = .number(Double(v) / 3) }
        return .object(value)
    }
}
