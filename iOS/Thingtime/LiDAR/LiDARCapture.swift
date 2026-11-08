import Darwin
import Foundation

struct LiDARCapture: Codable, Sendable, Equatable {
    static let manifestVersion = 1
    let id: UUID
    let archiveURL: URL
    let startedAt: Date
    let finishedAt: Date
    let frameCount: Int
    let byteCount: Int64
    let isPartial: Bool
    let statusDetail: String?
    var manifestVersion: Int { Self.manifestVersion }

    /// Call only for a capture ID reserved by the signed-in account's outbox.
    /// No scan discovery or account reassignment is performed here.
    static func recover(id: UUID) throws -> Self? {
        try LiDARCaptureStore.recover(id: id)
    }
}

/// Disk format state; shared by the AR session, interrupted-capture recovery
/// and the format tests. No frame is held after its delegate callback returns.
final class LiDARCaptureStore {
    struct Header: Codable {
        var format = "thingtime.lidar.capture"
        var version = LiDARCapture.manifestVersion
        let captureID: UUID
        let startedAt: Date
        let nominalFramesPerSecond: Int
        let videoWidth: Int
        let videoHeight: Int
        let sceneDepthEnabled: Bool
        let smoothedSceneDepthEnabled: Bool
        let meshReconstruction: String
        let systemVersion: String
    }

    struct Counts: Codable, Equatable {
        var frames = 0
        var rawCamera = 0
        var cameraAttachments = 0
        var sceneDepth = 0
        var sceneConfidence = 0
        var smoothedDepth = 0
        var smoothedConfidence = 0
        var rawFeaturePoints = 0
        var pointCloud = 0
        var smoothedPointCloud = 0
        var exif = 0
        var lightEstimates = 0
        var anchorEvents = 0
        var meshes = 0
        var meshClassifications = 0
        var worldMap = 0
        var timestampGaps = 0

        mutating func observe(path: String) {
            switch path.split(separator: "/").last {
            case "frame.json": frames += 1
            case "camera-plane-0.bin": rawCamera += 1
            case "camera-attachments.plist": cameraAttachments += 1
            case "scene-depth-plane-0.bin": sceneDepth += 1
            case "scene-confidence-plane-0.bin": sceneConfidence += 1
            case "smoothed-depth-plane-0.bin": smoothedDepth += 1
            case "smoothed-confidence-plane-0.bin": smoothedConfidence += 1
            case "feature-points.bin": rawFeaturePoints += 1
            case "scene-points.ply": pointCloud += 1
            case "smoothed-points.ply": smoothedPointCloud += 1
            case "camera-exif.plist": exif += 1
            case "light.json": lightEstimates += 1
            case "event.json": anchorEvents += 1
            case "mesh-faces.bin": meshes += 1
            case "mesh-classification.bin": meshClassifications += 1
            case "world-map.arexperience": worldMap += 1
            case "frame-gap.json": timestampGaps += 1
            default: break
            }
        }

        mutating func add(_ other: Self) {
            frames += other.frames
            rawCamera += other.rawCamera
            cameraAttachments += other.cameraAttachments
            sceneDepth += other.sceneDepth
            sceneConfidence += other.sceneConfidence
            smoothedDepth += other.smoothedDepth
            smoothedConfidence += other.smoothedConfidence
            rawFeaturePoints += other.rawFeaturePoints
            pointCloud += other.pointCloud
            smoothedPointCloud += other.smoothedPointCloud
            exif += other.exif
            lightEstimates += other.lightEstimates
            anchorEvents += other.anchorEvents
            meshes += other.meshes
            meshClassifications += other.meshClassifications
            worldMap += other.worldMap
            timestampGaps += other.timestampGaps
        }
    }

    struct Manifest: Codable {
        let capture: Header
        let finishedAt: Date
        let status: String
        let statusDetail: String?
        let worldMapStatus: String
        let outputs: Counts
        let coordinateSystem: String
        let cameraCalibration: String
        let timebase: String
        let pixelLayout: String
        let featurePointLayout: String
        let pointCloudLayout: String
        let meshLayout: String
        let exclusions: [String]

