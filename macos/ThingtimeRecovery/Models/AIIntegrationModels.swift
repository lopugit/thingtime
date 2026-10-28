import Foundation

public enum AIIntegrationKind: String, Codable, Hashable, CaseIterable {
    case codex, chatGPT, claudeDesktop, claudeCode, cursor, vscode, windsurf, gemini, openCode, unsupported
}
public enum AIIntegrationStatus: String, Codable, Hashable {
    case available, installed, updateAvailable, conflict, manual, unsupported
}
public struct AIIntegrationTarget: Codable, Hashable, Identifiable {
    public var id: String
    public var title: String
    public var kind: AIIntegrationKind
    public var applicationPaths: [String]
    public var binaryPaths: [String]
    public var configurationPath: String?
    public var skillPath: String?
    public var supportsMCP: Bool
    public var supportsSkills: Bool
    public var manualSetup: String?
    public var status: AIIntegrationStatus
    public var installedVersion: String?
    public var latestVersion: String?
    public var conflictReason: String?
    public var autoUpdate: Bool
    public var pinnedVersion: String?
}
public struct AIIntegrationState: Codable, Hashable {
    public var automaticSetup: Bool
    public var targets: [AIIntegrationTarget]
    public var latestVersion: String?
    public var diagnostics: [String]
}
public struct AIIntegrationResult: Codable, Hashable, Identifiable {
    public var targetID: String
    public var success: Bool
    public var message: String
    public var id: String { targetID }
    public init(targetID: String, success: Bool, message: String) {
        self.targetID = targetID; self.success = success; self.message = message
    }
}
