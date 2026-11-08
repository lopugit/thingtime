import CoreGraphics
import CoreVideo
import Foundation
import simd
import XCTest
@testable import Thingtime

final class LiDARCaptureTests: XCTestCase {
    func testArchiveRetainsExactBytesAndFinalizesOnce() throws {
        let (directory, header) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
        let store = try LiDARCaptureStore(header: header, directory: directory)
        XCTAssertNil(try LiDARCaptureStore.recover(id: header.captureID, directory: directory))
        let pixels = Data([0, 255, 15, 101, 32, 2, 2, 2])
        try store.data("frames/0/camera-plane-0.bin", pixels)
        try store.data("frames/0/scene-depth-plane-0.bin", Data([0, 0, 128, 63]))
        try store.json("frames/0/frame.json", ["index": 0])
        store.commit()

        let result = try store.finalize(detail: nil, worldMapStatus: "unavailable")
        XCTAssertEqual(result.frameCount, 1)
        XCTAssertFalse(result.isPartial)
        let archive = try Data(contentsOf: result.archiveURL)
        let entries = try tarEntries(result.archiveURL)
        XCTAssertEqual(entries["frames/0/camera-plane-0.bin"], pixels)
        let manifest = try decodeManifest(entries)
        XCTAssertEqual(manifest.outputs.rawCamera, 1)
        XCTAssertEqual(manifest.outputs.sceneDepth, 1)
        XCTAssertEqual(manifest.outputs.smoothedDepth, 0)
        XCTAssertEqual(manifest.worldMapStatus, "unavailable")
        XCTAssertEqual(try LiDARCaptureStore.readSealedCapture(id: header.captureID, directory: directory), result)
        XCTAssertNil(try LiDARCaptureStore.readSealedCapture(id: UUID(), directory: directory))

        // Recover without its sidecar and prove finalized bytes stay stable
        // for the uploader's immutable content identity.
        try FileManager.default.removeItem(at: directory.appendingPathComponent("capture-receipt.json"))
        let recovered = try XCTUnwrap(LiDARCaptureStore.recover(id: header.captureID, directory: directory))
        XCTAssertEqual(recovered.frameCount, 1)
        XCTAssertEqual(recovered.byteCount, Int64(archive.count))
        XCTAssertEqual(try Data(contentsOf: result.archiveURL), archive)
    }

    func testInterruptedArchiveKeepsCommittedRecordsAndRemovesTrailingFrame() throws {
        let (directory, header) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
        var store: LiDARCaptureStore? = try LiDARCaptureStore(header: header, directory: directory)
        let archiveURL = try XCTUnwrap(store?.archiveURL)
        try store?.data("frames/0/scene-depth-plane-0.bin", Data([0, 0, 128, 63]))
        try store?.json("frames/0/frame.json", ["index": 0])
        store?.commit()
        try store?.json("events/0/event.json", ["event": "added"])
        store?.commit()
        try store?.data("frames/1/scene-depth-plane-0.bin", Data([0, 0, 0, 64]))
        store = nil
        // Simulate termination inside a subsequent tar block.
        let writer = try FileHandle(forWritingTo: archiveURL)
        try writer.seekToEnd()
        try writer.write(contentsOf: Data(repeating: 127, count: 300))
        try writer.close()
        XCTAssertNil(try LiDARCaptureStore.readSealedCapture(id: header.captureID, directory: directory))

        let result = try XCTUnwrap(LiDARCaptureStore.recover(id: header.captureID, directory: directory))
        XCTAssertTrue(result.isPartial)
        XCTAssertEqual(result.frameCount, 1)
        let entries = try tarEntries(archiveURL)
        XCTAssertNotNil(entries["frames/0/scene-depth-plane-0.bin"])
        XCTAssertNotNil(entries["events/0/event.json"])
        XCTAssertNil(entries["frames/1/scene-depth-plane-0.bin"])
        let manifest = try decodeManifest(entries)
        XCTAssertEqual(manifest.outputs.sceneDepth, 1)
        XCTAssertEqual(manifest.outputs.anchorEvents, 1)
        XCTAssertEqual(manifest.worldMapStatus, "interrupted")
    }

