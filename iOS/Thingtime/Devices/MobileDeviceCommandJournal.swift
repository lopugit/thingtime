import CryptoKit
import Foundation

/// Durable at-most-once fence for audible side effects. A crash after `started`
/// is uncertain, not permission to replay. Lease credentials are never stored.
struct MobileDeviceCommandJournal {
    struct Receipt: Codable {
        let commandId: String
        let kind: String
        let eventId: String
        let outcome: String
    }
    let root: URL
    private func file(scope: MobileDevicePairing.Scope, commandId: String) -> URL {
        let digest = SHA256.hash(data: Data(commandId.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(scope.key, isDirectory: true).appendingPathComponent(digest + ".json")
    }
    func read(scope: MobileDevicePairing.Scope, commandId: String) throws -> Receipt? {
        let file = file(scope: scope, commandId: commandId)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let receipt = try JSONDecoder().decode(Receipt.self, from: Data(contentsOf: file))
        guard receipt.commandId == commandId else { throw MobileDevicePairing.Failure.invalid }
        return receipt
    }
    func write(_ receipt: Receipt, scope: MobileDevicePairing.Scope) throws {
        let file = file(scope: scope, commandId: receipt.commandId)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try JSONEncoder().encode(receipt).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

@MainActor
final class MobileDeviceCommandWorker {
    struct Command {
        let id: String
        let kind: String
        let input: [String: Any]
        let leaseId: String
        let leaseExpiresAt: Date
        let approved: Bool
    }
    typealias Report = (Command, String, String) async throws -> Void
    private let journal: MobileDeviceCommandJournal
    private let report: Report
    private let execute: (Command, @escaping () throws -> Void) async throws -> Void
    init(journal: MobileDeviceCommandJournal, report: @escaping Report,
         execute: @escaping (Command, @escaping () throws -> Void) async throws -> Void) {
        self.journal = journal; self.report = report; self.execute = execute
    }
    func perform(_ command: Command, scope: MobileDevicePairing.Scope, check: @escaping () throws -> Void) async throws {
        try check(); try Task.checkCancellation()
        guard command.approved, command.leaseExpiresAt > Date(),
              ["notification.show", "media.play", "media.prepare"].contains(command.kind) else {
            try await report(command, UUID().uuidString, "failed"); return
        }
        if let receipt = try journal.read(scope: scope, commandId: command.id) {
            let outcome = receipt.outcome == "started" || receipt.kind != command.kind ? "needs-review" : receipt.outcome
            try await report(command, receipt.eventId, outcome)
            return
        }
        try await report(command, UUID().uuidString, "running")
        try check(); try Task.checkCancellation()
        let eventId = UUID().uuidString
        try journal.write(.init(commandId: command.id, kind: command.kind, eventId: eventId, outcome: "started"), scope: scope)
        // Once started is durable, cancellation/crash remains uncertain and can
        // never cause an automatic second audible action.
        do {
            try check(); try Task.checkCancellation()
            guard command.leaseExpiresAt > Date() else { throw CancellationError() }
            try await execute(command, check)
            try journal.write(.init(commandId: command.id, kind: command.kind, eventId: eventId, outcome: "succeeded"), scope: scope)
        } catch {
            try? journal.write(.init(commandId: command.id, kind: command.kind, eventId: eventId, outcome: "needs-review"), scope: scope)
            throw error
        }
        try check(); try Task.checkCancellation()
        try await report(command, eventId, "succeeded")
    }
}
