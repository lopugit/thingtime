import Foundation

public struct ThingtimeNodeBridgeCodeIdentity: Equatable, Sendable {
    public let identifier: String?
    public let teamIdentifier: String?
    public let hasAppleGenericAnchor: Bool

    public init(identifier: String?, teamIdentifier: String?, hasAppleGenericAnchor: Bool) {
        self.identifier = identifier
        self.teamIdentifier = teamIdentifier
        self.hasAppleGenericAnchor = hasAppleGenericAnchor
    }
}

public struct ThingtimeNodeBridgeParentEvidence: Equatable, Sendable {
    public let initialParentProcessIdentifier: Int32
    public let finalParentProcessIdentifier: Int32
    public let bridgeIdentity: ThingtimeNodeBridgeCodeIdentity?
    public let parentIdentity: ThingtimeNodeBridgeCodeIdentity?

    public init(
        initialParentProcessIdentifier: Int32,
        finalParentProcessIdentifier: Int32,
        bridgeIdentity: ThingtimeNodeBridgeCodeIdentity?,
        parentIdentity: ThingtimeNodeBridgeCodeIdentity?
    ) {
        self.initialParentProcessIdentifier = initialParentProcessIdentifier
        self.finalParentProcessIdentifier = finalParentProcessIdentifier
        self.bridgeIdentity = bridgeIdentity
        self.parentIdentity = parentIdentity
    }
}

public enum ThingtimeNodeBridgeParentPolicy {
    public static let bridgeIdentifier = "com.thingtime.desktop.node.bridge"
    public static let parentIdentifier = "com.thingtime.desktop"

    public static func accepts(_ evidence: ThingtimeNodeBridgeParentEvidence) -> Bool {
        guard evidence.initialParentProcessIdentifier > 1,
              evidence.initialParentProcessIdentifier == evidence.finalParentProcessIdentifier,
              let bridgeIdentity = evidence.bridgeIdentity,
              let parentIdentity = evidence.parentIdentity,
              bridgeIdentity.identifier == bridgeIdentifier,
              parentIdentity.identifier == parentIdentifier,
              validTeamIdentifier(bridgeIdentity.teamIdentifier),
              parentIdentity.teamIdentifier == bridgeIdentity.teamIdentifier,
              bridgeIdentity.hasAppleGenericAnchor,
              parentIdentity.hasAppleGenericAnchor else {
            return false
        }
        return true
    }

    private static func validTeamIdentifier(_ value: String?) -> Bool {
        guard let value, value.utf8.count == 10 else { return false }
        return value.unicodeScalars.allSatisfy {
            (UnicodeScalar("A").value ... UnicodeScalar("Z").value).contains($0.value)
                || (UnicodeScalar("0").value ... UnicodeScalar("9").value).contains($0.value)
        }
    }
}