    func testDiscardRemainsUnrecoverableWhenOriginalCannotBeDeleted() throws {
        let (directory, header) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
        var store: LiDARCaptureStore? = try LiDARCaptureStore(header: header, directory: directory)
        let archive = try XCTUnwrap(store?.archiveURL)
        try store?.data("frames/0/scene-depth-plane-0.bin", Data([0, 0, 128, 63]))
        try store?.json("frames/0/frame.json", ["index": 0])
        store?.commit()

        XCTAssertThrowsError(try store?.discard(uploadDisabled: false, removeArchive: { _ in
            throw CocoaError(.fileWriteNoPermission)
        })) { error in
            XCTAssertEqual((error as? LiDARCaptureStore.DiscardFailure)?.uploadDisabled, true)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: archive.path))
        store = nil

        XCTAssertTrue(try LiDARCaptureStore.isDiscarded(id: header.captureID, directory: directory))
        XCTAssertNil(try LiDARCaptureStore.recover(id: header.captureID, directory: directory))
        XCTAssertNil(try LiDARCaptureStore.readSealedCapture(id: header.captureID, directory: directory))
    }

    func testCameraBufferArchivesMixedColorAttachments() throws {
        let (directory, header) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory.deletingLastPathComponent()) }
        let store = try LiDARCaptureStore(header: header, directory: directory)
        let image = try buffer(format: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange)
        let colorSpace = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        CVBufferSetAttachment(image, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(image, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(image, kCVImageBufferCGColorSpaceKey, colorSpace, .shouldPropagate)
        CVBufferSetAttachment(image, kCVImageBufferGammaLevelKey, NSNumber(value: 2.2), .shouldPropagate)
        // An unsupported CF type should be described, not cast as a color space.
        CVBufferSetAttachment(image, "FixtureOtherColorValue" as CFString, CGColor(gray: 0, alpha: 1), .shouldNotPropagate)

        let pixels = try LiDARFrameWriter.pixels(image, named: "camera", path: "frames/0", to: store)
        XCTAssertEqual(pixels.planes.count, 2)
        let filename = try XCTUnwrap(pixels.attachments)
        try store.json("frames/0/frame.json", ["index": 0])
        store.commit()
        let capture = try store.finalize(detail: nil, worldMapStatus: "unavailable")
        let entries = try tarEntries(capture.archiveURL)
        let bytes = try XCTUnwrap(entries["frames/0/\(filename)"])
        let metadata = try XCTUnwrap(PropertyListSerialization.propertyList(from: bytes, format: nil) as? [String: Any])
        let propagated = try XCTUnwrap(metadata["propagated"] as? [String: Any])
        XCTAssertEqual(propagated[kCVImageBufferYCbCrMatrixKey as String] as? String, kCVImageBufferYCbCrMatrix_ITU_R_709_2 as String)
        XCTAssertEqual(propagated[kCVImageBufferColorPrimariesKey as String] as? String, kCVImageBufferColorPrimaries_ITU_R_709_2 as String)
        XCTAssertEqual(propagated[kCVImageBufferGammaLevelKey as String] as? Double, 2.2)
        let archivedSpace = try XCTUnwrap(propagated[kCVImageBufferCGColorSpaceKey as String] as? [String: Any])
        XCTAssertEqual(archivedSpace["name"] as? String, colorSpace.name as String?)
        let profile = try XCTUnwrap(colorSpace.copyICCData())
        XCTAssertEqual(archivedSpace["iccProfile"] as? Data, profile as Data)
        let local = try XCTUnwrap(metadata["notPropagated"] as? [String: Any])
        let unknown = try XCTUnwrap(local["FixtureOtherColorValue"] as? [String: String])
        XCTAssertNotNil(unknown["unserializedMetadataType"])
    }

    func testDensePLYProjectsValidSamplesAndRetainsConfidence() throws {
        let depth = try buffer(format: kCVPixelFormatType_DepthFloat32)
        let confidence = try buffer(format: kCVPixelFormatType_OneComponent8)
        try write([Float(2), .nan, 0, 1], into: depth)
        try write([UInt8(2), 0, 1, 1], into: confidence)

        var transform = matrix_identity_float4x4
        transform.columns.3 = SIMD4(1, 2, 3, 1)
        let ply = try XCTUnwrap(LiDARPointCloud.make(depth: depth, confidence: confidence,
                                                    fx: 2, fy: 2, cx: 0, cy: 0, cameraToWorld: transform))
        let headerEnd = try XCTUnwrap(ply.range(of: Data("end_header\n".utf8))).upperBound
        let header = String(decoding: ply[..<headerEnd], as: UTF8.self)
        XCTAssertTrue(header.contains("element vertex 2\n"))
        XCTAssertTrue(header.contains("property uchar confidence\n"))
        let points = Data(ply[headerEnd...])
        XCTAssertEqual(points.count, 26)
        let expected: [(Int, Float)] = [(0, 1), (4, 2), (8, 1), (13, 1.5), (17, 1.5), (21, 2)]
        points.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            for (offset, coordinate) in expected {
                let bits = bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self)
                XCTAssertEqual(Float(bitPattern: UInt32(littleEndian: bits)), coordinate, accuracy: 0.0001)
            }
        }
        XCTAssertEqual(points[12], 2)
        XCTAssertEqual(points[25], 1)
    }

    private func fixture() throws -> (URL, LiDARCaptureStore.Header) {
        let id = UUID()
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("LiDARCaptureTests-\(id.uuidString)", isDirectory: true)
            .appendingPathComponent("scan", isDirectory: true)
        let header = LiDARCaptureStore.Header(
            captureID: id, startedAt: Date(), nominalFramesPerSecond: 60, videoWidth: 1920, videoHeight: 1080,
            sceneDepthEnabled: true, smoothedSceneDepthEnabled: true, meshReconstruction: "meshWithClassification",
            systemVersion: "fixture")
        return (directory, header)
    }

    private func tarEntries(_ url: URL) throws -> [String: Data] {
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        let length = try file.seekToEnd()
        var offset: UInt64 = 0
        var entries: [String: Data] = [:]
        while let entry = try LiDARTarArchive.nextEntry(in: file, offset: offset, length: length) {
            try file.seek(toOffset: entry.dataOffset)
            entries[entry.path] = try file.read(upToCount: Int(entry.size))
            offset = entry.nextOffset
        }
        XCTAssertTrue(try LiDARTarArchive.hasEndMarker(in: file, offset: offset, length: length))
        return entries
    }

    private func decodeManifest(_ entries: [String: Data]) throws -> LiDARCaptureStore.Manifest {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(LiDARCaptureStore.Manifest.self, from: XCTUnwrap(entries["manifest.json"]))
    }

    private func buffer(format: OSType) throws -> CVPixelBuffer {
        var result: CVPixelBuffer?
        XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, 2, 2, format, nil, &result), kCVReturnSuccess)
        return try XCTUnwrap(result)
    }

    private func write<T>(_ values: [T], into buffer: CVPixelBuffer) throws {
        XCTAssertEqual(CVPixelBufferLockBaseAddress(buffer, []), kCVReturnSuccess)
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        let address = try XCTUnwrap(CVPixelBufferGetBaseAddress(buffer))
        for y in 0..<2 {
            let row = address.advanced(by: y * CVPixelBufferGetBytesPerRow(buffer)).assumingMemoryBound(to: T.self)
            for x in 0..<2 { row[x] = values[y * 2 + x] }
        }
    }
}
