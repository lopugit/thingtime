import Foundation
import Photos
import UIKit
import UniformTypeIdentifiers

/// Kept injectable so fallback ordering and temporary-file lifetime are testable.
protocol ShareItemSource {
    var registeredTypeIdentifiers: [String] { get }
    var suggestedName: String? { get }
    var suppliesLivePhoto: Bool { get }
    var suppliesImage: Bool { get }
    func file(type: String, consume: @escaping (URL) throws -> Void, completion: @escaping (Error?) -> Void) -> Progress
    func data(type: String, completion: @escaping (Data?, Error?) -> Void) -> Progress
    func item(type: String, consume: @escaping (NSSecureCoding) throws -> Void, completion: @escaping (Error?) -> Void) -> Progress
    func livePhoto(completion: @escaping (PHLivePhoto?, Error?) -> Void) -> Progress
    func image(completion: @escaping (UIImage?, Error?) -> Void) -> Progress
}

extension ShareItemSource {
    var suppliesImage: Bool { false }
    func image(completion: @escaping (UIImage?, Error?) -> Void) -> Progress {
        completion(nil, ShareItemImporter.Failure.noRepresentation)
        return Progress()
    }
}

struct ProviderShareItem: ShareItemSource {
    let provider: NSItemProvider
    private let liveResources = ShareProviderResourceLease()
    init(provider: NSItemProvider) {
        self.provider = provider
        #if DEBUG
        // Type identifiers only: no filenames, URLs, asset IDs or payload content.
        NSLog("ThingtimeShare provider types=%@ live=%@ image=%@", provider.registeredTypeIdentifiers.joined(separator: ","), NSNumber(value: provider.canLoadObject(ofClass: PHLivePhoto.self)), NSNumber(value: provider.canLoadObject(ofClass: UIImage.self)))
        #endif
    }
    var registeredTypeIdentifiers: [String] { provider.registeredTypeIdentifiers }
    var suggestedName: String? { provider.suggestedName }
    var suppliesLivePhoto: Bool {
        provider.canLoadObject(ofClass: PHLivePhoto.self) || provider.hasItemConformingToTypeIdentifier(UTType.livePhoto.identifier)
    }
    var suppliesImage: Bool { provider.canLoadObject(ofClass: UIImage.self) }
    func file(type: String, consume: @escaping (URL) throws -> Void, completion: @escaping (Error?) -> Void) -> Progress {
        provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
            guard let url else { completion(error ?? ShareItemImporter.Failure.noRepresentation); return }
            // The URL is invalid after this callback. Never resume before copying it.
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do { try consume(url); completion(nil) } catch { completion(error) }
        }
    }
    func data(type: String, completion: @escaping (Data?, Error?) -> Void) -> Progress {
        provider.loadDataRepresentation(forTypeIdentifier: type, completionHandler: completion)
    }
    func item(type: String, consume: @escaping (NSSecureCoding) throws -> Void, completion: @escaping (Error?) -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        if type == UTType.image.identifier || type == "com.apple.uikit.image" {
            ShareItemProviderBridge.loadImage(from: provider, typeIdentifier: type) { image, error in
                guard let image else { completion(error ?? ShareItemImporter.Failure.noRepresentation); return }
                do { try consume(image); completion(nil) } catch { completion(error) }
            }
            return progress
        }
        provider.loadItem(forTypeIdentifier: type, options: nil) { item, error in
            guard let item else { completion(error ?? ShareItemImporter.Failure.noRepresentation); return }
            do { try consume(item); completion(nil) } catch { completion(error) }
            progress.completedUnitCount = 1
        }
        return progress
    }
    func image(completion: @escaping (UIImage?, Error?) -> Void) -> Progress {
        provider.loadObject(ofClass: UIImage.self) { object, error in completion(object as? UIImage, error) }
    }
    func livePhoto(completion: @escaping (PHLivePhoto?, Error?) -> Void) -> Progress {
        if provider.canLoadObject(ofClass: PHLivePhoto.self) {
            return provider.loadObject(ofClass: PHLivePhoto.self) { object, error in completion(object as? PHLivePhoto, error) }
        }
        // Photos' legacy share provider advertises Live Photo while reporting
        // canLoadObject=false. Its supported loadItem path still returns one.
        let progress = Progress(totalUnitCount: 1)
        ShareItemProviderBridge.loadLivePhoto(from: provider) { item, error in
            if progress.isCancelled { completion(nil, CancellationError()); return }
            if let photo = item { completion(photo, nil); return }
            #if DEBUG
            NSLog("ThingtimeShare legacy live item class=%@ error=%@/%ld", item.map { String(describing: type(of: $0)) } ?? "nil", (error as NSError?)?.domain ?? "none", (error as NSError?)?.code ?? 0)
            #endif
            // Some hosts export a Live Photo package instead of a typed object.
            // Copy the package before the provider callback's temporary URL dies.
            let fileProgress = provider.loadFileRepresentation(forTypeIdentifier: UTType.livePhoto.identifier) { url, fileError in
                if progress.isCancelled { completion(nil, CancellationError()); return }
                guard let url else {
                    #if DEBUG
                    NSLog("ThingtimeShare live file unavailable error=%@/%ld", (fileError as NSError?)?.domain ?? "none", (fileError as NSError?)?.code ?? 0)
                    #endif
                    let dataProgress = provider.loadDataRepresentation(forTypeIdentifier: UTType.livePhoto.identifier) { data, dataError in
                        #if DEBUG
                        NSLog("ThingtimeShare live data bytes=%ld error=%@/%ld", data?.count ?? -1, (dataError as NSError?)?.domain ?? "none", (dataError as NSError?)?.code ?? 0)
                        #endif
                        if let data {
                            do { completion(try PHLivePhoto.object(withItemProviderData: data, typeIdentifier: UTType.livePhoto.identifier), nil) }
                            catch { completion(nil, error) }
                        } else { completion(nil, dataError ?? fileError ?? error ?? ShareItemImporter.Failure.livePhotoResources) }
                    }
                    progress.cancellationHandler = { dataProgress.cancel() }
                    if progress.isCancelled { dataProgress.cancel() }
                    return
                }
                #if DEBUG
                NSLog("ThingtimeShare live file extension=%@ directory=%@", url.pathExtension, NSNumber(value: (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true))
                #endif
                do {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let directory = try liveResources.directory()
                    let copied = try ShareInbox(root: directory).copy(url, into: directory)
                    let candidates: [URL]
                    if (try copied.resourceValues(forKeys: [.isDirectoryKey])).isDirectory == true {
                        candidates = FileManager.default.enumerator(at: copied, includingPropertiesForKeys: [.isRegularFileKey])?.compactMap { $0 as? URL } ?? []
                    } else { candidates = [copied] }
                    let resources = candidates.filter { candidate in
                        guard let type = UTType(filenameExtension: candidate.pathExtension) else { return false }
                        return type.conforms(to: .image) || type.conforms(to: .movie)
                    }
                    guard resources.count >= 2 else { throw ShareItemImporter.Failure.livePhotoResources }
                    let request = PHLivePhoto.request(withResourceFileURLs: resources, placeholderImage: nil, targetSize: .zero, contentMode: .aspectFit) { photo, info in
                        if (info[PHLivePhotoInfoIsDegradedKey] as? Bool) == true { return }
                        completion(photo, photo == nil ? ShareItemImporter.Failure.livePhotoResources : nil)
                    }
                    progress.cancellationHandler = { PHLivePhoto.cancelRequest(withRequestID: request) }
                    if progress.isCancelled { PHLivePhoto.cancelRequest(withRequestID: request) }
                } catch { completion(nil, error) }
            }
            progress.cancellationHandler = { fileProgress.cancel() }
            if progress.isCancelled { fileProgress.cancel() }
        }
        return progress
    }
}

