import XCTest
import Photos
import UIKit
import Darwin
import Network
import WebKit
@testable import Thingtime

final class ShareInboxTests: XCTestCase {
    private var root: URL!
    private var inbox: ShareInbox!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        inbox = ShareInbox(root: root.appendingPathComponent("Inbox"))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }
    private func sharedFiles() throws -> [URL] {
        let shared = root.appendingPathComponent("Shared")
        try inbox.drain(to: shared)
        return FileManager.default.enumerator(at: shared, includingPropertiesForKeys: nil)!.compactMap { $0 as? URL }.filter {
            !$0.lastPathComponent.hasPrefix(".") && (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
        }
    }
    func testCustomTypeFallbackCopiesDuringCallback() async throws {
        let source = StubShareItem(types: ["com.example.broken", "com.example.custom"])
        let original = root.appendingPathComponent("original.custom")
        let expected = Data("original custom bytes".utf8)
        try expected.write(to: original)
        source.fileLoader = { type, consume, completion in
            if type == "com.example.broken" { completion(ShareItemImporter.Failure.noRepresentation) }
            else {
                do { try consume(original); try FileManager.default.removeItem(at: original); completion(nil) }
                catch { completion(error) }
            }
        }
        try await ShareItemImporter(inbox: inbox).save([source]) { _, _ in }
        XCTAssertEqual(source.calls, ["file:com.example.broken", "data:com.example.broken", "item:com.example.broken", "file:com.example.custom"])
        let files = try sharedFiles()
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(try Data(contentsOf: files[0]), expected)
    }
    func testDataFallbackAndTextURLFallbackArePreserved() async throws {
        let data = StubShareItem(types: ["com.example.custom"])
        data.dataLoader = { _, completion in completion(Data([0, 1, 2, 255]), nil) }
        let url = StubShareItem(types: ["public.url"])
        url.itemLoader = { _, consume, completion in
            do { try consume(NSURL(string: "https://example.org/shared?q=hello")!); completion(nil) } catch { completion(error) }
        }
        try await ShareItemImporter(inbox: inbox).save([data, url], additionalText: ["Caption 🦋"]) { _, _ in }
        let content = try sharedFiles().map { try Data(contentsOf: $0) }
        XCTAssertTrue(content.contains(Data([0, 1, 2, 255])))
        XCTAssertTrue(content.contains(Data("https://example.org/shared?q=hello".utf8)))
        XCTAssertTrue(content.contains(Data("Caption 🦋".utf8)))
        XCTAssertEqual(url.calls, ["item:public.url"])
    }
    func testActualUIImageProviderProducesPortableImageInsteadOfUIKitArchive() async throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).image { context in
            UIColor.systemBlue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        }
        let providers = [NSItemProvider(object: image), NSItemProvider(item: image, typeIdentifier: "public.image")]
        for provider in providers {
            try await ShareItemImporter(inbox: inbox).save([ProviderShareItem(provider: provider)]) { _, _ in }
        }
        let files = try sharedFiles()
        XCTAssertEqual(files.count, 2)
        for file in files {
            let bytes = try Data(contentsOf: file)
            XCTAssertNotNil(UIImage(data: bytes), "UIKit object archives are not usable shared image files")
            XCTAssertEqual(file.pathExtension, "png")
        }
    }
    func testLegacyUIKitImageURLArchiveBecomesPortableImage() async throws {
        let archive = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "shared-image-archive", withExtension: "bin"))
        let source = StubShareItem(types: ["public.image"])
        source.itemLoader = { _, consume, completion in
            do { try consume(archive as NSURL); completion(nil) } catch { completion(error) }
        }
        source.dataLoader = { _, _ in XCTFail("Legacy image archives must pass through the typed image adapter") }
        try await ShareItemImporter(inbox: inbox).save([source]) { _, _ in }
        let file = try XCTUnwrap(sharedFiles().first)
        XCTAssertEqual(file.pathExtension, "png")
        XCTAssertNotNil(UIImage(data: try Data(contentsOf: file)))
    }
    func testUnavailableGroupDoesNotReportPendingSharesButCommittedBatchFailureDoes() throws {
        let destination = root.appendingPathComponent("Shared")
        XCTAssertFalse(try ShareInbox.drainAvailable(to: destination, makeInbox: { throw ShareInbox.Failure.unavailable }))
        let batch = try inbox.begin()
        try Data([1]).write(to: batch.payload.appendingPathComponent("saved.bin"))
        try inbox.commit(batch)
        // An unrelated existing destination cannot be overwritten; this is real
        // waiting work and must surface the host's retry/error result.
        try FileManager.default.createDirectory(at: destination.appendingPathComponent(batch.id.uuidString), withIntermediateDirectories: true)
        XCTAssertThrowsError(try ShareInbox.drainAvailable(to: destination, makeInbox: { self.inbox }))
    }
    func testPreferredCustomDataWinsOverLossyAlternateFile() async throws {
        let source = StubShareItem(types: ["com.example.native", "public.png"])
        source.dataLoader = { type, completion in completion(type == "com.example.native" ? Data("native bytes".utf8) : nil, nil) }
        source.fileLoader = { type, _, completion in
            XCTAssertNotEqual(type, "public.png", "Native data must win before the lossy alternate file is requested")
            completion(ShareItemImporter.Failure.noRepresentation)
        }
        try await ShareItemImporter(inbox: inbox).save([source]) { _, _ in }
        XCTAssertEqual(try Data(contentsOf: sharedFiles()[0]), Data("native bytes".utf8))
        XCTAssertEqual(source.calls, ["file:com.example.native", "data:com.example.native"])
    }
    func testFileURLCopiesReferencedBytesInsideCallbackRatherThanSavingURLData() async throws {
        let source = StubShareItem(types: ["public.file-url"])
        let original = root.appendingPathComponent("original.bin")
        try Data([4, 3, 2, 1]).write(to: original)
        source.dataLoader = { _, completion in XCTFail("A file reference is not file contents"); completion(Data(original.absoluteString.utf8), nil) }
        source.itemLoader = { _, consume, completion in
            do { try consume(original as NSURL); try FileManager.default.removeItem(at: original); completion(nil) } catch { completion(error) }
        }
        try await ShareItemImporter(inbox: inbox).save([source]) { _, _ in }
        XCTAssertEqual(try Data(contentsOf: sharedFiles()[0]), Data([4, 3, 2, 1]))
        XCTAssertEqual(source.calls, ["item:public.file-url"])
    }
    func testOneUnreadableAttachmentRollsBackEntireBatch() async throws {
        let good = StubShareItem(types: ["public.data"])
        good.dataLoader = { _, completion in completion(Data("good".utf8), nil) }
        do {
            try await ShareItemImporter(inbox: inbox).save([good, StubShareItem(types: ["com.example.unreadable"])]) { _, _ in }
            XCTFail("An unreadable attachment must fail the batch")
        } catch { }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("Inbox/staging").path), [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Inbox/ready").path))
    }
    func testCancellationRollsBackInsteadOfCommittingPartialFiles() async throws {
        let token = ShareImportCancellation()
        let source = StubShareItem(types: ["public.data"])
        source.dataLoader = { _, completion in token.cancel(); completion(Data([1]), nil) }
        do { try await ShareItemImporter(inbox: inbox, cancellation: token).save([source]) { _, _ in }; XCTFail("Expected cancellation") }
        catch is CancellationError { }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("Inbox/staging").path), [])
    }
    func testDirectoriesAndDuplicateNamesSurviveDrainAndRepeatedDrain() throws {
        let source = root.appendingPathComponent("Folder")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try Data("nested".utf8).write(to: source.appendingPathComponent("photo.heic"))
        let batch = try inbox.begin()
        _ = try inbox.copy(source, into: batch.payload)
        _ = try inbox.copy(source, into: batch.payload)
        try inbox.commit(batch)
        let first = try sharedFiles()
        XCTAssertEqual(first.count, 2)
        XCTAssertEqual(Set(first.map { $0.deletingLastPathComponent().lastPathComponent }), ["Folder", "Folder (2)"])
        XCTAssertEqual(Set(try sharedFiles()), Set(first))
    }
    func testDrainRecoversFromAlreadyPublishedBatchWithoutDuplicating() throws {
        let batch = try inbox.begin()
        try Data("bytes".utf8).write(to: batch.payload.appendingPathComponent("saved.bin"))
        try inbox.commit(batch)
        let ready = root.appendingPathComponent("Inbox/ready/\(batch.id.uuidString)")
        let snapshot = root.appendingPathComponent("source-copy")
        try FileManager.default.copyItem(at: ready, to: snapshot)
        _ = try sharedFiles()
        // Recreate termination after publishing the final directory but before acknowledgement.
        try FileManager.default.copyItem(at: snapshot, to: ready)
        XCTAssertEqual(try sharedFiles().count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: ready.path))
    }
    func testExistingUnrelatedDirectoryIsNeverOverwrittenOrAcknowledged() throws {
        let batch = try inbox.begin()
        try Data([1]).write(to: batch.payload.appendingPathComponent("new.bin"))
        try inbox.commit(batch)
        let collision = root.appendingPathComponent("Shared/\(batch.id.uuidString)")
        try FileManager.default.createDirectory(at: collision, withIntermediateDirectories: true)
        let existing = collision.appendingPathComponent("existing.bin")
        try Data([2]).write(to: existing)
        XCTAssertThrowsError(try inbox.drain(to: root.appendingPathComponent("Shared")))
        XCTAssertEqual(try Data(contentsOf: existing), Data([2]))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Inbox/ready/\(batch.id.uuidString)").path))
    }
    func testUserReceiptFilenameSurvivesAndOneBadBatchDoesNotBlockOthers() throws {
        let bad = try inbox.begin()
        try Data([1]).write(to: bad.payload.appendingPathComponent("bad"))
        try inbox.commit(bad)
        let collision = root.appendingPathComponent("Shared/\(bad.id.uuidString)")
        try FileManager.default.createDirectory(at: collision, withIntermediateDirectories: true)
        let good = try inbox.begin()
        let bytes = Data("user file with reserved name".utf8)
        try bytes.write(to: good.payload.appendingPathComponent(".thingtime-share-receipt"))
        try inbox.commit(good)
        XCTAssertThrowsError(try inbox.drain(to: root.appendingPathComponent("Shared")))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("Shared/\(good.id.uuidString)/Files/.thingtime-share-receipt")), bytes)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Inbox/ready/\(good.id.uuidString)").path))
    }
    func testReplacingCheckedParentWithSymlinkCannotReadOutsideSelectedRoot() throws {
        let source = root.appendingPathComponent("Selected")
        let moved = root.appendingPathComponent("Original selected root")
        let outside = root.appendingPathComponent("Outside source scope")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try Data("selected bytes".utf8).write(to: source.appendingPathComponent("same-name.bin"))
        try Data("must never be imported".utf8).write(to: outside.appendingPathComponent("same-name.bin"))
        let batch = try inbox.begin()
        var checks = 0
        var swapped = false
        let result = try inbox.copy(source, into: batch.payload, checkCancellation: {
            checks += 1
            if checks == 3 {
                try FileManager.default.moveItem(at: source, to: moved)
                try FileManager.default.createSymbolicLink(at: source, withDestinationURL: outside)
                swapped = true
            }
        })
        XCTAssertTrue(swapped, "Exercise replacement after opening the selected root and before opening a child")
        XCTAssertEqual(try Data(contentsOf: result.appendingPathComponent("same-name.bin")), Data("selected bytes".utf8))
        inbox.rollback(batch)
    }
    func testSpecialFileIsRefusedWithoutWaitingForAWriter() throws {
        let pipe = root.appendingPathComponent("pipe")
        XCTAssertEqual(mkfifo(pipe.path, mode_t(0o600)), 0)
        let batch = try inbox.begin()
        XCTAssertThrowsError(try inbox.copy(pipe, into: batch.payload))
        inbox.rollback(batch)
    }
    func testProviderSymlinksAreRefused() throws {
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root)
        let batch = try inbox.begin()
        XCTAssertThrowsError(try inbox.copy(link, into: batch.payload))
        inbox.rollback(batch)
    }
    func testLivePhotoPreservesOriginalStillAndPairedVideoBytes() async throws {
        let bundle = Bundle(for: Self.self)
        let photo = try XCTUnwrap(bundle.url(forResource: "live-photo", withExtension: "jpg"))
        let video = try XCTUnwrap(bundle.url(forResource: "live-photo", withExtension: "mov"))
        let live: PHLivePhoto = try await withCheckedThrowingContinuation { continuation in
            PHLivePhoto.request(withResourceFileURLs: [photo, video], placeholderImage: nil,
                                targetSize: .zero, contentMode: .aspectFit) { live, info in
                if (info[PHLivePhotoInfoIsDegradedKey] as? Bool) == true { return }
                if let live { continuation.resume(returning: live) }
                else { continuation.resume(throwing: ShareItemImporter.Failure.livePhotoResources) }
            }
        }
        let provider = NSItemProvider()
        provider.registerItem(forTypeIdentifier: "com.apple.live-photo") { completion, expectedClass, _ in
            // Photos' legacy loader can require concrete block-class metadata.
            // An unconditional local load handler would hide this transport bug.
            guard let expectedClass, ObjectIdentifier(expectedClass) == ObjectIdentifier(PHLivePhoto.self) else {
                completion?(nil, ShareItemImporter.Failure.noRepresentation)
                return
            }
            completion?(live, nil)
        }
        let source = ProviderShareItem(provider: provider)
        XCTAssertTrue(source.suppliesLivePhoto, "Advertised legacy Live Photo intent must not depend on canLoadObject")
        try await ShareItemImporter(inbox: inbox).save([source]) { _, _ in }
        let content = try sharedFiles().map { try Data(contentsOf: $0) }
        XCTAssertEqual(content.count, 2)
        XCTAssertTrue(content.contains(try Data(contentsOf: photo)))
        XCTAssertTrue(content.contains(try Data(contentsOf: video)))
    }
    func testMissingLivePhotoResourcesNeverFallsBackToStillImage() async throws {
        let source = StubShareItem(types: ["com.apple.live-photo", "public.jpeg"])
        source.suppliesLivePhoto = true
        do { try await ShareItemImporter(inbox: inbox).save([source]) { _, _ in }; XCTFail("Expected failure") } catch { }
        XCTAssertEqual(source.calls, ["livePhoto"])
    }
    func testShippedActivationAcceptsCustomTypesManyAttachmentsAndTextButRejectsEmpty() throws {
        let plugin = Bundle.main.bundleURL.appendingPathComponent("PlugIns/ThingtimeShare.appex/Info.plist")
        let info = try XCTUnwrap(NSDictionary(contentsOf: plugin) as? [String: Any])
        let ext = try XCTUnwrap(info["NSExtension"] as? [String: Any])
        let attributes = try XCTUnwrap(ext["NSExtensionAttributes"] as? [String: Any])
        let rule = try XCTUnwrap(attributes["NSExtensionActivationRule"] as? String)
        XCTAssertFalse(rule.contains("TRUEPREDICATE"))
        let predicate = NSPredicate(format: rule)
        let custom = NSItemProvider(item: Data([1]) as NSData, typeIdentifier: "com.example.future-format")
        let item = NSExtensionItem()
        item.attachments = Array(repeating: custom, count: 250)
        XCTAssertTrue(predicate.evaluate(with: ["extensionItems": [item]]))
        let text = NSExtensionItem(); text.attributedContentText = NSAttributedString(string: "hello")
        XCTAssertTrue(predicate.evaluate(with: ["extensionItems": [text]]))
        XCTAssertFalse(predicate.evaluate(with: ["extensionItems": [NSExtensionItem()]]))
        XCTAssertFalse(predicate.evaluate(with: ["extensionItems": []]))
    }
    func testComposerPrefillsTypedTextAndStreamsOriginalBinaryWithOwnershipFencing() async throws {
        let binary = StubShareItem(types: ["com.example.original"])
        let original = Data((0..<(ShareComposerSession.maxChunkBytes + 17)).map { UInt8($0 % 251) })
        binary.dataLoader = { _, completion in completion(original, nil) }
        let link = StubShareItem(types: ["public.url"])
        link.itemLoader = { _, consume, completion in
            do { try consume(NSURL(string: "https://example.org/shared")!); completion(nil) } catch { completion(error) }
        }
        let origin = URL(string: "https://thingtime.com")!
        let id = try await ShareItemImporter(inbox: inbox).save([binary, link], additionalText: ["Caption 🦋"], composerOrigin: origin) { _, _ in }
        let session = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertTrue((draft["text"] as? String)?.contains("https://example.org/shared") == true)
        XCTAssertTrue((draft["text"] as? String)?.contains("Caption 🦋") == true)
        let attachments = try XCTUnwrap(draft["attachments"] as? [[String: Any]])
        XCTAssertEqual(attachments.count, 1)
        let fileId = try XCTUnwrap(attachments[0]["id"] as? String)
        let first = try session.read(accountId: "test-owner", fileId: fileId, offset: 0, length: ShareComposerSession.maxChunkBytes)
        let last = try session.read(accountId: "test-owner", fileId: fileId, offset: UInt64(ShareComposerSession.maxChunkBytes), length: ShareComposerSession.maxChunkBytes)
        XCTAssertEqual(first["eof"] as? Bool, false)
        XCTAssertEqual(last["eof"] as? Bool, true)
        let firstBytes = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(first["base64"] as? String)))
        let lastBytes = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(last["base64"] as? String)))
        XCTAssertEqual(firstBytes + lastBytes, original)
        XCTAssertThrowsError(try session.read(accountId: "other", fileId: fileId, offset: 0, length: 1))
        XCTAssertThrowsError(try session.read(accountId: "test-owner", fileId: "../receipt", offset: 0, length: 1))
        XCTAssertThrowsError(try session.read(accountId: "test-owner", fileId: fileId, offset: 0, length: ShareComposerSession.maxChunkBytes + 1))
        XCTAssertThrowsError(try ShareComposerSession(inbox: inbox, id: id, origin: URL(string: "https://other.example")!))
        XCTAssertThrowsError(try ShareComposerSession(inbox: inbox, id: id, origin: origin), "A second composer must not take over the same share")
    }
    func testDismissedComposerReminderPersistsWithoutDeletingDraftOrFiles() async throws {
        let origin = URL(string: "https://thingtime.com")!
        let otherOrigin = URL(string: "https://other.example")!
        let id = try await ShareItemImporter(inbox: inbox).save([], additionalText: ["Keep this draft"], composerOrigin: origin) { _, _ in }
        let directory = try inbox.composerDirectory(id: id)
        let metadataBefore = try Data(contentsOf: directory.appendingPathComponent("composer.json"))
        XCTAssertThrowsError(try inbox.dismissComposerReminder(id: id, origin: otherOrigin))
        XCTAssertEqual(try inbox.pendingComposers(origin: origin, includeDismissed: false), [id])

        try inbox.dismissComposerReminder(id: id, origin: origin)
        try inbox.dismissComposerReminder(id: id, origin: origin)
        let reopened = ShareInbox(root: root.appendingPathComponent("Inbox"))
        XCTAssertEqual(try reopened.pendingComposers(origin: origin, includeDismissed: false), [])
        XCTAssertEqual(try reopened.pendingComposers(origin: origin), [id], "Shared drafts must still offer recovery")
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("composer.json")), metadataBefore)
        XCTAssertEqual(try reopened.pendingComposers(origin: otherOrigin), [])
        let session = try ShareComposerSession(inbox: reopened, id: id, origin: origin)
        XCTAssertEqual(try session.incoming(accountId: "test-owner")["text"] as? String, "Keep this draft")
        try reopened.drain(to: root.appendingPathComponent("Shared"))
        let copiedFiles = try sharedFiles()
        XCTAssertTrue(try copiedFiles.contains { try String(contentsOf: $0, encoding: .utf8) == "Keep this draft" })
        XCTAssertEqual(try reopened.pendingComposers(origin: origin, includeDismissed: false), [], "Composer metadata writes and Files drain must preserve dismissal")
        let next = try await ShareItemImporter(inbox: reopened).save([], additionalText: ["New share"], composerOrigin: origin) { _, _ in }
        XCTAssertEqual(try reopened.pendingComposers(origin: origin, includeDismissed: false), [next])
        XCTAssertEqual(Set(try reopened.pendingComposers(origin: origin)), Set([id, next]))
        XCTAssertThrowsError(try reopened.dismissComposerReminder(id: UUID(), origin: origin))
    }
    func testComposerRetainsUnfinishedBatchAcrossDrainAndBindsAccountAcrossRestart() async throws {
        let origin = URL(string: "https://thingtime.com")!
        let id = try await ShareItemImporter(inbox: inbox).save([], additionalText: ["Unfinished"], composerOrigin: origin) { _, _ in }
        let destination = root.appendingPathComponent("Shared")
        try inbox.drain(to: destination)
        XCTAssertEqual(try inbox.pendingComposers(origin: origin), [id])
        var first: ShareComposerSession? = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        _ = try first?.incoming(accountId: "test-owner")
        first = nil
        let recovered = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        XCTAssertThrowsError(try recovered.incoming(accountId: "other"))
        XCTAssertEqual(try recovered.incoming(accountId: "test-owner")["text"] as? String, "Unfinished")
        XCTAssertThrowsError(try recovered.complete(accountId: "test-owner"))
        let claim = ShareComposerSubmission(destination: "post", operationId: id.uuidString, targetId: nil, recoveryPayload: "edited draft payload")
        _ = try recovered.beginSubmission(accountId: "test-owner", submission: claim)
        let stored = try XCTUnwrap(recovered.incoming(accountId: "test-owner")["submission"] as? [String: Any])
        XCTAssertEqual(stored["recoveryPayload"] as? String, "edited draft payload")
        XCTAssertThrowsError(try recovered.beginSubmission(accountId: "test-owner", submission: ShareComposerSubmission(destination: "post", operationId: id.uuidString, targetId: nil, recoveryPayload: "changed draft payload")))
        XCTAssertThrowsError(try recovered.beginSubmission(accountId: "test-owner", submission: ShareComposerSubmission(destination: "message", operationId: id.uuidString, targetId: "other")))
        _ = try recovered.recordOutcome(accountId: "test-owner", submission: claim, outcomeIds: ["verified-post-id"])
        try recovered.complete(accountId: "test-owner")
        try recovered.complete(accountId: "test-owner") // Receipt acknowledgement is idempotent.
        XCTAssertEqual(try inbox.pendingComposers(origin: origin), [])
        try inbox.drain(to: destination)
        XCTAssertThrowsError(try inbox.composerDirectory(id: id))
        XCTAssertTrue(FileManager.default.fileExists(atPath: destination.appendingPathComponent(id.uuidString + "/Files/Shared text.txt").path))
    }
    func testComposerPreservesDirectoriesAndRejectsReplacedSymlinks() throws {
        let origin = URL(string: "https://thingtime.com")!
        let batch = try inbox.begin()
        try FileManager.default.createDirectory(at: batch.payload.appendingPathComponent("Folder/Empty"), withIntermediateDirectories: true)
        try Data([1, 2]).write(to: batch.payload.appendingPathComponent("Folder/original.bin"))
        try ShareComposerMetadata(origin: ShareComposerSession.origin(origin), textPaths: []).write(to: batch.directory)
        try inbox.commit(batch)
        let session = try ShareComposerSession(inbox: inbox, id: batch.id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertTrue((draft["directories"] as? [String])?.contains("Folder/Empty") == true)
        let file = try XCTUnwrap((draft["attachments"] as? [[String: Any]])?.first)
        XCTAssertEqual(file["relativePath"] as? String, "Folder/original.bin")
        let directory = try inbox.composerDirectory(id: batch.id)
        let path = directory.appendingPathComponent("payload/Folder/original.bin")
        try FileManager.default.removeItem(at: path)
        try FileManager.default.createSymbolicLink(at: path, withDestinationURL: directory.appendingPathComponent("receipt"))
        XCTAssertThrowsError(try session.read(accountId: "test-owner", fileId: try XCTUnwrap(file["id"] as? String), offset: 0, length: 10))
    }





    func testInvalidUTF8TextRemainsAnIntactFileInsteadOfReplacementOrTruncation() throws {
        let origin = URL(string: "https://thingtime.com")!
        let batch = try inbox.begin()
        let bytes = Data([0x61, 0xF0, 0x9F, 0x8C])
        try bytes.write(to: batch.payload.appendingPathComponent("invalid.txt"))
        try ShareComposerMetadata(origin: ShareComposerSession.origin(origin), textPaths: ["invalid.txt"]).write(to: batch.directory)
        try inbox.commit(batch)
        let session = try ShareComposerSession(inbox: inbox, id: batch.id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertEqual(draft["text"] as? String, "")
        let files = try XCTUnwrap(draft["attachments"] as? [[String: Any]])
        XCTAssertEqual(files.count, 1)
        let chunk = try session.read(accountId: "test-owner", fileId: try XCTUnwrap(files[0]["id"] as? String), offset: 0, length: ShareComposerSession.maxChunkBytes)
        XCTAssertEqual(Data(base64Encoded: try XCTUnwrap(chunk["base64"] as? String)), bytes)
    }
    func testInlineTextHasNoChunkSizeLimitAndDecodesSplitUTF8Scalars() async throws {
        let text = String(repeating: "a", count: ShareComposerSession.maxChunkBytes - 1) + "🌏\n尾"
        let origin = URL(string: "https://thingtime.com")!
        let id = try await ShareItemImporter(inbox: inbox).save([], additionalText: [text], composerOrigin: origin) { _, _ in }
        let session = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertEqual(draft["text"] as? String, text)
        XCTAssertEqual((draft["attachments"] as? [[String: Any]])?.count, 0)
    }
    func testPlainTextTypedLoaderAvoidsKeyedArchiveAttachmentAndDuplicateCaption() async throws {
        let text = "Thingtime share acceptance – text\nUnicode: café 🌏"
        let source = StubShareItem(types: ["public.utf8-plain-text"])
        source.itemLoader = { _, consume, completion in
            do { try consume(text as NSString); completion(nil) } catch { completion(error) }
        }
        source.fileLoader = { _, _, _ in XCTFail("A typed String must not be imported as its keyed-archive file transport") }
        let origin = URL(string: "https://thingtime.com")!
        let id = try await ShareItemImporter(inbox: inbox).save([source, source], additionalText: [text], composerOrigin: origin) { _, _ in }
        let session = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertEqual(draft["text"] as? String, text + "\n\n" + text, "Retain independent provider multiplicity; omit only the repeated supplemental caption")
        XCTAssertEqual((draft["attachments"] as? [[String: Any]])?.count, 0)
        XCTAssertEqual(source.calls, ["item:public.utf8-plain-text", "item:public.utf8-plain-text"])
        let preserved = try sharedFiles().map { try Data(contentsOf: $0) }
        XCTAssertEqual(preserved.count, 3)
        XCTAssertTrue(preserved.allSatisfy { $0 == Data(text.utf8) })
    }

    func testExplicitTextFileReferenceKeepsOriginalEncodingAsAttachment() async throws {
        let text = "Original UTF16 file – café 🌏"
        let bytes = try XCTUnwrap(text.data(using: .utf16))
        let original = root.appendingPathComponent("original.txt")
        try bytes.write(to: original)
        let source = StubShareItem(types: ["public.utf16-plain-text", "public.file-url"])
        source.fileLoader = { _, consume, completion in
            do { try consume(original); completion(nil) } catch { completion(error) }
        }
        let origin = URL(string: "https://thingtime.com")!
        let id = try await ShareItemImporter(inbox: inbox).save([source], composerOrigin: origin) { _, _ in }
        let session = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertEqual(draft["text"] as? String, "")
        let attachments = try XCTUnwrap(draft["attachments"] as? [[String: Any]])
        XCTAssertEqual(attachments.count, 1)
        let chunk = try session.read(accountId: "test-owner", fileId: try XCTUnwrap(attachments.first?["id"] as? String), offset: 0, length: ShareComposerSession.maxChunkBytes)
        XCTAssertEqual(Data(base64Encoded: try XCTUnwrap(chunk["base64"] as? String)), bytes)
    }

    func testProviderContainersAreNotDirectoriesButRealEmptyFoldersAndDuplicatePathsSurvive() async throws {
        let original = root.appendingPathComponent("original.bin")
        let bytes = Data([1, 2, 3, 255])
        try bytes.write(to: original)
        let file = StubShareItem(types: ["public.data"])
        file.fileLoader = { _, consume, completion in
            do { try consume(original); completion(nil) } catch { completion(error) }
        }
        let folder = root.appendingPathComponent("Folder")
        try FileManager.default.createDirectory(at: folder.appendingPathComponent("Empty"), withIntermediateDirectories: true)
        try bytes.write(to: folder.appendingPathComponent("child.bin"))
        let directory = StubShareItem(types: ["public.folder"])
        directory.fileLoader = { _, consume, completion in
            do { try consume(folder); completion(nil) } catch { completion(error) }
        }
        let origin = URL(string: "https://thingtime.com")!
        let fileId = try await ShareItemImporter(inbox: inbox).save([file], composerOrigin: origin) { _, _ in }
        let fileSession = try ShareComposerSession(inbox: inbox, id: fileId, origin: origin)
        let fileDraft = try fileSession.incoming(accountId: "test-owner")
        XCTAssertEqual(fileDraft["directories"] as? [String], [])
        XCTAssertEqual((fileDraft["attachments"] as? [[String: Any]])?.count, 1)
        let id = try await ShareItemImporter(inbox: inbox).save([directory, directory], composerOrigin: origin) { _, _ in }
        let session = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertEqual(draft["directories"] as? [String], ["Item 1/Folder", "Item 1/Folder/Empty", "Item 2/Folder", "Item 2/Folder/Empty"])
        let files = try XCTUnwrap(draft["attachments"] as? [[String: Any]])
        XCTAssertEqual(files.compactMap { $0["relativePath"] as? String }, ["Item 1/Folder/child.bin", "Item 2/Folder/child.bin"])
        XCTAssertEqual(Set(files.compactMap { $0["id"] as? String }).count, 2)
        for entry in files {
            let chunk = try session.read(accountId: "test-owner", fileId: try XCTUnwrap(entry["id"] as? String), offset: 0, length: ShareComposerSession.maxChunkBytes)
            XCTAssertEqual(Data(base64Encoded: try XCTUnwrap(chunk["base64"] as? String)), bytes)
        }
    }
    func testActualFileURLProviderPreservesOriginalTextEncoding() async throws {
        let bytes = try XCTUnwrap("Actual text file – café 🌏".data(using: .utf16))
        let original = root.appendingPathComponent("original-utf16.txt")
        try bytes.write(to: original)
        let provider = ProviderShareItem(provider: try XCTUnwrap(NSItemProvider(contentsOf: original)))
        let origin = URL(string: "https://thingtime.com")!
        let id = try await ShareItemImporter(inbox: inbox).save([provider], composerOrigin: origin) { _, _ in }
        let session = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertEqual(draft["directories"] as? [String], [])
        let files = try XCTUnwrap(draft["attachments"] as? [[String: Any]])
        XCTAssertEqual(files.count, 1)
        let fileId = try XCTUnwrap(files.first?["id"] as? String)
        let read = try session.read(accountId: "test-owner", fileId: fileId, offset: 0, length: ShareComposerSession.maxChunkBytes)
        XCTAssertEqual(Data(base64Encoded: try XCTUnwrap(read["base64"] as? String)), bytes)
    }
    func testActualNSStringProviderPrefillsTextWithoutAnUpload() async throws {
        let text = "Native NSString – café 🌏"
        let origin = URL(string: "https://thingtime.com")!
        let provider = ProviderShareItem(provider: NSItemProvider(object: text as NSString))
        let id = try await ShareItemImporter(inbox: inbox).save([provider], additionalText: [text], composerOrigin: origin) { _, _ in }
        let session = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertEqual(draft["text"] as? String, text)
        XCTAssertEqual((draft["attachments"] as? [[String: Any]])?.count, 0)
        XCTAssertEqual(draft["directories"] as? [String], [], "Text is not a shared staging folder")
    }
    func testEmptyAndWhitespaceTextSourcesRemainOriginalAttachments() async throws {
        let origin = URL(string: "https://thingtime.com")!
        let empty = StubShareItem(types: ["public.utf8-plain-text"])
        empty.dataLoader = { _, completion in completion(Data(), nil) }
        let whitespace = StubShareItem(types: ["public.utf8-plain-text"])
        whitespace.dataLoader = { _, completion in completion(Data(" \n\t".utf8), nil) }
        let id = try await ShareItemImporter(inbox: inbox).save([empty, whitespace], composerOrigin: origin) { _, _ in }
        let session = try ShareComposerSession(inbox: inbox, id: id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        XCTAssertEqual(draft["text"] as? String, "")
        let files = try XCTUnwrap(draft["attachments"] as? [[String: Any]])
        XCTAssertEqual(files.count, 2)
        XCTAssertEqual(files[0]["size"] as? UInt64, 0)
        let chunk = try session.read(accountId: "test-owner", fileId: try XCTUnwrap(files[0]["id"] as? String), offset: 0, length: 1)
        XCTAssertEqual(chunk["base64"] as? String, "")
        XCTAssertEqual(chunk["eof"] as? Bool, true)
    }
    func testComposerFileHandlesAndOrderSurviveExtensionToAppRecovery() throws {
        let origin = URL(string: "https://thingtime.com")!
        let batch = try inbox.begin()
        try FileManager.default.createDirectory(at: batch.payload.appendingPathComponent("folder/empty"), withIntermediateDirectories: true)
        for item in ["Item 10", "Item 2"] { try FileManager.default.createDirectory(at: batch.payload.appendingPathComponent(item), withIntermediateDirectories: true) }
        for path in ["zeta.bin", "folder/zeta.bin", "alpha.bin", "Item 10/file.bin", "Item 2/file.bin"] { try Data(path.utf8).write(to: batch.payload.appendingPathComponent(path)) }
        try ShareComposerMetadata(origin: ShareComposerSession.origin(origin), textPaths: []).write(to: batch.directory)
        try inbox.commit(batch)
        var first: ShareComposerSession? = try ShareComposerSession(inbox: inbox, id: batch.id, origin: origin)
        let original = try XCTUnwrap(first?.incoming(accountId: "test-owner")["attachments"] as? [[String: Any]])
        first = nil
        let recovered = try ShareComposerSession(inbox: inbox, id: batch.id, origin: origin)
        let draft = try recovered.incoming(accountId: "test-owner")
        let next = try XCTUnwrap(draft["attachments"] as? [[String: Any]])
        XCTAssertEqual(original.compactMap { $0["relativePath"] as? String }, ["Item 2/file.bin", "Item 10/file.bin", "alpha.bin", "folder/zeta.bin", "zeta.bin"])
        XCTAssertEqual(original.compactMap { $0["id"] as? String }, next.compactMap { $0["id"] as? String })
        XCTAssertEqual(draft["directories"] as? [String], ["Item 2", "Item 10", "folder", "folder/empty"])
    }
    func testComposerThumbnailIsBoundedAndOriginalRemainsUnchanged() throws {
        let origin = URL(string: "https://thingtime.com")!
        let batch = try inbox.begin()
        let bytes = try XCTUnwrap(UIGraphicsImageRenderer(size: CGSize(width: 1600, height: 1000)).image { context in
            UIColor.systemBlue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 1600, height: 1000))
        }.pngData())
        try bytes.write(to: batch.payload.appendingPathComponent("original.png"))
        try ShareComposerMetadata(origin: ShareComposerSession.origin(origin), textPaths: []).write(to: batch.directory)
        try inbox.commit(batch)
        let session = try ShareComposerSession(inbox: inbox, id: batch.id, origin: origin)
        let draft = try session.incoming(accountId: "test-owner")
        let fileId = try XCTUnwrap((draft["attachments"] as? [[String: Any]])?.first?["id"] as? String)
        let thumbnail = try XCTUnwrap(session.thumbnail(accountId: "test-owner", fileId: fileId, maxDimension: 640))
        let preview = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(thumbnail["base64"] as? String)))
        XCTAssertLessThanOrEqual(preview.count, 512 * 1024)
        let image = try XCTUnwrap(UIImage(data: preview))
        XCTAssertLessThanOrEqual(max(image.size.width, image.size.height), 640)
        var original = Data()
        while original.count < bytes.count {
            let chunk = try session.read(accountId: "test-owner", fileId: fileId, offset: UInt64(original.count), length: ShareComposerSession.maxChunkBytes)
            original.append(try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(chunk["base64"] as? String))))
        }
        XCTAssertEqual(original, bytes)
    }

    @MainActor
    func testActualWebKitReplyBridgeNegotiatesAndRejectsSubframes() async throws {
        let listening = expectation(description: "Isolated native fixture listening")
        let listener = try NWListener(using: .tcp, on: .any)
        listener.stateUpdateHandler = { if case .ready = $0 { listening.fulfill() } }
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { data, _, _, _ in
                let child = data.flatMap { String(data: $0, encoding: .utf8) }?.hasPrefix("GET /child ") == true
                let html = child ? "<html><body>Child fixture</body></html>" : "<html><body>Native share fixture<iframe src='/child'></iframe></body></html>"
                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(html.utf8.count)\r\nConnection: close\r\n\r\n" + html
                connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        listener.start(queue: .global())
        defer { listener.cancel() }
        await fulfillment(of: [listening], timeout: 10)
        let port = try XCTUnwrap(listener.port?.rawValue)
        let origin = URL(string: "http://127.0.0.1:\(port)")!
        let id = try await ShareItemImporter(inbox: inbox).save([], additionalText: ["WebKit prefilled text"], composerOrigin: origin) { _, _ in }
        let localInbox = try XCTUnwrap(inbox)
        let bridge = ShareComposerBridge(origin: origin, requestId: id, makeInbox: { localInbox })
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: ShareComposerBridge.name)
        configuration.userContentController.addUserScript(ShareComposerBridge.script(origin: origin))
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 700), configuration: configuration)
        bridge.webView = webView
        let loaded = expectation(description: "Actual WKWebView loaded")
        let navigation = ShareBridgeTestNavigation(loaded: loaded)
        webView.navigationDelegate = navigation
        webView.load(URLRequest(url: try XCTUnwrap(ShareComposerSession.composerURL(origin: origin, requestId: id))))
        await fulfillment(of: [loaded], timeout: 20)
        let manifest = try await webView.callAsyncJavaScript("return await window.thingtimeShare.request({method:'manifest'});", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(manifest?["version"] as? String, "1.0.0")
        XCTAssertEqual(manifest?["maxChunkBytes"] as? Int, ShareComposerSession.maxChunkBytes)
        let arguments: [String: Any] = ["requestId": id.uuidString, "accountId": "test-owner"]
        let payload = try await webView.callAsyncJavaScript("return await window.thingtimeShare.request({method:'getIncomingShare',requestId,accountId});", arguments: arguments, in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(payload?["text"] as? String, "WebKit prefilled text")
        let refused = try await webView.callAsyncJavaScript("try { await document.querySelector('iframe').contentWindow.webkit.messageHandlers.thingtimeShare.postMessage({method:'manifest'}); return false; } catch { return true; }", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(refused as? Bool, true)
        webView.stopLoading()
        configuration.userContentController.removeScriptMessageHandler(forName: ShareComposerBridge.name, contentWorld: .page)
    }
    func testComposerOriginAndRouteRejectUntrustedDestinations() {
        XCTAssertEqual(ShareComposerSession.origin(URL(string: "https://thingtime.com:443/path")!), "https://thingtime.com")
        XCTAssertEqual(ShareComposerSession.origin(URL(string: "https://thingtime.com.evil.example")!), "https://thingtime.com.evil.example")
        XCTAssertEqual(ShareComposerSession.origin(URL(string: "http://thingtime.com")!), "")
        XCTAssertEqual(ShareComposerSession.origin(URL(string: "https://account:secret@thingtime.com")!), "")
        XCTAssertNil(ShareComposerSession.composerURL(origin: URL(string: "file:///tmp/share")!, requestId: UUID()))
    }

}

private final class StubShareItem: ShareItemSource {
    let registeredTypeIdentifiers: [String]
    var suggestedName: String?
    var suppliesLivePhoto = false
    var calls: [String] = []
    var fileLoader: ((String, (URL) throws -> Void, (Error?) -> Void) -> Void)?
    var dataLoader: ((String, (Data?, Error?) -> Void) -> Void)?
    var livePhotoLoader: (((PHLivePhoto?, Error?) -> Void) -> Void)?
    var itemLoader: ((String, (NSSecureCoding) throws -> Void, (Error?) -> Void) -> Void)?
    init(types: [String]) { registeredTypeIdentifiers = types }
    func file(type: String, consume: @escaping (URL) throws -> Void, completion: @escaping (Error?) -> Void) -> Progress {
        calls.append("file:\(type)")
        if let fileLoader { fileLoader(type, consume, completion) } else { completion(ShareItemImporter.Failure.noRepresentation) }
        return Progress()
    }
    func data(type: String, completion: @escaping (Data?, Error?) -> Void) -> Progress {
        calls.append("data:\(type)")
        if let dataLoader { dataLoader(type, completion) } else { completion(nil, ShareItemImporter.Failure.noRepresentation) }
        return Progress()
    }
    func item(type: String, consume: @escaping (NSSecureCoding) throws -> Void, completion: @escaping (Error?) -> Void) -> Progress {
        calls.append("item:\(type)")
        if let itemLoader { itemLoader(type, consume, completion) } else { completion(ShareItemImporter.Failure.noRepresentation) }
        return Progress()
    }
    func livePhoto(completion: @escaping (PHLivePhoto?, Error?) -> Void) -> Progress {
        calls.append("livePhoto")
        if let livePhotoLoader { livePhotoLoader(completion) } else { completion(nil, ShareItemImporter.Failure.livePhotoResources) }
        return Progress()
    }
}

private final class ShareBridgeTestNavigation: NSObject, WKNavigationDelegate {
    let loaded: XCTestExpectation
    init(loaded: XCTestExpectation) { self.loaded = loaded }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded.fulfill() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loaded.fulfill() }
}
