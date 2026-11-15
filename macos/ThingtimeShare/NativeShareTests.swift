import Foundation
import AppKit
import UniformTypeIdentifiers

@main struct NativeShareTests {
    static func require(_ value: @autoclosure () throws -> Bool, _ label: String) throws {
        if try !value() { throw NSError(domain: "NativeShareTests", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
    }
    static func rejects(_ label: String, _ body: () throws -> Void) throws {
        do { try body() } catch { return }
        throw NSError(domain: "NativeShareTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "Expected refusal: " + label])
    }
    static func fixture(inbox: ShareInbox) throws -> UUID {
        let batch = try inbox.begin()
        let directory = batch.payload.appendingPathComponent("Documents", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        try Data("Hello from macOS sharing".utf8).write(to: batch.payload.appendingPathComponent("Shared text.txt"))
        try Data([0, 1, 2, 3, 255]).write(to: directory.appendingPathComponent("sample.bin"))
        try ShareComposerMetadata(origin: "", textPaths: ["Shared text.txt"]).write(to: batch.directory)
        try inbox.commit(batch)
        return batch.id
    }
    static func main() async throws {
        if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--fixture-root" {
            let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
            print(try fixture(inbox: ShareInbox(root: root)).uuidString)
            return
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ThingtimeShareTests-" + UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let inbox = ShareInbox(root: root)
        let id = try fixture(inbox: inbox)
        let renderer = URL(string: "https://renderer.example")!, endpoint = URL(string: "https://api.example")!
        try rejects("ordinary iOS flow must not bind an originless draft") { _ = try ShareComposerSession(inbox: inbox, id: id, origin: renderer) }
        var session: ShareComposerSession? = try ShareComposerSession(inbox: inbox, id: id, origin: renderer, endpoint: endpoint, bindUnboundOrigin: true)
        try rejects("lease contention") { _ = try ShareComposerSession(inbox: inbox, id: id, origin: renderer, endpoint: endpoint, bindUnboundOrigin: true) }
        let incoming = try session!.incoming(accountId: "test-owner")
        try require(incoming["text"] as? String == "Hello from macOS sharing", "inline text")
        try require(incoming["apiOrigin"] as? String == "https://renderer.example", "renderer origin wire compatibility")
        let attachments = incoming["attachments"] as! [[String: Any]]
        try require(attachments.count == 1, "binary remains attachment")
        let file = attachments[0]["id"] as! String
        let chunk = try session!.read(accountId: "test-owner", fileId: file, offset: 1, length: 3)
        try require(Data(base64Encoded: chunk["base64"] as! String) == Data([1, 2, 3]), "bounded exact bytes")
        try rejects("wrong account") { _ = try session!.incoming(accountId: "another-owner") }
        try rejects("oversize read") { _ = try session!.read(accountId: "test-owner", fileId: file, offset: 0, length: ShareComposerSession.maxChunkBytes + 1) }
        try rejects("complete needs durable outcome") { try session!.complete(accountId: "test-owner") }
        session = nil
        try rejects("renderer rebinding") { _ = try ShareComposerSession(inbox: inbox, id: id, origin: URL(string: "https://other.example")!, endpoint: endpoint, bindUnboundOrigin: true) }
        try rejects("API endpoint rebinding") { _ = try ShareComposerSession(inbox: inbox, id: id, origin: renderer, endpoint: renderer, bindUnboundOrigin: true) }
        session = try ShareComposerSession(inbox: inbox, id: id, origin: renderer, endpoint: endpoint, bindUnboundOrigin: true)
        _ = try session!.incoming(accountId: "test-owner")
        let submission = ShareComposerSubmission(destination: "post", operationId: UUID().uuidString, targetId: nil, recoveryPayload: "synthetic")
        _ = try session!.beginSubmission(accountId: "test-owner", submission: submission)
        _ = try session!.beginSubmission(accountId: "test-owner", submission: submission)
        _ = try session!.recordOutcome(accountId: "test-owner", submission: submission, outcomeIds: ["saved-outcome"])
        try session!.complete(accountId: "test-owner")
        session = nil
        try rejects("completed shares cannot reopen") { _ = try ShareComposerSession(inbox: inbox, id: id, origin: renderer, endpoint: endpoint, bindUnboundOrigin: true) }
        // Legacy iOS metadata decodes without endpoint and retains existing origin.
        let legacy = try inbox.begin()
        try Data("legacy".utf8).write(to: legacy.payload.appendingPathComponent("text.txt"))
        try Data(#"{"origin":"https://renderer.example","textPaths":["text.txt"],"completed":false}"#.utf8).write(to: legacy.directory.appendingPathComponent("composer.json"))
        try inbox.commit(legacy)
        let legacySession = try ShareComposerSession(inbox: inbox, id: legacy.id, origin: renderer)
        try require(try legacySession.incoming(accountId: "test-owner")["text"] as? String == "legacy", "legacy iOS compatibility")
        // Symbolic links cannot disclose source bytes through shared safe copy.
        let unsafe = root.appendingPathComponent("unsafe-link")
        try FileManager.default.createSymbolicLink(at: unsafe, withDestinationURL: root.appendingPathComponent("ready/" + id.uuidString + "/payload/Documents/sample.bin"))
        let scratch = try inbox.begin(); defer { inbox.rollback(scratch) }
        try rejects("symbolic link") { _ = try inbox.copy(unsafe, into: scratch.payload) }
        let source = root.appendingPathComponent("Original Folder", isDirectory: true)
        try FileManager.default.createDirectory(at: source.appendingPathComponent("Nested Empty"), withIntermediateDirectories: true)
        try Data([8, 7, 6]).write(to: source.appendingPathComponent("original.bin"))
        let fileProvider = NSItemProvider(object: source as NSURL)
        let textProvider = NSItemProvider(object: "Provider text" as NSString)
        let linkProvider = NSItemProvider(object: URL(string: "https://example.test/shared")! as NSURL)
        let photo = root.appendingPathComponent("Original photo.jpg")
        let originalPhotoBytes = Data([0xff, 0xd8, 0xff, 0xe1, 42, 0, 0xff, 0xd9])
        try originalPhotoBytes.write(to: photo)
        let imageProvider = NSItemProvider()
        imageProvider.suggestedName = "Original photo.jpg"
        imageProvider.registerFileRepresentation(forTypeIdentifier: UTType.jpeg.identifier, fileOptions: [], visibility: .all) { completion in
            completion(photo, false, nil)
            return nil
        }
        let item = NSExtensionItem()
        item.attachments = [fileProvider, textProvider, linkProvider, imageProvider]
        item.attributedContentText = NSAttributedString(string: "Provider text")
        let adapter = MacShareItemImporter(inbox: inbox)
        let providerId = try await adapter.save([item])
        let providerSession = try ShareComposerSession(inbox: inbox, id: providerId, origin: renderer, bindUnboundOrigin: true)
        let providerPayload = try providerSession.incoming(accountId: "provider-owner")
        try require(providerPayload["text"] as? String == "Provider text\n\nhttps://example.test/shared", "provider text/link and duplicate caption")
        let providerFiles = providerPayload["attachments"] as! [[String: Any]]
        try require(providerFiles.count == 2 && providerFiles[0]["name"] as? String == "original.bin", "directory copy with original filename")
        let imageFile = providerFiles.first { $0["name"] as? String == "Original photo.jpg" }!
        let imageChunk = try providerSession.read(accountId: "provider-owner", fileId: imageFile["id"] as! String, offset: 0, length: 64)
        try require(Data(base64Encoded: imageChunk["base64"] as! String) == originalPhotoBytes, "original image bytes preserved")
        try require((providerPayload["directories"] as! [String]).contains("Item 1/Original Folder/Nested Empty"), "empty directory preserved")
        try require(try Data(contentsOf: source.appendingPathComponent("original.bin")) == Data([8, 7, 6]), "source unchanged")
        // Finder/NSSharingService's file providers put the content type first.
        // These must remain original attachments rather than typed previews.
        let selectedText = root.appendingPathComponent("Original bytes 🥰.txt")
        let selectedTextBytes = Data("Selected file\nSecond line 🥰\n".utf8)
        try selectedTextBytes.write(to: selectedText)
        let selectedFiles = NSExtensionItem()
        selectedFiles.attachments = [NSItemProvider(contentsOf: selectedText)!, NSItemProvider(contentsOf: photo)!]
        let originalsId = try await MacShareItemImporter(inbox: inbox).save([selectedFiles])
        let originalsSession = try ShareComposerSession(inbox: inbox, id: originalsId, origin: renderer, bindUnboundOrigin: true)
        let originals = try originalsSession.incoming(accountId: "provider-owner")
        try require(originals["text"] as? String == "", "explicit text file is not inline composer text")
        let originalsFiles = originals["attachments"] as! [[String: Any]]
        try require(Set(originalsFiles.map { $0["name"] as! String }) == Set(["Original bytes 🥰.txt", "Original photo.jpg"]), "contentsOf preserves original basenames")
        for file in originalsFiles {
            let chunk = try originalsSession.read(accountId: "provider-owner", fileId: file["id"] as! String, offset: 0, length: 256)
            let expected = file["name"] as? String == "Original photo.jpg" ? originalPhotoBytes : selectedTextBytes
            try require(Data(base64Encoded: chunk["base64"] as! String) == expected, "contentsOf preserves exact original bytes")
        }
        let cancelled = MacShareItemImporter(inbox: inbox)
        cancelled.cancel()
        do { _ = try await cancelled.save([item]); throw NSError(domain: "Expected cancellation", code: 1) }
        catch is CancellationError { }
        print("Native share tests passed: durable staging, exact chunks, account/origin/API binding, lease, retry, receipt, symlink refusal, iOS compatibility")
    }
}
