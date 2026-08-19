import CryptoKit
import Foundation

public enum CommandJournalState: String, Codable, Sendable {
    case running
    case runningRetryable
    case retryable
    case succeeded
    case failed
    case uncertain
}

public struct CommandJournalEntry: Codable, Equatable, Sendable {
    public let commandId: String
    public let payloadHash: String
    public var state: CommandJournalState
    public var outcome: JournaledOutcome?
    public let createdAt: Date
    public var updatedAt: Date
}

public enum CommandJournalDisposition: Equatable, Sendable {
    case execute(payloadHash: String)
    case replay(JournaledOutcome)
    case inProgress
    case uncertain
}

private struct CommandJournalSnapshot: Codable {
    let schemaVersion: Int
    var entries: [CommandJournalEntry]
}

public actor CommandJournal {
    public static let defaultMaxEntries = 4_096

    private let fileURL: URL
    private let maxEntries: Int
    private var entries: [String: CommandJournalEntry]

    public init(fileURL: URL, maxEntries: Int = CommandJournal.defaultMaxEntries) throws {
        guard maxEntries > 0 else { throw ThingtimeNodeError.invalidRequest("Command journal capacity must be positive.") }
        self.fileURL = fileURL
        self.maxEntries = maxEntries

        if FileManager.default.fileExists(atPath: fileURL.path) {
            let data = try Data(contentsOf: fileURL)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let snapshot = try decoder.decode(CommandJournalSnapshot.self, from: data)
            guard snapshot.schemaVersion == 1 else {
                throw ThingtimeNodeError.invalidRequest("Unsupported command journal schema.")
            }
            entries = Dictionary(uniqueKeysWithValues: snapshot.entries.map { entry in
                var recovered = entry
                if recovered.state == .running {
                    recovered.state = .uncertain
                    recovered.updatedAt = Date()
                } else if recovered.state == .runningRetryable {
                    recovered.state = .retryable
                    recovered.updatedAt = Date()
                }
                return (recovered.commandId, recovered)
            })
        } else {
            entries = [:]
        }
    }

    public static func defaultFileURL(fileManager: FileManager = .default) -> URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
        return base
            .appendingPathComponent("Thingtime Node", isDirectory: true)
            .appendingPathComponent("command-journal.json", isDirectory: false)
    }

    public func begin(
        commandId: String,
        payload: Data,
        now: Date = Date(),
        retryableOnRecovery: Bool = false
    ) throws -> CommandJournalDisposition {
        let normalizedId = commandId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedId.isEmpty, normalizedId.utf8.count <= 256 else {
            throw ThingtimeNodeError.invalidRequest("commandId must contain 1 to 256 UTF-8 bytes.")
        }
        let hash = Self.hash(payload)

        if let existing = entries[normalizedId] {
            guard existing.payloadHash == hash else { throw ThingtimeNodeError.commandConflict }
            switch existing.state {
            case .succeeded, .failed:
                guard let outcome = existing.outcome else { throw ThingtimeNodeError.commandOutcomeUncertain }
                return .replay(outcome)
            case .running, .runningRetryable:
                return .inProgress
            case .retryable:
                var retry = existing
                retry.state = retryableOnRecovery ? .runningRetryable : .running
                retry.updatedAt = now
                entries[normalizedId] = retry
                try persist()
                return .execute(payloadHash: hash)
            case .uncertain:
                return .uncertain
            }
        }

        try makeCapacityForNewEntry()
        entries[normalizedId] = CommandJournalEntry(
            commandId: normalizedId,
            payloadHash: hash,
            state: retryableOnRecovery ? .runningRetryable : .running,
            outcome: nil,
            createdAt: now,
            updatedAt: now
        )
        try persist()
        return .execute(payloadHash: hash)
    }

    public func finish(
        commandId: String,
        payloadHash: String,
        outcome: JournaledOutcome,
        now: Date = Date()
    ) throws {
        guard var entry = entries[commandId] else {
            throw ThingtimeNodeError.invalidRequest("Cannot finish a command that was not started.")
        }
        guard entry.payloadHash == payloadHash else { throw ThingtimeNodeError.commandConflict }
        guard entry.state == .running || entry.state == .runningRetryable else {
            throw ThingtimeNodeError.commandOutcomeUncertain
        }
        entry.state = outcome.ok ? .succeeded : .failed
        entry.outcome = outcome
        entry.updatedAt = now
        entries[commandId] = entry
        try persist()
    }

    public func markUncertain(
        commandId: String,
        payloadHash: String,
        now: Date = Date()
    ) throws {
        guard var entry = entries[commandId] else {
            throw ThingtimeNodeError.invalidRequest("Cannot mark a command that was not started.")
        }
        guard entry.payloadHash == payloadHash else { throw ThingtimeNodeError.commandConflict }
        guard entry.state == .running else { return }
        entry.state = .uncertain
        entry.outcome = nil
        entry.updatedAt = now
        entries[commandId] = entry
        try persist()
    }

    public func resetRetryable(
        commandId: String,
        payloadHash: String,
        now: Date = Date()
    ) throws {
        guard var entry = entries[commandId] else {
            throw ThingtimeNodeError.invalidRequest("Cannot retry a command that was not started.")
        }
        guard entry.payloadHash == payloadHash else { throw ThingtimeNodeError.commandConflict }
        guard entry.state == .runningRetryable else { throw ThingtimeNodeError.commandOutcomeUncertain }
        entry.state = .retryable
        entry.outcome = nil
        entry.updatedAt = now
        entries[commandId] = entry
        try persist()
    }

    public func entry(commandId: String) -> CommandJournalEntry? {
        entries[commandId]
    }

    public func count() -> Int {
        entries.count
    }

    private func makeCapacityForNewEntry() throws {
        guard entries.count >= maxEntries else { return }
        let evictable = entries.values
            .filter { $0.state == .succeeded || $0.state == .failed }
            .sorted { left, right in
                if left.updatedAt == right.updatedAt { return left.commandId < right.commandId }
                return left.updatedAt < right.updatedAt
            }
        guard let oldest = evictable.first else { throw ThingtimeNodeError.journalCapacityReached }
        entries.removeValue(forKey: oldest.commandId)
    }

    private func persist() throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let snapshot = CommandJournalSnapshot(
            schemaVersion: 1,
            entries: entries.values.sorted { $0.commandId < $1.commandId }
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(snapshot)
        try data.write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    private static func hash(_ payload: Data) -> String {
        SHA256.hash(data: payload).map { String(format: "%02x", $0) }.joined()
    }
}
