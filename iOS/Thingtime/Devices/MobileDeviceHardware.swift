import Foundation
import UIKit
import Darwin

/// Public hardware model identifier (for example iPhone17,1). No device serial,
/// vendor identifier or advertising identifier is read or transmitted.
enum MobileDeviceHardware {
    @MainActor static var descriptorPatch: [String: String]? {
        let model = modelIdentifier
        guard model != "unknown" else { return nil }
        return ["model": model, "osVersion": UIDevice.current.systemVersion,
                "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"]
    }
    static var modelIdentifier: String {
        var count = 0
        guard sysctlbyname("hw.machine", nil, &count, nil, 0) == 0, count > 1 else { return "unknown" }
        var bytes = [CChar](repeating: 0, count: count)
        guard sysctlbyname("hw.machine", &bytes, &count, nil, 0) == 0 else { return "unknown" }
        return String(cString: bytes)
    }
}