        init(capture: Header, finishedAt: Date, statusDetail: String?, worldMapStatus: String, outputs: Counts) {
            self.capture = capture
            self.finishedAt = finishedAt
            self.status = statusDetail == nil ? "complete" : "partial"
            self.statusDetail = statusDetail
            self.worldMapStatus = worldMapStatus
            self.outputs = outputs
            coordinateSystem = "ARKit right-handed gravity-aligned world, meters; camera local +X right, +Y up, -Z forward. Mesh vertices and normals are anchor-local."
            cameraCalibration = "Matrices are flattened column-major. Intrinsics are for the native, unrotated camera buffer. Scale fx/cx by depthWidth/imageWidth, fy/cy by depthHeight/imageHeight. For depth (u,v,d), camera point is ((u-cx)*d/fx, -(v-cy)*d/fy, -d); apply cameraToWorld for world coordinates."
            timebase = "Frame timestamps are ARFrame.timestamp in seconds on ARKit's monotonic clock. Capture start/finish are UTC wall clock. Callback uptime on anchor events is a separate monotonic observation."
            pixelLayout = "Uncompressed native Core Video planes, with exact dimensions, byte stride, numeric pixel format and FourCC. Depth values are distance in meters from the camera plane. Confidence uses ARConfidenceLevel values: 0 low, 1 medium, 2 high. Optional metadata uses binary plists."
            featurePointLayout = "Each little-endian record is three float32 world coordinates followed by one uint64 ARKit feature ID (20 bytes)."
            pointCloudLayout = "Per-frame binary little-endian PLY in ARKit world space. Every finite positive depth sample becomes one vertex in row-major pixel order; invalid values remain in the original depth buffer. Confidence is present when the matching map is readable. Camera color is retained separately in its original planes."
            meshLayout = "Geometry entries use Metal vertex format codes, stride and count. Face indices retain the native width and primitive size. Anchor transforms map local mesh geometry into the same world space."
            exclusions = [
                "Public ARKit does not expose raw LiDAR pulses, photon returns or proprietary sensor calibration.",
                "Camera grain texture is synthesized for compositing, rather than a sensor measurement; only its intensity is recorded.",
                "Front-camera TrueDepth, person segmentation and other non-LiDAR session semantics are outside rear LiDAR capture."
            ]
        }
    }

    private struct Receipt: Codable {
        let capture: LiDARCapture
        let manifestOffset: UInt64
    }

    struct DiscardFailure: Error {
        let uploadDisabled: Bool
    }

    private static let registry = NSLock()
    private static var activeIDs: Set<UUID> = []
    private static var failedDiscardIDs: Set<UUID> = []
    private static let archiveName = "scan.tar"
    private static let reserveName = "finalization.reserve"
    private static let discardName = ".discarded"
    private static let receiptName = "capture-receipt.json"
    let header: Header
    let archiveURL: URL
    private let folder: URL
    private let archive: LiDARTarArchive
    private let encoder = LiDARCaptureStore.encoder()
    private(set) var counts = Counts()
    private var pendingCounts = Counts()
    private var released = false

    var byteCount: Int64 { Int64(archive.committedOffset) }

