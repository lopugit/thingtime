import Foundation
import Darwin

/// Native v1 resource policy. User ceilings are retained exactly; effective
/// hardware/safety ceilings are reported separately by the executing adapter.
public struct SyncResourceLimits: Codable, Equatable, Sendable {
    public var uploadBytesPerSecond: Double?
    public var downloadBytesPerSecond: Double?
    public var transferConcurrency: Int?
    public var indexingConcurrency: Int?
    public var cpuPercent: Int?
    public init(uploadBytesPerSecond: Double? = nil, downloadBytesPerSecond: Double? = nil,
                transferConcurrency: Int? = nil, indexingConcurrency: Int? = nil, cpuPercent: Int? = nil) throws {
        self.uploadBytesPerSecond = uploadBytesPerSecond; self.downloadBytesPerSecond = downloadBytesPerSecond
        self.transferConcurrency = transferConcurrency; self.indexingConcurrency = indexingConcurrency; self.cpuPercent = cpuPercent
        try validate()
    }
    public var isEmpty: Bool { uploadBytesPerSecond == nil && downloadBytesPerSecond == nil && transferConcurrency == nil && indexingConcurrency == nil && cpuPercent == nil }
    public func validate() throws {
        for value in [uploadBytesPerSecond, downloadBytesPerSecond].compactMap({ $0 }) {
            guard value.isFinite, value > 0 else { throw MobileFolderStore.Failure.invalid }
        }
        for value in [transferConcurrency, indexingConcurrency].compactMap({ $0 }) {
            guard value > 0, value <= 9_007_199_254_740_991 else { throw MobileFolderStore.Failure.invalid }
        }
        if let cpuPercent { guard (1...100).contains(cpuPercent) else { throw MobileFolderStore.Failure.invalid } }
    }
    private struct Key: CodingKey { var stringValue: String; var intValue: Int? { nil }; init?(stringValue: String) { self.stringValue = stringValue }; init?(intValue: Int) { return nil } }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        let allowed: Set<String> = ["uploadBytesPerSecond", "downloadBytesPerSecond", "transferConcurrency", "indexingConcurrency", "cpuPercent"]
        guard Set(c.allKeys.map(\.stringValue)).isSubset(of: allowed) else { throw MobileFolderStore.Failure.invalid }
        func key(_ value: String) -> Key { Key(stringValue: value)! }
        // Explicit nulls are invalid: an absent optional means unlimited.
        for k in c.allKeys { guard try !c.decodeNil(forKey: k) else { throw MobileFolderStore.Failure.invalid } }
        uploadBytesPerSecond = try c.decodeIfPresent(Double.self, forKey: key("uploadBytesPerSecond"))
        downloadBytesPerSecond = try c.decodeIfPresent(Double.self, forKey: key("downloadBytesPerSecond"))
        transferConcurrency = try c.decodeIfPresent(Int.self, forKey: key("transferConcurrency"))
        indexingConcurrency = try c.decodeIfPresent(Int.self, forKey: key("indexingConcurrency"))
        cpuPercent = try c.decodeIfPresent(Int.self, forKey: key("cpuPercent")); try validate()
    }
    /// v2 immutable descriptor fields use IEEE754 big-endian hex, independent
    /// of each language's decimal exponent spelling.
    public var canonicalFields: [String] {
        [uploadBytesPerSecond, downloadBytesPerSecond, transferConcurrency.map(Double.init), indexingConcurrency.map(Double.init), cpuPercent.map(Double.init)].map { value in
            guard let value else { return "" }; let hex = String(value.bitPattern, radix: 16); return String(repeating: "0", count: 16 - hex.count) + hex
        }
    }
}

public struct CommanderResourceUsage: Decodable, Sendable {
    public struct Effective: Decodable, Sendable { public let logicalCpuCount: Int; public let workerThreads: Int; public let maxCpuPercent: Int }
    public let effective: Effective
    public let averageCpuPercent: Int
    public let activeWorkerLimit: Int
    public let cpuMeasurementAvailable: Bool
    public let cpuTimeNanoseconds: UInt64
    public let wallTimeNanoseconds: UInt64
    public var attributedCpuPercent: Double? {
        guard cpuMeasurementAvailable, wallTimeNanoseconds > 0, effective.logicalCpuCount > 0 else { return nil }
        return min(100, Double(cpuTimeNanoseconds) / Double(wallTimeNanoseconds) / Double(effective.logicalCpuCount) * 100)
    }
}


