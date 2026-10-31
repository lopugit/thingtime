import Foundation

public struct SigningContext: Hashable {
    public let teamIdentifier: String
    public let isProduction: Bool

    public init(teamIdentifier: String, isProduction: Bool) {
        self.teamIdentifier = teamIdentifier
        self.isProduction = isProduction
    }
}

public enum BundleVerifier {
    public static func signingContext(for appURL: URL) throws -> SigningContext {
        let details = try ProcessExecution.run("/usr/bin/codesign", arguments: ["--display", "--verbose=4", appURL.path], label: "Thingtime Recovery signing inspection")
        guard let teamIdentifier = value(named: "TeamIdentifier", in: details), teamIdentifier != "not set" else {
            throw RecoveryError.operationFailed("Thingtime Recovery must be signed with a stable Apple team identity.")
        }
        return SigningContext(teamIdentifier: teamIdentifier, isProduction: details.contains("Authority=Developer ID Application:"))
    }

    public static func verify(_ appURL: URL, component: RecoveryComponent, signingContext: SigningContext) throws {
        try ProcessExecution.run("/usr/bin/codesign", arguments: ["--verify", "--deep", "--strict", "--verbose=2", appURL.path], label: "Signed \(component.title) verification")
        let details = try ProcessExecution.run("/usr/bin/codesign", arguments: ["--display", "--verbose=4", appURL.path], label: "\(component.title) signing inspection")
        guard value(named: "Identifier", in: details) == component.bundleIdentifier else {
            throw RecoveryError.operationFailed("The selected bundle does not have the expected \(component.bundleIdentifier) identifier.")
        }
        guard value(named: "TeamIdentifier", in: details) == signingContext.teamIdentifier else {
            throw RecoveryError.operationFailed("The selected bundle is not signed by this Thingtime team's identity.")
        }
        if signingContext.isProduction {
            guard details.contains("Authority=Developer ID Application:") else {
                throw RecoveryError.operationFailed("Production recovery accepts only Developer ID-signed bundles.")
            }
            try ProcessExecution.run("/usr/sbin/spctl", arguments: ["--assess", "--type", "execute", "--verbose=2", appURL.path], label: "\(component.title) Gatekeeper assessment")
            try ProcessExecution.run("/usr/bin/xcrun", arguments: ["stapler", "validate", appURL.path], label: "\(component.title) notarization validation")
        }
    }

    /// Temporary distribution releases have no Apple team certificate or
    /// notarization. They are ad-hoc signed only so macOS can execute their
    /// nested code. Recovery keeps them in a visibly unsigned cache path and
    /// never treats this structural check as trusted provenance.
    public static func verifyUnsigned(_ appURL: URL, component: RecoveryComponent) throws {
        try ProcessExecution.run("/usr/bin/codesign", arguments: ["--verify", "--deep", "--strict", "--verbose=2", appURL.path], label: "Unsigned \(component.title) integrity verification")
        let details = try ProcessExecution.run("/usr/bin/codesign", arguments: ["--display", "--verbose=4", appURL.path], label: "Unsigned \(component.title) signing inspection")
        guard value(named: "Identifier", in: details) == component.bundleIdentifier else {
            throw RecoveryError.operationFailed("The selected bundle does not have the expected \(component.bundleIdentifier) identifier.")
        }
        guard value(named: "TeamIdentifier", in: details) == "not set" else {
            throw RecoveryError.operationFailed("A signed bundle was incorrectly published as unsigned.")
        }
        guard !details.contains("Authority=Apple Development:"), !details.contains("Authority=Developer ID Application:") else {
            throw RecoveryError.operationFailed("A trusted Apple-signed bundle was incorrectly published as unsigned.")
        }
    }

    /// Identifies the distribution lane without using it as verification. The
    /// caller must always follow this with `verify` or `verifyUnsigned`.
    public static func distribution(for appURL: URL, component: RecoveryComponent) throws -> RecoveryBundleTrust {
        let details = try ProcessExecution.run("/usr/bin/codesign", arguments: ["--display", "--verbose=4", appURL.path], label: "\(component.title) signing inspection")
        guard value(named: "Identifier", in: details) == component.bundleIdentifier else {
            throw RecoveryError.operationFailed("The selected bundle does not have the expected \(component.bundleIdentifier) identifier.")
        }
        if value(named: "TeamIdentifier", in: details) == "not set",
           !details.contains("Authority=Apple Development:"),
           !details.contains("Authority=Developer ID Application:") {
            return .unsigned
        }
        guard let detectedTeamIdentifier = value(named: "TeamIdentifier", in: details), !detectedTeamIdentifier.isEmpty, detectedTeamIdentifier != "not set" else {
            throw RecoveryError.operationFailed("The selected bundle has no usable signing identity.")
        }
        return .signed
    }

    private static func value(named name: String, in details: String) -> String? {
        details
            .split(whereSeparator: \.isNewline)
            .first(where: { $0.hasPrefix("\(name)=") })
            .map { String($0.dropFirst(name.count + 1)) }
    }
}