private final class ShareProviderResourceLease {
    private var location: URL?
    func directory() throws -> URL {
        if let location { return location }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-share-live-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        location = directory
        return directory
    }
    deinit { if let location { try? FileManager.default.removeItem(at: location) } }
}

final class ShareImportCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var active: Progress?
    func check() throws { lock.lock(); defer { lock.unlock() }; if cancelled { throw CancellationError() } }
    func track(_ progress: Progress) {
        lock.lock(); active = progress; let shouldCancel = cancelled; lock.unlock()
        if shouldCancel { progress.cancel() }
    }
    func cancel() {
        lock.lock(); cancelled = true; let progress = active; lock.unlock()
        progress?.cancel()
    }
}

final class ShareItemImporter {
    enum Failure: LocalizedError {
        case noRepresentation, livePhotoResources, item(Int)
        var errorDescription: String? {
            switch self {
            case .noRepresentation: return "The source could not supply a readable file, URL, image or text representation."
            case .livePhotoResources: return "The source could not supply both the original photo and motion resources of this Live Photo. Nothing was saved. Try sharing the unmodified original from Photos."
            case .item(let index): return "Item \(index) could not be read from the source. Nothing from this share was saved. Try downloading the original in the source app, then share again."
            }
        }
    }
    private let inbox: ShareInbox
    let cancellation: ShareImportCancellation
    init(inbox: ShareInbox, cancellation: ShareImportCancellation = .init()) {
        self.inbox = inbox
        self.cancellation = cancellation
    }
    func save(_ sources: [ShareItemSource], additionalText: [String] = [], progress: @escaping (Int, Int) -> Void) async throws {
        let batch = try inbox.begin()
        do {
            let total = sources.count + additionalText.count
            guard total > 0 else { throw ShareInbox.Failure.empty }
            for (index, source) in sources.enumerated() {
                try cancellation.check()
                let directory = batch.payload.appendingPathComponent("Item \(index + 1)", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                do { try await save(source, into: directory) }
                catch is CancellationError { throw CancellationError() }
                catch Failure.livePhotoResources { throw Failure.livePhotoResources }
                catch { throw Failure.item(index + 1) }
                progress(index + 1, total)
            }
            for (index, text) in additionalText.enumerated() {
                try cancellation.check()
                try Data(text.utf8).write(to: inbox.uniqueURL(in: batch.payload, suggestedName: "Shared text.txt"), options: .atomic)
                progress(sources.count + index + 1, total)
            }
            try cancellation.check()
            try inbox.commit(batch)
        } catch { inbox.rollback(batch); throw error }
    }
    private func save(_ source: ShareItemSource, into directory: URL) async throws {
        if source.suppliesLivePhoto {
            do {
                let photo: PHLivePhoto = try await withCheckedThrowingContinuation { continuation in
                    cancellation.track(source.livePhoto { photo, error in
                        if let photo { continuation.resume(returning: photo) }
                        else { continuation.resume(throwing: error ?? Failure.livePhotoResources) }
                    })
                }
                try cancellation.check()
                let resources = PHAssetResource.assetResources(for: photo)
                guard resources.contains(where: { [.photo, .fullSizePhoto, .alternatePhoto].contains($0.type) }),
                      resources.contains(where: { [.pairedVideo, .fullSizePairedVideo].contains($0.type) }) else { throw Failure.livePhotoResources }
                for resource in resources {
                    try cancellation.check()
                    let destination = inbox.uniqueURL(in: directory, suggestedName: resource.originalFilename)
                    try await saveResource(resource, to: destination)
                }
                return
            } catch is CancellationError { throw CancellationError() }
            catch { throw Failure.livePhotoResources }
        }
        let types = Array(NSOrderedSet(array: source.registeredTypeIdentifiers)) as? [String] ?? []
        // Provider ordering expresses fidelity. Exhaust each type before degrading
        // to another advertised type; custom/future UTIs remain eligible.
        for type in types {
            try cancellation.check()
            let isURL = UTType(type)?.conforms(to: .url) == true
            // UIKit's image-object representation is a keyed archive, not a
            // portable image file. Decode only through the typed public loader.
            if type == "com.apple.uikit.image" || type == UTType.image.identifier {
                // UIActivityViewController's legacy provider may deny the newer
                // class-loader probe while loadItem still returns UIImage.
                do { try await saveItem(source, type: type, into: directory); return }
                catch { try cancellation.check(); try clear(directory) }
                guard source.suppliesImage else { continue }
                do {
                    let image: UIImage = try await withCheckedThrowingContinuation { continuation in
                        cancellation.track(source.image { image, error in
                            if let image { continuation.resume(returning: image) } else { continuation.resume(throwing: error ?? Failure.noRepresentation) }
                        })
                    }
                    try cancellation.check()
                    guard let png = image.pngData() else { throw Failure.noRepresentation }
                    try png.write(to: directory.appendingPathComponent("Shared image.png"), options: .atomic)
                    return
                } catch { try cancellation.check(); try clear(directory); continue }
            }
            if !isURL {
                do {
                    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                        cancellation.track(source.file(type: type, consume: { [inbox, cancellation] url in
                            _ = try inbox.copy(url, into: directory, suggestedName: Self.filename(source, type: type, fallback: url.lastPathComponent), checkCancellation: cancellation.check)
                        }, completion: { error in
                            if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                        }))
                    }
                    return
                } catch { try cancellation.check(); try clear(directory) }
            } else {
                // public.file-url describes a reference, not the referenced file's
                // bytes. Resolve the typed URL while its callback is still valid.
                do { try await saveItem(source, type: type, into: directory); return }
                catch { try cancellation.check(); try clear(directory) }
                if UTType(type)?.conforms(to: .fileURL) == true { continue }
            }
            do {
                let data: Data = try await withCheckedThrowingContinuation { continuation in
                    cancellation.track(source.data(type: type) { data, error in
                        if let data { continuation.resume(returning: data) } else { continuation.resume(throwing: error ?? Failure.noRepresentation) }
                    })
                }
                try cancellation.check()
                if isURL {
                    guard let text = String(data: data, encoding: .utf8), let url = URL(string: text), url.scheme != nil, !url.isFileURL else { throw Failure.noRepresentation }
                    try Data(text.utf8).write(to: directory.appendingPathComponent("Shared link.txt"), options: .atomic)
                } else {
                    try data.write(to: directory.appendingPathComponent(Self.filename(source, type: type, fallback: "Shared item")), options: .atomic)
                }
                return
            } catch { try cancellation.check(); try clear(directory) }
            if !isURL {
                do { try await saveItem(source, type: type, into: directory); return }
                catch { try cancellation.check(); try clear(directory) }
            }
        }
        throw Failure.noRepresentation
    }
    private func saveItem(_ source: ShareItemSource, type: String, into directory: URL) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            cancellation.track(source.item(type: type, consume: { [inbox, cancellation] item in
                try cancellation.check()
                if type == UTType.image.identifier || type == "com.apple.uikit.image" {
                    let image: UIImage?
                    if let value = item as? UIImage { image = value }
                    else if let value = item as? Data { image = try Self.decodeUIKitImage(value) }
                    else if let url = item as? URL, url.isFileURL {
                        let scoped = url.startAccessingSecurityScopedResource()
                        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                        image = try Self.decodeUIKitImage(Data(contentsOf: url))
                    } else { image = nil }
                    guard let image, let png = image.pngData() else { throw Failure.noRepresentation }
                    try png.write(to: directory.appendingPathComponent("Shared image.png"), options: .atomic)
                    return
                }
                if let url = item as? URL {
                    if url.isFileURL {
                        let scoped = url.startAccessingSecurityScopedResource()
                        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                        var coordinationError: NSError?
                        var copyError: Error?
                        NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinationError) { readableURL in
                            do { _ = try inbox.copy(readableURL, into: directory, checkCancellation: cancellation.check) }
                            catch { copyError = error }
                        }
                        if let error = copyError ?? coordinationError { throw error }
                    } else { try Data(url.absoluteString.utf8).write(to: directory.appendingPathComponent("Shared link.txt"), options: .atomic) }
                } else if let text = item as? String {
                    try Data(text.utf8).write(to: directory.appendingPathComponent("Shared text.txt"), options: .atomic)
                } else if let text = item as? NSAttributedString {
                    let data = try text.data(from: NSRange(location: 0, length: text.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtfd])
                    try data.write(to: directory.appendingPathComponent("Shared text.rtfd"), options: .atomic)
                } else if let data = item as? Data, UTType(type)?.conforms(to: .url) != true,
                          type != UTType.image.identifier, type != "com.apple.uikit.image" {
                    try data.write(to: directory.appendingPathComponent(Self.filename(source, type: type, fallback: "Shared item")), options: .atomic)
                } else if let image = item as? UIImage, let png = image.pngData() {
                    try png.write(to: directory.appendingPathComponent("Shared image.png"), options: .atomic)
                } else { throw Failure.noRepresentation }
            }, completion: { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }))
        }
    }
    /// Only UIKit's advertised image-object transport is securely decoded.
    /// Unknown shared blobs never enter an object unarchiver.
    private static func decodeUIKitImage(_ data: Data) throws -> UIImage? {
        if let image = UIImage(data: data) { return image }
        return try NSKeyedUnarchiver.unarchivedObject(ofClass: UIImage.self, from: data)
    }
    private func saveResource(_ resource: PHAssetResource, to destination: URL) async throws {
        guard FileManager.default.createFile(atPath: destination.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
        let writer = try ShareResourceWriter(destination: destination, cancellation: cancellation)
        let manager = PHAssetResourceManager.default()
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        let progress = Progress(totalUnitCount: 100)
        cancellation.track(progress)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let request = manager.requestData(for: resource, options: options, dataReceivedHandler: { data in
                do { try writer.append(data) } catch { progress.cancel() }
            }, completionHandler: { error in
                let writeError = writer.finish()
                if let error = writeError ?? error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            })
            progress.cancellationHandler = { manager.cancelDataRequest(request) }
            if progress.isCancelled { manager.cancelDataRequest(request) }
        }
        try cancellation.check()
    }
    private func clear(_ directory: URL) throws {
        for item in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: item) }
    }
    static func filename(_ source: ShareItemSource, type: String, fallback: String) -> String {
        let raw = ((source.suggestedName ?? fallback) as NSString).lastPathComponent
        let name = raw.isEmpty || raw == "." || raw == ".." ? "Shared item" : raw
        if (name as NSString).pathExtension.isEmpty, let ext = UTType(type)?.preferredFilenameExtension { return "\(name).\(ext)" }
        return name
    }
}

/// Photos may deliver resource chunks on a background queue. Keep writes, errors
/// and close serialized while cancellation stays available on the main thread.
private final class ShareResourceWriter: @unchecked Sendable {
    private let lock = NSLock()
    private let output: FileHandle
    private let cancellation: ShareImportCancellation
    private var failure: Error?
    init(destination: URL, cancellation: ShareImportCancellation) throws {
        output = try FileHandle(forWritingTo: destination)
        self.cancellation = cancellation
    }
    func append(_ data: Data) throws {
        lock.lock(); defer { lock.unlock() }
        do {
            if let failure { throw failure }
            try cancellation.check()
            try output.write(contentsOf: data)
        } catch { failure = error; throw error }
    }
    func finish() -> Error? {
        lock.lock(); defer { lock.unlock() }
        do { try output.synchronize(); try output.close() } catch { if failure == nil { failure = error } }
        return failure
    }
}
