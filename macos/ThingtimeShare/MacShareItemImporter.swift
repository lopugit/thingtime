import AppKit
import UniformTypeIdentifiers

/// macOS NSItemProvider adaptation only. Durable storage and hostile-file
/// validation are shared with the iOS importer through ShareInbox.
final class MacShareItemImporter: @unchecked Sendable {
    private let inbox: ShareInbox
    private let lock = NSLock()
    private var cancelled = false
    private var progress: Progress?
    private var active: Progress? {
        get { lock.lock(); defer { lock.unlock() }; return progress }
        set {
            lock.lock(); progress = newValue; let stop = cancelled; lock.unlock()
            if stop { newValue?.cancel() }
        }
    }
    init(inbox: ShareInbox) { self.inbox = inbox }
    func cancel() { lock.lock(); cancelled = true; let current = progress; lock.unlock(); current?.cancel() }
    private func check() throws { lock.lock(); let stop = cancelled; lock.unlock(); if stop { throw CancellationError() } }
    func save(_ items: [NSExtensionItem]) async throws -> UUID {
        let batch = try inbox.begin()
        do {
            var textPaths: [String] = []
            var providerText = Set<String>()
            var containers: [String] = []
            for provider in items.flatMap({ $0.attachments ?? [] }) {
                try check()
                let name = "Item \(containers.count + 1)"
                let directory = batch.payload.appendingPathComponent(name, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
                containers.append(name)
                let inline = try await save(provider, into: directory)
                if let inline {
                    let path = name + "/" + inline.lastPathComponent
                    textPaths.append(path)
                    if let value = try? String(contentsOf: inline, encoding: .utf8) { providerText.insert(value) }
                }
            }
            var supplemental: [String] = []
            for text in items.compactMap({ $0.attributedContentText?.string }) where !text.isEmpty && !providerText.contains(text) {
                try check()
                let target = inbox.uniqueURL(in: batch.payload, suggestedName: "Shared text.txt")
                try Data(text.utf8).write(to: target, options: .atomic)
                textPaths.append(target.lastPathComponent); supplemental.append(target.lastPathComponent)
            }
            try check()
            try ShareComposerMetadata(origin: "", textPaths: textPaths, supplementalTextPaths: supplemental, providerContainers: containers).write(to: batch.directory)
            try inbox.commit(batch)
            return batch.id
        } catch { inbox.rollback(batch); throw error }
    }
    private func save(_ provider: NSItemProvider, into directory: URL) async throws -> URL? {
        let types = provider.registeredTypeIdentifiers
        for type in types {
            try check()
            let ut = UTType(type)
            // Prefer typed values for URLs/text; temporary file representations
            // of those can otherwise contain an archive or URL-reference bytes.
            if ut?.conforms(to: .url) == true || ut?.conforms(to: .plainText) == true {
                do { return try await saveItem(provider, type: type, into: directory) }
                catch { try check(); if Self.isWriteFailure(error) { throw error }; try clear(directory) }
            }
            if ut?.conforms(to: .url) != true {
                do {
                    let suggestedName = provider.suggestedName.map { _ in filename(provider, type: type, fallback: "Shared item") }
                    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                        active = provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                            guard let url else { continuation.resume(throwing: error ?? ShareInbox.Failure.empty); return }
                            let scoped = url.startAccessingSecurityScopedResource()
                            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                            do { _ = try self.inbox.copy(url, into: directory, suggestedName: suggestedName ?? url.lastPathComponent, checkCancellation: self.check); continuation.resume() }
                            catch { continuation.resume(throwing: error) }
                        }
                    }
                    return nil
                } catch { try check(); if Self.isWriteFailure(error) { throw error }; try clear(directory) }
            }
            do { return try await saveItem(provider, type: type, into: directory) }
            catch { try check(); if Self.isWriteFailure(error) { throw error }; try clear(directory) }
        }
        throw ShareInbox.Failure.empty
    }
    private func saveItem(_ provider: NSItemProvider, type: String, into directory: URL) async throws -> URL? {
        let suggestedName = filename(provider, type: type, fallback: "Shared item")
        return try await withCheckedThrowingContinuation { continuation in
            let receive: @Sendable (NSSecureCoding?, Error?) -> Void = { item, error in
                do {
                    try self.check()
                    guard let item else { throw error ?? ShareInbox.Failure.empty }
                    if let url = item as? URL {
                        if url.isFileURL {
                            let scoped = url.startAccessingSecurityScopedResource()
                            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                            var coordinationError: NSError?, copyError: Error?
                            NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinationError) { readable in
                                do { _ = try self.inbox.copy(readable, into: directory, checkCancellation: self.check) } catch { copyError = error }
                            }
                            if let error = copyError ?? coordinationError { throw error }
                            continuation.resume(returning: nil)
                        } else {
                            let target = directory.appendingPathComponent("Shared link.txt")
                            try Data(url.absoluteString.utf8).write(to: target, options: .atomic)
                            continuation.resume(returning: target)
                        }
                    } else if let text = item as? String {
                        let target = directory.appendingPathComponent("Shared text.txt")
                        try Data(text.utf8).write(to: target, options: .atomic)
                        continuation.resume(returning: target)
                    } else if let image = item as? NSImage, let tiff = image.tiffRepresentation {
                        try tiff.write(to: directory.appendingPathComponent("Shared image.tiff"), options: .atomic)
                        continuation.resume(returning: nil)
                    } else if let data = item as? Data {
                        if UTType(type)?.conforms(to: .url) == true {
                            guard let text = String(data: data, encoding: .utf8), let url = URL(string: text), url.scheme != nil, !url.isFileURL else { throw ShareInbox.Failure.empty }
                            let target = directory.appendingPathComponent("Shared link.txt")
                            try Data(text.utf8).write(to: target, options: .atomic)
                            continuation.resume(returning: target)
                        } else {
                            let target = directory.appendingPathComponent(suggestedName)
                            try data.write(to: target, options: .atomic)
                            continuation.resume(returning: UTType(type)?.conforms(to: .plainText) == true ? target : nil)
                        }
                    } else { throw ShareInbox.Failure.empty }
                } catch { continuation.resume(throwing: error) }
            }
            if UTType(type)?.conforms(to: .url) == true, provider.canLoadObject(ofClass: NSURL.self) {
                active = provider.loadObject(ofClass: NSURL.self) { value, error in receive(value as? NSURL, error) }
            } else if UTType(type)?.conforms(to: .plainText) == true, provider.canLoadObject(ofClass: NSString.self) {
                active = provider.loadObject(ofClass: NSString.self) { value, error in receive(value as? NSString, error) }
            } else if UTType(type)?.conforms(to: .image) == true, provider.canLoadObject(ofClass: NSImage.self) {
                active = provider.loadObject(ofClass: NSImage.self) { value, error in receive(value as? NSImage, error) }
            } else {
                provider.loadItem(forTypeIdentifier: type, options: nil, completionHandler: receive)
            }
        }
    }
    private func filename(_ provider: NSItemProvider, type: String, fallback: String) -> String {
        let raw = ((provider.suggestedName ?? fallback) as NSString).lastPathComponent
        let name = raw.isEmpty || raw == "." || raw == ".." ? "Shared item" : raw
        return (name as NSString).pathExtension.isEmpty ? name + (UTType(type)?.preferredFilenameExtension.map { "." + $0 } ?? "") : name
    }
    private func clear(_ directory: URL) throws {
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: file) }
    }
    private static func isWriteFailure(_ error: Error) -> Bool {
        if error is ShareInbox.Failure { return (error as? ShareInbox.Failure).map { if case .unsafeFile = $0 { return true }; return false } ?? false }
        let value = error as NSError
        return value.domain == NSPOSIXErrorDomain || (value.domain == NSCocoaErrorDomain && (512...1023).contains(value.code))
    }
}
