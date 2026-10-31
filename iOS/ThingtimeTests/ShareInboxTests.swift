import XCTest
import Photos
import UIKit
import Darwin
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
