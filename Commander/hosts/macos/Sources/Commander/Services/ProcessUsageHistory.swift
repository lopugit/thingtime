import Foundation

/// Shared, local-only sampled history. One-minute weighted buckets keep a day of
/// history bounded without retaining every two-second process snapshot.
final class ProcessUsageHistory {
  static let windows: Set<Int> = [0, 300, 600, 1800, 3600, 10800, 21600, 43200, 86400]
  private static let fields = ["cpuPercent", "residentMemoryBytes", "diskReadBytesPerSecond", "diskWriteBytesPerSecond"]
  private struct Bucket {
    var end: Double
    var seconds: Double
    var totals: [Double]
  }
  private final class Series {
    let identity: String
    var buckets: [Bucket] = []
    init(identity: String) { self.identity = identity }
  }
  private var series: [Int: Series] = [:]
  private var lastSample: Double?
  private var lastPruneMinute: Int?

  func record(_ processes: [[String: Any]], at now: Double) {
    let elapsed = lastSample.map { now - $0 } ?? 0
    lastSample = now
    let active = Set(processes.compactMap { $0["pid"] as? Int })
    series = series.filter { active.contains($0.key) }
    let minute = Int(now / 60)
    let prune = lastPruneMinute != minute
    lastPruneMinute = minute
    for process in processes {
      guard let pid = process["pid"] as? Int else { continue }
      let identity = "\(process["startedAtMs"] ?? process["name"] ?? "")"
      let existing = series[pid]
      let item: Series
      if let existing, existing.identity == identity { item = existing }
      else { item = Series(identity: identity); series[pid] = item }
      if prune { item.buckets.removeAll { $0.end <= now - 86400 } }
      // Never treat sleep, a closed view, or a recycled PID as observed history.
      guard existing?.identity == identity, elapsed > 0, elapsed <= 6 else { continue }
      let values = Self.fields.compactMap { (process[$0] as? NSNumber)?.doubleValue }
      guard values.count == Self.fields.count, values.allSatisfy({ $0.isFinite && $0 >= 0 }) else { continue }
      let totals = values.map { $0 * elapsed }
      if let last = item.buckets.last, Int(last.end / 60) == minute {
        let index = item.buckets.count - 1
        item.buckets[index].end = now
        item.buckets[index].seconds += elapsed
        for field in totals.indices { item.buckets[index].totals[field] += totals[field] }
      } else {
        item.buckets.append(Bucket(end: now, seconds: elapsed, totals: totals))
      }
    }
  }

  func average(pid: Int, seconds: Int, at now: Double) -> [String: Any]? {
    guard seconds > 0, Self.windows.contains(seconds), let item = series[pid] else { return nil }
    let cutoff = now - Double(seconds)
    var duration = 0.0
    var totals = [Double](repeating: 0, count: Self.fields.count)
    for bucket in item.buckets where bucket.end > cutoff {
      // Clip the boundary minute; averages are sampled, minute-resolution estimates.
      let fraction = min(1, max(0, (bucket.end - cutoff) / bucket.seconds))
      duration += bucket.seconds * fraction
      for field in totals.indices { totals[field] += bucket.totals[field] * fraction }
    }
    guard duration > 0 else { return nil }
    var result: [String: Any] = ["observedSeconds": duration]
    for field in totals.indices { result[Self.fields[field]] = totals[field] / duration }
    return result
  }
}
