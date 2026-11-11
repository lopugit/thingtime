import Foundation

public struct ThingtimeNodeAboutInfo {
    public let version: String
    public let build: String
    public let details: String

    public init(bundleInfo: [String: Any]) {
        version = bundleInfo["CFBundleShortVersionString"] as? String ?? "Unknown"
        build = bundleInfo["CFBundleVersion"] as? String ?? "Unknown"
        let identifier = bundleInfo["CFBundleIdentifier"] as? String ?? "Unknown"
        let commit = bundleInfo["ThingtimeNodeSourceCommit"] as? String ?? "Unknown"
        let managed = bundleInfo["ThingtimeNodeElectronManaged"] as? Bool == true
        #if arch(arm64)
        let architecture = "Apple Silicon (arm64)"
        #else
        let architecture = "Intel (x86_64)"
        #endif
        details = """
        \(managed ? "Managed by Thingtime Desktop" : "Standalone Thingtime Node")
        Bundle: \(identifier)
        Source: \(commit)
        Architecture: \(architecture)
        System: \(ProcessInfo.processInfo.operatingSystemVersionString)
        """
    }
}
