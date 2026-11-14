import AppleFileSync
import CryptoKit
import Foundation

/// Durable local-only envelopes bind immutable safe payloads to the expected
/// pairing. A newly paired device never inherits an older device's events.
/// This store is serialized by its caller (the diagnostics coordinator).
struct MobileDeviceDiagnosticOutbox {
    struct Binding: Codable, Equatable, Sendable {
        let scope: FileSyncOwnerScope
        let deviceId: String
        var key: String {
            SHA256.hash(data: Data([scope.origin.absoluteString, scope.ownerId, deviceId].joined(separator: "\n").utf8))
                .map { String(format: "%02x", $0) }.joined()
        }
        func validate() throws {
            guard let checked = try? FileSyncOwnerScope(ownerId: scope.ownerId, url: scope.origin), checked == scope,
                  deviceId.range(of: #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$"#, options: .regularExpression) != nil else {
                throw MobileDeviceDiagnosticEvent.Failure.invalid
            }
        }
    }
    struct Envelope: Codable, Equatable, Sendable {
        let binding: Binding
        let event: MobileDeviceDiagnosticEvent
    }
    enum Failure: Error { case identityConflict, corruptEntry }
    let root: URL
    init(root: URL) { self.root = root }
    private func directory(_ binding: Binding) -> URL { root.appendingPathComponent(binding.key, isDirectory: true) }
    private func file(_ id: String, _ binding: Binding) -> URL {
        directory(binding).appendingPathComponent(id + ".json")
    }
    func append(_ event: MobileDeviceDiagnosticEvent, binding: Binding) throws {
        try binding.validate(); try event.validate()
        let envelope = Envelope(binding: binding, event: event)
        let location = file(event.eventId, binding)
        if FileManager.default.fileExists(atPath: location.path) {
            guard try read(location, binding: binding) == envelope else { throw Failure.identityConflict }
            return
        }
        let directory = directory(binding)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = directory, values = URLResourceValues(); values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(envelope).write(to: location, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    private func read(_ url: URL, binding: Binding) throws -> Envelope {
        let value = try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: url))
        try value.binding.validate(); try value.event.validate()
        guard value.binding == binding, url.lastPathComponent == value.event.eventId + ".json" else { throw Failure.corruptEntry }
        return value
    }
    /// Batch size is a transport work bound, never a retained-event limit.
    /// Enumeration is lazy so an offline history is not loaded into memory.
    func next(binding: Binding, batchSize: Int = 32) throws -> [Envelope] {
        try binding.validate()
        guard batchSize > 0 else { return [] }
        let directory = directory(binding)
        guard FileManager.default.fileExists(atPath: directory.path),
              let entries = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil,
                  options: [.skipsSubdirectoryDescendants, .skipsHiddenFiles]) else { return [] }
        var result: [Envelope] = []
        for case let url as URL in entries where url.pathExtension == "json" {
            guard UUID(uuidString: url.deletingPathExtension().lastPathComponent) != nil else { continue }
            do { result.append(try read(url, binding: binding)) }
            catch {
                guard error is DecodingError || error is Failure || error is MobileDeviceDiagnosticEvent.Failure else { throw error }
                // Keep corrupt evidence locally, outside delivery enumeration.
                // Never serialize unknown disk bytes into a remote error event.
                let quarantine = url.appendingPathExtension("invalid")
                if !FileManager.default.fileExists(atPath: quarantine.path) { try FileManager.default.moveItem(at: url, to: quarantine) }
                else { throw Failure.corruptEntry }
            }
            if result.count == batchSize { break }
        }
        return result
    }
    /// A caller must pass the immutable envelopes actually sent, and only
    /// server-acknowledged IDs from that batch. Unrelated IDs cannot delete data.
    func acknowledge(_ ids: [String], from sent: [Envelope], binding: Binding) throws {
        try binding.validate()
        let unique = Set(ids)
        let sentIds = sent.map(\.event.eventId)
        guard unique.count == ids.count, !ids.isEmpty,
              Set(sentIds).count == sentIds.count, sent.allSatisfy({ $0.binding == binding }),
              unique.isSubset(of: Set(sentIds)) else {
            throw Failure.identityConflict
        }
        let expected = Dictionary(uniqueKeysWithValues: sent.map { ($0.event.eventId, $0) })
        for id in ids {
            let url = file(id, binding)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            guard try read(url, binding: binding) == expected[id] else { throw Failure.identityConflict }
            try FileManager.default.removeItem(at: url)
        }
    }
    func clear(binding: Binding) throws {
        try binding.validate()
        let directory = directory(binding)
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }
    /// Preserve a permanently rejected event locally without blocking later
    /// diagnostics. Never rewrite its immutable identity or safe payload.
    func quarantine(_ envelope: Envelope) throws {
        try envelope.binding.validate(); try envelope.event.validate()
        let url = file(envelope.event.eventId, envelope.binding)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        guard try read(url, binding: envelope.binding) == envelope else { throw Failure.identityConflict }
        try FileManager.default.moveItem(at: url, to: url.appendingPathExtension("rejected"))
    }
}