/// CPU is measured only around synchronous work performed by this sync on the
/// calling thread. No host-wide or device-wide load participates.
public final class SyncSourceCpuMeter: @unchecked Sendable {
    private let lock = NSLock()
    private let started = ProcessInfo.processInfo.systemUptime
    private var cpuSeconds = 0.0
    private var threadScopes: [UInt32: (depth: Int, recorded: Double)] = [:]
    private var feedbackAt = 0.0
    private let target: Double?
    private let ceiling: Int
    private var active = 0, effective = 1
    public init(cpuPercent: Int?, concurrency: Int = 16) { target = cpuPercent.map { Double($0) / 3 }; ceiling = max(1, min(16, concurrency)); effective = ceiling }
    public var effectiveConcurrency: Int { lock.lock(); defer { lock.unlock() }; return effective }
    private func threadTime() -> Double? {
        var time = timespec()
        guard clock_gettime(CLOCK_THREAD_CPUTIME_ID, &time) == 0 else { return nil }
        return Double(time.tv_sec) + Double(time.tv_nsec) / 1_000_000_000
    }
    public func measure<T>(_ work: () throws -> T, admit: Bool = true) throws -> T {
        let before = threadTime()
        if target != nil && before == nil { throw MobileFolderStore.Failure.unavailable }
        let thread = pthread_mach_thread_np(pthread_self())
        lock.lock(); var scope = threadScopes[thread] ?? (depth: 0, recorded: 0)
        let recordedBefore = scope.recorded; scope.depth += 1; threadScopes[thread] = scope; lock.unlock()
        var admitted = false
        defer {
            let after = threadTime()
            lock.lock()
            if admitted { active -= 1 }
            var scope = threadScopes[thread] ?? (depth: 1, recorded: recordedBefore)
            if let before, let after {
                // Nested chunk samples are already included; subtract them from
                // their enclosing operation so no thread CPU is counted twice.
                let delta = max(0, after - before - (scope.recorded - recordedBefore))
                cpuSeconds += delta; scope.recorded += delta
            }
            scope.depth -= 1
            if scope.depth == 0 { threadScopes.removeValue(forKey: thread) } else { threadScopes[thread] = scope }
            if let target, ProcessInfo.processInfo.systemUptime - feedbackAt >= 0.25 {
                feedbackAt = ProcessInfo.processInfo.systemUptime
                let percent = cpuSeconds / max(0.001, ProcessInfo.processInfo.systemUptime - started) / Double(ProcessInfo.processInfo.activeProcessorCount) * 100
                if percent > target { effective = max(1, effective - 1) }
                else if percent < target * 0.8 { effective = min(ceiling, effective + 1) }
            }
            lock.unlock()
        }
        while admit {
            try Task.checkCancellation()
            lock.lock()
            if active < effective { active += 1; admitted = true; lock.unlock(); break }
            lock.unlock(); Thread.sleep(forTimeInterval: 0.025)
        }
        return try work()
    }
    public var measuredCpuSeconds: Double { lock.lock(); defer { lock.unlock() }; return cpuSeconds }
    public var percent: Double? {
        guard threadTime() != nil else { return nil }
        lock.lock(); defer { lock.unlock() }
        return min(100, cpuSeconds / max(0.001, ProcessInfo.processInfo.systemUptime - started) / Double(ProcessInfo.processInfo.activeProcessorCount) * 100)
    }
    public func checkpoint() throws {
        guard let target else { return }
        while true {
            try Task.checkCancellation()
            lock.lock(); let cpu = cpuSeconds; lock.unlock()
            let debt = cpu / (Double(ProcessInfo.processInfo.activeProcessorCount) * target / 100) - (ProcessInfo.processInfo.systemUptime - started)
            if debt <= 0 { return }
            Thread.sleep(forTimeInterval: min(0.025, debt))
        }
    }
}

/// Task-local access is installed only around this sync's native workers.
public enum SyncResourceCpuContext {
    @TaskLocal public static var current: SyncSourceCpuMeter?
    static func chunk<T>(_ work: () throws -> T) throws -> T {
        guard let meter = current else { return try work() }
        try meter.checkpoint(); let value = try meter.measure(work, admit: false); try meter.checkpoint(); return value
    }
}