    init(header: Header, directory: URL? = nil) throws {
        self.header = header
        folder = try directory ?? Self.directory(id: header.captureID)
        archiveURL = folder.appendingPathComponent(Self.archiveName)
        guard Self.claim(header.captureID) else { throw LiDARTarArchive.ArchiveError.alreadyRecording }
        var created = false
        do {
            // Creating the leaf without intermediates refuses to overwrite an
            // existing capture, even if its outbox has reused the same ID.
            try FileManager.default.createDirectory(at: folder.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false,
                                                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            created = true
            var protectedFolder = folder
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try protectedFolder.setResourceValues(values)
            // This is real disk space that is released before writing the
            // final manifest, including when recording filled the volume.
            try Data(repeating: 0xA7, count: 256 * 1024)
                .write(to: folder.appendingPathComponent(Self.reserveName), options: [.completeFileProtectionUntilFirstUserAuthentication])
            guard FileManager.default.createFile(atPath: archiveURL.path, contents: nil,
                  attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else {
                throw LiDARTarArchive.ArchiveError.noWritableArchive
            }
            archive = try LiDARTarArchive(url: archiveURL, date: header.startedAt)
            try archive.entry("capture.json", data: encoder.encode(header))
            archive.commit()
            try archive.synchronize()
        } catch {
            if created { try? FileManager.default.removeItem(at: folder) }
            Self.release(header.captureID)
            throw error
        }
    }

    deinit {
        if !released { Self.release(header.captureID) }
    }

    func json<T: Encodable>(_ path: String, _ value: T) throws {
        try data(path, encoder.encode(value))
    }

    func data(_ path: String, _ value: Data) throws {
        try archive.entry(path, data: value)
        pendingCounts.observe(path: path)
    }

    func bytes(_ path: String, _ bytes: UnsafeRawPointer, count: Int) throws {
        try archive.entry(path, bytes: bytes, count: count)
        pendingCounts.observe(path: path)
    }

    /// Called only after the enclosing frame or anchor event's JSON marker
    /// was written. Partial trailing records can then be removed after a crash.
    func commit() {
        archive.commit()
        counts.add(pendingCounts)
        pendingCounts = Counts()
    }

    func synchronize() throws { try archive.synchronize() }

    func finalize(detail: String?, worldMapStatus: String) throws -> LiDARCapture {
        try Self.releaseReserve(at: folder)
        try archive.rollback()
        let manifest = Self.manifest(header: header, counts: counts, detail: detail, worldMapStatus: worldMapStatus)
        let manifestOffset = archive.offset
        try archive.entry("manifest.json", data: encoder.encode(manifest))
        try archive.finish()
        let capture = Self.capture(from: manifest, url: archiveURL, length: archive.offset)
        // The fully terminated archive is authoritative. If the optional
        // receipt write fails, recovery can rebuild it without changing bytes.
        try? Self.writeReceipt(capture, manifestOffset: manifestOffset, at: folder)
        release()
        return capture
    }

    /// Tombstone first. If unlink is refused, a later account retry must
    /// never turn an explicitly discarded scan into a recovered upload.
    func discard(uploadDisabled: Bool, removeArchive: (URL) throws -> Void = { try FileManager.default.removeItem(at: $0) }) throws {
        try Self.discard(id: header.captureID, folder: folder, uploadDisabled: uploadDisabled,
                         removeArchive: removeArchive, erase: archive.erase)
        release()
    }

    static func discardClosed(id: UUID, uploadDisabled: Bool) throws {
        let folder = try directory(id: id)
        let archiveURL = folder.appendingPathComponent(archiveName)
        try discard(id: id, folder: folder, uploadDisabled: uploadDisabled,
                    removeArchive: { try FileManager.default.removeItem(at: $0) }, erase: {
            let file = try FileHandle(forWritingTo: archiveURL)
            defer { try? file.close() }
            try file.truncate(atOffset: 0)
            try file.synchronize()
        })
    }

    private static func discard(id: UUID, folder: URL, uploadDisabled: Bool,
                                removeArchive: (URL) throws -> Void, erase: () throws -> Void) throws {
        let archiveURL = folder.appendingPathComponent(archiveName)
        var disabled = uploadDisabled
        if (try? markDiscarded(at: folder)) != nil { disabled = true }
        do {
            try removeArchive(archiveURL)
        } catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {
            // A previous attempt already removed the original.
        } catch {
            if !disabled, (try? erase()) != nil {
                // An empty canonical file cannot be interpreted as a capture.
                // Best-effort cleanup must not turn a successful erase into an upload.
                try? FileManager.default.removeItem(at: folder)
                return
            }
            if !disabled { markDiscardFailed(id) }
            throw DiscardFailure(uploadDisabled: disabled)
        }
        try? FileManager.default.removeItem(at: folder.appendingPathComponent(receiptName))
        if disabled {
            // Keep the marker, not the reserve's allocated data blocks.
            if let marker = try? FileHandle(forWritingTo: folder.appendingPathComponent(discardName)) {
                try? marker.truncate(atOffset: 0)
                try? marker.close()
            }
        } else {
            try? FileManager.default.removeItem(at: folder)
        }
    }

    private static func markDiscarded(at folder: URL) throws {
        let marker = folder.appendingPathComponent(discardName)
        if try hasDiscardMarker(at: folder) { return }
        let reserve = folder.appendingPathComponent(reserveName)
        // The recording already owns this file. A same-directory rename
        // requires no allocation for a second data file on a full disk.
        if rename(reserve.path, marker.path) == 0 { return }
        try Data().write(to: marker, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func isDiscarded(id: UUID, directory: URL) throws -> Bool {
        registry.lock()
        let failedDiscard = failedDiscardIDs.contains(id)
        registry.unlock()
        if failedDiscard { return true }
        return try hasDiscardMarker(at: directory)
    }

    private static func hasDiscardMarker(at folder: URL) throws -> Bool {
        do {
            _ = try FileManager.default.attributesOfItem(atPath: folder.appendingPathComponent(discardName).path)
            return true
        } catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {
            return false
        }
    }

    private static func markDiscardFailed(_ id: UUID) {
        registry.lock()
        defer { registry.unlock() }
        failedDiscardIDs.insert(id)
    }

    private func release() {
        guard !released else { return }
        released = true
        Self.release(header.captureID)
    }

    /// Validate a finished archive without repairing or mutating it. The
    /// receipt points to the final manifest, and the TAR itself proves both
    /// that manifest and the original capture ID. A missing receipt can be
    /// reconstructed from the archive separately by the owner-scoped outbox.
    static func readSealedCapture(id: UUID, directory: URL) throws -> LiDARCapture? {
        guard claim(id) else { return nil }
        defer { release(id) }
        guard try !isDiscarded(id: id, directory: directory) else { return nil }
        let archiveURL = directory.appendingPathComponent(archiveName)
        guard FileManager.default.fileExists(atPath: archiveURL.path) else { return nil }
        let file = try FileHandle(forReadingFrom: archiveURL)
        defer { try? file.close() }
        let length = try file.seekToEnd()
        let decoder = decoder()
        guard let (first, _) = try readHeader(id: id, file: file, length: length, decoder: decoder) else { return nil }
        if let fast = try readReceipt(id: id, directory: directory, archiveURL: archiveURL,
                                      file: file, length: length, decoder: decoder) {
            return fast
        }
        var offset = first.nextOffset
        while let entry = try LiDARTarArchive.nextEntry(in: file, offset: offset, length: length) {
            if let sealed = try readManifest(id: id, archiveURL: archiveURL, file: file,
                                             length: length, entry: entry, decoder: decoder) {
                return sealed
            }
            offset = entry.nextOffset
        }
        return nil
    }

    static func recover(id: UUID, directory: URL? = nil) throws -> LiDARCapture? {
        guard claim(id) else { return nil }
        defer { release(id) }
        let folder = try directory ?? Self.directory(id: id)
        guard try !isDiscarded(id: id, directory: folder) else { return nil }
        let archiveURL = folder.appendingPathComponent(archiveName)
        guard FileManager.default.fileExists(atPath: archiveURL.path) else { return nil }
        let file = try FileHandle(forReadingFrom: archiveURL)
        defer { try? file.close() }
        let length = try file.seekToEnd()
        let decoder = decoder()
        guard let (first, header) = try readHeader(id: id, file: file, length: length, decoder: decoder) else {
            throw LiDARTarArchive.ArchiveError.missingCaptureHeader
        }
        if let fast = try readReceipt(id: id, directory: folder, archiveURL: archiveURL,
                                      file: file, length: length, decoder: decoder) {
            return fast
        }

        var counts = Counts()
        var pending = Counts()
        var offset = first.nextOffset
        var checkpoint = offset
        while let entry = try LiDARTarArchive.nextEntry(in: file, offset: offset, length: length) {
            let entryOffset = offset
            offset = entry.nextOffset
            if entry.path == "manifest.json" {
                if let sealed = try readManifest(id: id, archiveURL: archiveURL, file: file,
                                                 length: length, entry: entry, decoder: decoder) {
                    try? writeReceipt(sealed, manifestOffset: entryOffset, at: folder)
                    return sealed
                }
                break
            }
            pending.observe(path: entry.path)
            if entry.path.hasSuffix("/frame.json") || entry.path.hasSuffix("/event.json")
                || entry.path == "world-map.arexperience" {
                counts.add(pending)
                pending = Counts()
                checkpoint = offset
            }
        }
        try releaseReserve(at: folder)
        let writer = try LiDARTarArchive(url: archiveURL, date: header.startedAt, offset: checkpoint)
        let recovered = manifest(header: header, counts: counts,
                                 detail: "Recording was interrupted. The scan contains the data saved before the interruption.",
                                 worldMapStatus: counts.worldMap > 0 ? "available" : "interrupted")
        try writer.entry("manifest.json", data: encoder().encode(recovered))
        try writer.finish()
        let capture = capture(from: recovered, url: archiveURL, length: writer.offset)
        try? writeReceipt(capture, manifestOffset: checkpoint, at: folder)
        return capture
    }

    private static func readHeader(id: UUID, file: FileHandle, length: UInt64, decoder: JSONDecoder) throws -> (LiDARTarArchive.Entry, Header)? {
        guard let first = try LiDARTarArchive.nextEntry(in: file, offset: 0, length: length), first.path == "capture.json",
              let header = try readJSON(Header.self, from: file, entry: first, decoder: decoder),
              header.captureID == id, header.format == "thingtime.lidar.capture",
              header.version == LiDARCapture.manifestVersion else { return nil }
        return (first, header)
    }

    private static func readReceipt(id: UUID, directory: URL, archiveURL: URL, file: FileHandle,
                                    length: UInt64, decoder: JSONDecoder) throws -> LiDARCapture? {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent(receiptName)),
              let receipt = try? decoder.decode(Receipt.self, from: data),
              receipt.capture.id == id, receipt.capture.byteCount == Int64(length),
              let entry = try LiDARTarArchive.nextEntry(in: file, offset: receipt.manifestOffset, length: length) else { return nil }
        return try readManifest(id: id, archiveURL: archiveURL, file: file, length: length, entry: entry, decoder: decoder)
    }

    private static func readManifest(id: UUID, archiveURL: URL, file: FileHandle, length: UInt64,
                                     entry: LiDARTarArchive.Entry, decoder: JSONDecoder) throws -> LiDARCapture? {
        guard entry.path == "manifest.json",
              let existing = try readJSON(Manifest.self, from: file, entry: entry, decoder: decoder),
              existing.capture.captureID == id, existing.capture.format == "thingtime.lidar.capture",
              existing.capture.version == LiDARCapture.manifestVersion,
              try LiDARTarArchive.hasEndMarker(in: file, offset: entry.nextOffset, length: length) else { return nil }
        return capture(from: existing, url: archiveURL, length: length)
    }

    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private static func readJSON<T: Decodable>(_ type: T.Type, from file: FileHandle, entry: LiDARTarArchive.Entry, decoder: JSONDecoder) throws -> T? {
        // Only fixed-schema control records are decoded during recovery;
        // none of the user's raw payloads are read into memory.
        guard entry.size <= 1_048_576 else { return nil }
        try file.seek(toOffset: entry.dataOffset)
        guard let data = try file.read(upToCount: Int(entry.size)), data.count == entry.size else { return nil }
        return try? decoder.decode(type, from: data)
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

    private static func manifest(header: Header, counts: Counts, detail: String?, worldMapStatus: String) -> Manifest {
        let finalDetail = detail
            ?? (counts.frames == 0 ? "ARKit did not deliver any frames before recording stopped." : nil)
            ?? (counts.sceneDepth == 0 ? "ARKit did not deliver any scene depth for this scan." : nil)
            ?? (counts.timestampGaps > 0 ? "ARKit frame timestamps show possible gaps. See frame-gap.json records for their durations." : nil)
        return Manifest(capture: header, finishedAt: Date(), statusDetail: finalDetail,
                        worldMapStatus: worldMapStatus, outputs: counts)
    }

    private static func capture(from manifest: Manifest, url: URL, length: UInt64) -> LiDARCapture {
        // Match the ISO-8601 UTC seconds serialized to the archive and sidecar,
        // so recovery has the same metadata as the original save.
        func archiveTime(_ date: Date) -> Date {
            Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down))
        }
        return LiDARCapture(id: manifest.capture.captureID, archiveURL: url, startedAt: archiveTime(manifest.capture.startedAt),
                     finishedAt: archiveTime(manifest.finishedAt), frameCount: manifest.outputs.frames, byteCount: Int64(length),
                     isPartial: manifest.status == "partial", statusDetail: manifest.statusDetail)
    }

    private static func directory(id: UUID) throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true)
            .appendingPathComponent("Thingtime/LiDAR", isDirectory: true)
            .appendingPathComponent(id.uuidString.lowercased(), isDirectory: true)
    }

    private static func writeReceipt(_ capture: LiDARCapture, manifestOffset: UInt64, at folder: URL) throws {
        try encoder().encode(Receipt(capture: capture, manifestOffset: manifestOffset))
            .write(to: folder.appendingPathComponent(receiptName),
                   options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static func releaseReserve(at folder: URL) throws {
        let reserve = folder.appendingPathComponent(reserveName)
        if FileManager.default.fileExists(atPath: reserve.path) {
            try FileManager.default.removeItem(at: reserve)
        }
    }

    private static func claim(_ id: UUID) -> Bool {
        registry.lock()
        defer { registry.unlock() }
        return activeIDs.insert(id).inserted
    }

    private static func release(_ id: UUID) {
        registry.lock()
        defer { registry.unlock() }
        activeIDs.remove(id)
    }
}
