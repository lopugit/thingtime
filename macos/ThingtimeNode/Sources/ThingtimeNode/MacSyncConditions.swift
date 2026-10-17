import Foundation
import Network
import IOKit.ps
import ThingtimeNodeCore

/// No SSID, interface identifiers or raw power-source dictionaries cross the bridge.
final class MacSyncConditions: @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let lock = NSLock()
    private var network = "unknown"
    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let value: String
            if path.status != .satisfied { value = "offline" }
            else if path.usesInterfaceType(.cellular) { value = "cellular" }
            else if path.usesInterfaceType(.wifi) { value = "wifi" }
            else if path.usesInterfaceType(.wiredEthernet) { value = "ethernet" }
            else { value = "unknown" }
            lock.lock(); network = value; lock.unlock()
        }
        monitor.start(queue: DispatchQueue(label: "com.thingtime.folder-sync.conditions"))
    }
    deinit { monitor.cancel() }
    func snapshot() -> MacFolderSync.Conditions {
        lock.lock(); let network = network; lock.unlock()
        var connectedToPower: Bool?
        if let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
           let source = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String? {
            if source == kIOPSACPowerValue { connectedToPower = true }
            else if source == kIOPSBatteryPowerValue { connectedToPower = false }
        }
        return .init(network: network, charging: connectedToPower)
    }
}
