import CryptoKit
import Foundation

public struct ThingtimeNodeEndpointScope: Equatable, Sendable {
    public let identifier: String
    public let canonicalBaseURL: URL

    public init(baseURL: URL) throws {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/",
              components.host != nil else {
            throw ThingtimeAPIClientError.invalidBaseURL
        }
        components.scheme = scheme
        components.host = components.host?.lowercased()
        if (scheme == "https" && components.port == 443)
            || (scheme == "http" && components.port == 80) {
            components.port = nil
        }
        components.path = "/"
        guard let canonicalBaseURL = components.url else {
            throw ThingtimeAPIClientError.invalidBaseURL
        }
        self.canonicalBaseURL = canonicalBaseURL
        identifier = SHA256.hash(data: Data(canonicalBaseURL.absoluteString.utf8))
            .prefix(16)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    public var credentialAccount: String {
        "device-credential-v2.\(identifier)"
    }

    public var legacyCredentialAccount: String? {
        isProduction ? "device-credential-v1" : nil
    }

    public func commandJournalFileURL(fileManager: FileManager = .default) -> URL {
        if isProduction { return CommandJournal.defaultFileURL(fileManager: fileManager) }
        return journalDirectory(fileManager: fileManager)
            .appendingPathComponent("command-journal-\(identifier).json", isDirectory: false)
    }

    public func liveAIJournalFileURL(fileManager: FileManager = .default) -> URL {
        if isProduction { return LiveAISyncCoordinator.defaultFileURL(fileManager: fileManager) }
        return journalDirectory(fileManager: fileManager)
            .appendingPathComponent("live-ai-sync-journal-\(identifier).json", isDirectory: false)
    }

    public func liveAIJournalFileURL(deviceID: String, fileManager: FileManager = .default) throws -> URL {
        guard !deviceID.isEmpty, deviceID.utf8.count <= 512 else {
            throw ThingtimeNodeError.invalidRequest("The paired device identifier is invalid.")
        }
        let deviceHash = SHA256.hash(data: Data(deviceID.utf8))
            .prefix(16)
            .map { String(format: "%02x", $0) }
            .joined()
        return journalDirectory(fileManager: fileManager)
            .appendingPathComponent("live-ai-sync-journal-\(identifier)-\(deviceHash).json", isDirectory: false)
    }

    private var isProduction: Bool {
        canonicalBaseURL.absoluteString == "https://thingtime.com/"
    }

    private func journalDirectory(fileManager: FileManager) -> URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support", isDirectory: true)
        return base.appendingPathComponent("Thingtime Node", isDirectory: true)
    }
}
