import Darwin
import Foundation
import IOKit
import IOKit.storage
import SystemConfiguration

public struct DeviceResourceTelemetry: Codable, Equatable, Sendable {
    public let cpuPercent: Double?
    public let memoryUsedBytes: UInt64?
    public let memoryTotalBytes: UInt64?
    public let diskUsedBytes: UInt64?
    public let diskTotalBytes: UInt64?
    public let diskReadBytesPerSecond: Double?
    public let diskWriteBytesPerSecond: Double?
    public let networkRxBytesPerSecond: Double?
    public let networkTxBytesPerSecond: Double?
}

struct DeviceResourceSampler {
    struct CPUTicks {
        let user: UInt32
        let system: UInt32
        let idle: UInt32
        let nice: UInt32

        func usage(since earlier: Self) -> Double? {
            let busy = UInt64(user &- earlier.user) + UInt64(system &- earlier.system) + UInt64(nice &- earlier.nice)
            let total = busy + UInt64(idle &- earlier.idle)
            return total > 0 ? 100 * Double(busy) / Double(total) : nil
        }
    }

    struct ByteCounters {
        let input: UInt64
        let output: UInt64

        static func rates<Key: Hashable>(
            previous: [Key: Self]?, current: [Key: Self]?, elapsed: TimeInterval
        ) -> (input: Double, output: Double)? {
            guard elapsed > 0, let previous, let current, !current.isEmpty,
                  previous.keys == current.keys else { return nil }
            var input: Double = 0
            var output: Double = 0
            for (id, counters) in current {
                guard let earlier = previous[id], counters.input >= earlier.input,
                      counters.output >= earlier.output else { return nil }
                input += Double(counters.input - earlier.input)
                output += Double(counters.output - earlier.output)
            }
            return (input / elapsed, output / elapsed)
        }
    }

    private var previous: (uptime: TimeInterval, cpu: CPUTicks?, network: [UInt16: ByteCounters]?, disk: [UInt64: ByteCounters]?)?
    private var latest: DeviceResourceTelemetry?

    mutating func snapshot(uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) -> DeviceResourceTelemetry? {
        // Several consumers can request the same node snapshot. Keep a useful
        // sampling window instead of replacing the baseline on every call.
        if let previous, uptime - previous.uptime < 1 { return latest }

        let host = mach_host_self()
        defer { mach_port_deallocate(mach_task_self_, host) }

        let cpu = Self.cpuTicks(host: host)
        let network = Self.networkCounters()
        let diskCounters = Self.diskCounters()
        let memory = Self.memoryUsage(host: host)
        let disk = Self.startupDiskUsage()
        let cpuPercent = previous?.cpu.flatMap { cpu?.usage(since: $0) }
        let elapsed = previous.map { uptime - $0.uptime } ?? 0
        let networkRates = ByteCounters.rates(previous: previous?.network, current: network, elapsed: elapsed)
        let diskRates = ByteCounters.rates(previous: previous?.disk, current: diskCounters, elapsed: elapsed)
        previous = (uptime, cpu, network, diskCounters)
        let memoryTotal = ProcessInfo.processInfo.physicalMemory
        guard cpuPercent != nil || memoryTotal > 0 || disk != nil || diskRates != nil || networkRates != nil else {
            latest = nil
            return nil
        }
        latest = DeviceResourceTelemetry(
            cpuPercent: cpuPercent,
            memoryUsedBytes: memory.flatMap { $0 <= memoryTotal ? $0 : nil },
            memoryTotalBytes: memoryTotal > 0 ? memoryTotal : nil,
            diskUsedBytes: disk?.used,
            diskTotalBytes: disk?.total,
            diskReadBytesPerSecond: diskRates?.input,
            diskWriteBytesPerSecond: diskRates?.output,
            networkRxBytesPerSecond: networkRates?.input,
            networkTxBytesPerSecond: networkRates?.output
        )
        return latest
    }

