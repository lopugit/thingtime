import Foundation

@main struct ProfileTests {
    static func main() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("thingtime-profile-contract-" + UUID().uuidString)
        defer { try? files.removeItem(at: root) }
        let origin = "http://127.0.0.1:29741"
        var protected: Data?
        let store = ThingtimeLocalAccountProfile.Store(read: { protected }, add: { value in
            guard protected == nil else { throw ThingtimeLocalAccountProfile.Failure.unavailable }; protected = value
        })
        let first = try ThingtimeLocalAccountProfile.prepare(root: root, origin: origin, store: store)
        let retained = try ThingtimeLocalAccountProfile.prepare(root: root, origin: origin, store: store)
        precondition(first == retained)
        let value = try JSONDecoder().decode(ThingtimeLocalAccountProfile.Envelope.self, from: first)
        let marker = root.appendingPathComponent("profile.json")
        let metadata = try String(contentsOf: marker, encoding: .utf8)
        precondition(!metadata.contains(value.jwt) && !metadata.contains(value.vault) && !metadata.contains(value.outbox))
        func refuses(_ work: () throws -> Data) { do { _ = try work(); fatalError("Expected profile refusal") } catch {} }
        let missing = ThingtimeLocalAccountProfile.Store(read: { nil }, add: { _ in fatalError("Unexpected key regeneration") })
        let corrupt = ThingtimeLocalAccountProfile.Store(read: { Data("corrupt".utf8) }, add: { _ in fatalError("Unexpected key regeneration") })
        refuses { try ThingtimeLocalAccountProfile.prepare(root: root, origin: origin, store: missing) }
        refuses { try ThingtimeLocalAccountProfile.prepare(root: root, origin: origin, store: corrupt) }
        refuses { try ThingtimeLocalAccountProfile.prepare(root: root, origin: "http://127.0.0.1:29742", store: store) }
        refuses { try ThingtimeLocalAccountProfile.prepare(root: root.appendingPathComponent("foreign"), origin: origin, store: store) }
        try Data("corrupt".utf8).write(to: marker)
        refuses { try ThingtimeLocalAccountProfile.prepare(root: root, origin: origin, store: store) }
        try Data(metadata.utf8).write(to: marker)
        let orphan = root.appendingPathComponent("orphan")
        try files.createDirectory(at: orphan, withIntermediateDirectories: true)
        try Data().write(to: orphan.appendingPathComponent("accounts.sqlite"))
        refuses { try ThingtimeLocalAccountProfile.prepare(root: orphan, origin: origin, store: missing) }
        let link = root.appendingPathComponent("linked")
        try files.createSymbolicLink(at: link, withDestinationURL: orphan)
        refuses { try ThingtimeLocalAccountProfile.prepare(root: link, origin: origin, store: missing) }
        print("Profile contract passed (in-memory key-store adapter; not actual Keychain acceptance)")
    }
}