    private static func cpuTicks(host: host_t) -> CPUTicks? {
        var stats = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &stats) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics(host, HOST_CPU_LOAD_INFO, $0, &count)
            }
        }
        guard status == KERN_SUCCESS else { return nil }
        return CPUTicks(user: stats.cpu_ticks.0, system: stats.cpu_ticks.1, idle: stats.cpu_ticks.2, nice: stats.cpu_ticks.3)
    }

    private static func memoryUsage(host: host_t) -> UInt64? {
        var stats = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &stats) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics64(host, HOST_VM_INFO64, $0, &count)
            }
        }
        let pageSize = getpagesize()
        guard status == KERN_SUCCESS, pageSize > 0 else { return nil }
        // Count anonymous, wired, and compressed physical pages. File cache
        // and purgeable pages can be reclaimed and swap is outside physical RAM.
        let resident = UInt64(stats.internal_page_count) + UInt64(stats.wire_count) + UInt64(stats.compressor_page_count)
        let purgeable = UInt64(stats.purgeable_count)
        guard resident >= purgeable else { return nil }
        return (resident - purgeable) * UInt64(pageSize)
    }

    private static func startupDiskUsage() -> (used: UInt64, total: UInt64)? {
        let fileManager = FileManager.default
        let dataVolume = "/System/Volumes/Data"
        let path = fileManager.fileExists(atPath: dataVolume) ? dataVolume : "/"
        guard let attributes = try? fileManager.attributesOfFileSystem(forPath: path),
              let total = (attributes[.systemSize] as? NSNumber)?.uint64Value,
              let free = (attributes[.systemFreeSize] as? NSNumber)?.uint64Value,
              total > 0, free <= total else { return nil }
        return (total - free, total)
    }

    private static func diskCounters() -> [UInt64: ByteCounters]? {
        // Select block drivers with a known physical interconnect. Disk
        // images would count the same I/O again through their backing disk.
        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching(kIOBlockStorageDriverClass), &iterator) == KERN_SUCCESS else { return nil }
        defer { IOObjectRelease(iterator) }

        var counters: [UInt64: ByteCounters] = [:]
        while case let driver = IOIteratorNext(iterator), driver != 0 {
            defer { IOObjectRelease(driver) }
            var provider: io_registry_entry_t = 0
            guard IORegistryEntryGetParentEntry(driver, kIOServicePlane, &provider) == KERN_SUCCESS else { continue }
            defer { IOObjectRelease(provider) }
            let protocolInfo = IORegistryEntryCreateCFProperty(provider, kIOPropertyProtocolCharacteristicsKey as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
            guard let connection = (protocolInfo as? [String: Any])?[kIOPropertyPhysicalInterconnectTypeKey] as? String,
                  !connection.isEmpty, connection != kIOPropertyPhysicalInterconnectTypeVirtual else { continue }

            var id: UInt64 = 0
            guard IORegistryEntryGetRegistryEntryID(driver, &id) == KERN_SUCCESS,
                  let stats = IORegistryEntryCreateCFProperty(driver, kIOBlockStorageDriverStatisticsKey as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? [String: NSNumber],
                  let read = stats[kIOBlockStorageDriverStatisticsBytesReadKey]?.uint64Value,
                  let written = stats[kIOBlockStorageDriverStatisticsBytesWrittenKey]?.uint64Value else { return nil }
            counters[id] = ByteCounters(input: read, output: written)
        }
        return counters
    }

    private static func networkCounters() -> [UInt16: ByteCounters]? {
        // Use 64-bit routing counters and only physical Ethernet/Wi-Fi
        // interfaces. Loopback, VPN tunnels, and virtual bridges can duplicate
        // the same traffic at a different layer.
        guard let interfaces = SCNetworkInterfaceCopyAll() as? [SCNetworkInterface] else { return nil }
        let indices = Set(interfaces.compactMap { interface -> UInt32? in
            let type = SCNetworkInterfaceGetInterfaceType(interface)
            guard type == kSCNetworkInterfaceTypeEthernet || type == kSCNetworkInterfaceTypeIEEE80211,
                  let name = SCNetworkInterfaceGetBSDName(interface) as String? else { return nil }
            let index = if_nametoindex(name)
            return index > 0 ? index : nil
        })
        guard !indices.isEmpty else { return nil }

        var mib: [Int32] = [CTL_NET, PF_ROUTE, 0, 0, NET_RT_IFLIST2, 0]
        var byteCount = 0
        guard sysctl(&mib, u_int(mib.count), nil, &byteCount, nil, 0) == 0, byteCount > 0 else { return nil }
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = bytes.withUnsafeMutableBytes { sysctl(&mib, u_int(mib.count), $0.baseAddress, &byteCount, nil, 0) }
        guard status == 0, byteCount <= bytes.count else { return nil }

        return bytes.withUnsafeBytes { buffer in
            var counters: [UInt16: ByteCounters] = [:]
            var offset = 0
            while byteCount - offset >= 4 {
                let length = Int(buffer.loadUnaligned(fromByteOffset: offset, as: UInt16.self))
                guard length >= 4, length <= byteCount - offset else { return nil }
                if buffer[offset + 2] == UInt8(RTM_VERSION), buffer[offset + 3] == UInt8(RTM_IFINFO2),
                   length >= MemoryLayout<if_msghdr2>.size {
                    let message = buffer.loadUnaligned(fromByteOffset: offset, as: if_msghdr2.self)
                    let active = IFF_UP | IFF_RUNNING
                    if indices.contains(UInt32(message.ifm_index)), message.ifm_flags & active == active {
                        counters[message.ifm_index] = ByteCounters(input: message.ifm_data.ifi_ibytes, output: message.ifm_data.ifi_obytes)
                    }
                }
                offset += length
            }
            return offset == byteCount ? counters : nil
        }
    }
}
