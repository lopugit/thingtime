import ARKit
import CoreGraphics
import CoreVideo
import Foundation
import Metal
import simd

enum LiDARFrameWriter {
    enum BufferError: LocalizedError {
        case inaccessiblePixels
        case inaccessibleGeometry

        var errorDescription: String? {
            switch self {
            case .inaccessiblePixels: return "ARKit supplied a pixel buffer that could not be read."
            case .inaccessibleGeometry: return "ARKit supplied a mesh buffer that could not be read."
            }
        }
    }

    struct Plane: Encodable {
        let file: String
        let width: Int
        let height: Int
        let bytesPerRow: Int
    }

    struct Pixels: Encodable {
        let pixelFormat: UInt32
        let fourCC: String
        let width: Int
        let height: Int
        let planes: [Plane]
        let attachments: String?
    }

    struct Depth: Encodable {
        let depth: Pixels
        let confidence: Pixels?
        let pointCloud: String?
        let pointCloudStatus: String
    }

    struct Frame: Encodable {
        let index: Int
        let timestamp: TimeInterval
        let callbackUptime: TimeInterval
        let cameraToWorld: [Float]
        let intrinsics: [Float]
        let projectionMatrix: [Float]
        let eulerAngles: [Float]
        let imageWidth: Int
        let imageHeight: Int
        let exposureDuration: TimeInterval
        let exposureOffset: Float
        let tracking: String
        let worldMappingStatus: Int
        let cameraGrainIntensity: Float
        let camera: Pixels
        let sceneDepth: Depth?
        let smoothedSceneDepth: Depth?
        let featurePointCount: Int?
        let anchorIDs: [UUID]
        let exif: String?
        let light: String?
    }

    struct TimestampGap: Encodable {
        let previousTimestamp: TimeInterval
        let timestamp: TimeInterval
        let observedInterval: TimeInterval
        let nominalInterval: TimeInterval
    }

    struct Light: Encodable {
        let ambientIntensity: CGFloat
        let ambientColorTemperature: CGFloat
        let primaryLightDirection: [Float]?
        let primaryLightIntensity: CGFloat?
        let sphericalHarmonics: Data?
    }

    struct GeometrySource: Encodable {
        let file: String
        let count: Int
        let componentsPerVector: Int
        let stride: Int
        let originalBufferOffset: Int
        let bytes: Int
        let metalVertexFormat: UInt
    }

    struct Mesh: Encodable {
        let vertices: GeometrySource
        let normals: GeometrySource
        let classification: GeometrySource?
        let faces: String
        let faceCount: Int
        let bytesPerIndex: Int
        let indicesPerFace: Int
        let primitiveType: Int
    }

    struct Event: Encodable {
        let event: String
        let id: UUID
        let sessionID: UUID?
        let name: String?
        let anchorClass: String
        let anchorToWorld: [Float]
        let latestFrameTimestamp: TimeInterval?
        let callbackUptime: TimeInterval
        let mesh: Mesh?
    }

    static func write(frame: ARFrame, to store: LiDARCaptureStore, index: Int, callbackUptime: TimeInterval,
                      gap: TimestampGap?) throws {
        let path = "frames/\(index)"
        let camera = frame.camera
        let image = try pixels(frame.capturedImage, named: "camera", path: path, to: store)
        let scene = try frame.sceneDepth.map { try depth($0, named: "scene", camera: camera, path: path, to: store) }
        let smoothed = try frame.smoothedSceneDepth.map { try depth($0, named: "smoothed", camera: camera, path: path, to: store) }
        let featurePointCount = try frame.rawFeaturePoints.map { try featurePoints($0, path: path, to: store) }
        var exif: String?
        if !frame.exifData.isEmpty {
            exif = "camera-exif.plist"
            try store.data("\(path)/camera-exif.plist", plist(frame.exifData))
        }
        var lightFile: String?
        if let estimate = frame.lightEstimate {
            let directional = estimate as? ARDirectionalLightEstimate
            lightFile = "light.json"
            try store.json("\(path)/light.json", Light(
                ambientIntensity: estimate.ambientIntensity,
                ambientColorTemperature: estimate.ambientColorTemperature,
                primaryLightDirection: directional.map { vector($0.primaryLightDirection) },
                primaryLightIntensity: directional?.primaryLightIntensity,
                sphericalHarmonics: directional?.sphericalHarmonicsCoefficients))
        }
        if let gap { try store.json("\(path)/frame-gap.json", gap) }
        try store.json("\(path)/frame.json", Frame(
            index: index, timestamp: frame.timestamp, callbackUptime: callbackUptime,
            cameraToWorld: matrix(camera.transform), intrinsics: matrix(camera.intrinsics),
            projectionMatrix: matrix(camera.projectionMatrix), eulerAngles: vector(camera.eulerAngles),
            imageWidth: Int(camera.imageResolution.width), imageHeight: Int(camera.imageResolution.height),
            exposureDuration: camera.exposureDuration, exposureOffset: camera.exposureOffset,
            tracking: tracking(camera.trackingState), worldMappingStatus: frame.worldMappingStatus.rawValue,
            cameraGrainIntensity: frame.cameraGrainIntensity, camera: image, sceneDepth: scene,
            smoothedSceneDepth: smoothed, featurePointCount: featurePointCount,
            anchorIDs: frame.anchors.map(\.identifier), exif: exif, light: lightFile))
        store.commit()
    }

    static func write(anchor: ARAnchor, event: String, index: Int, frameTimestamp: TimeInterval?,
                      callbackUptime: TimeInterval, to store: LiDARCaptureStore) throws {
        let path = "events/\(index)"
        var geometry: Mesh?
        if let mesh = (anchor as? ARMeshAnchor)?.geometry {
            let vertices = try source(mesh.vertices, named: "mesh-vertices.bin", path: path, to: store)
            let normals = try source(mesh.normals, named: "mesh-normals.bin", path: path, to: store)
            let classification = try mesh.classification.map {
                try source($0, named: "mesh-classification.bin", path: path, to: store)
            }
            let faces = mesh.faces
            let indexCount = faces.count.multipliedReportingOverflow(by: faces.indexCountPerPrimitive)
            let faceBytes = indexCount.partialValue.multipliedReportingOverflow(by: faces.bytesPerIndex)
            guard !indexCount.overflow, !faceBytes.overflow, faceBytes.partialValue <= faces.buffer.length,
                  faces.buffer.storageMode != .private, faces.buffer.storageMode != .memoryless else {
                throw BufferError.inaccessibleGeometry
            }
            try store.bytes("\(path)/mesh-faces.bin", faces.buffer.contents(), count: faceBytes.partialValue)
            geometry = Mesh(vertices: vertices, normals: normals, classification: classification,
                            faces: "mesh-faces.bin", faceCount: faces.count,
                            bytesPerIndex: faces.bytesPerIndex, indicesPerFace: faces.indexCountPerPrimitive,
                            primitiveType: Int(faces.primitiveType.rawValue))
        }
        try store.json("\(path)/event.json", Event(
            event: event, id: anchor.identifier, sessionID: anchor.sessionIdentifier, name: anchor.name,
            anchorClass: String(describing: type(of: anchor)), anchorToWorld: matrix(anchor.transform),
            latestFrameTimestamp: frameTimestamp, callbackUptime: callbackUptime, mesh: geometry))
        store.commit()
    }

    static func tracking(_ state: ARCamera.TrackingState) -> String {
        switch state {
        case .notAvailable: return "notAvailable"
        case .normal: return "normal"
        case .limited(let reason):
            switch reason {
            case .initializing: return "limited.initializing"
            case .excessiveMotion: return "limited.excessiveMotion"
            case .insufficientFeatures: return "limited.insufficientFeatures"
            case .relocalizing: return "limited.relocalizing"
            @unknown default: return "limited.unknown"
            }
        }
    }

    private static func depth(_ input: ARDepthData, named name: String, camera: ARCamera,
                              path: String, to store: LiDARCaptureStore) throws -> Depth {
        let depth = try pixels(input.depthMap, named: "\(name)-depth", path: path, to: store)
        let confidence = try input.confidenceMap.map {
            try pixels($0, named: "\(name)-confidence", path: path, to: store)
        }
        let width = camera.imageResolution.width
        let height = camera.imageResolution.height
        let scaleX = Float(depth.width) / Float(width)
        let scaleY = Float(depth.height) / Float(height)
        let intrinsics = camera.intrinsics
        if let ply = try? LiDARPointCloud.make(
            depth: input.depthMap, confidence: input.confidenceMap,
            fx: intrinsics.columns.0.x * scaleX, fy: intrinsics.columns.1.y * scaleY,
            cx: intrinsics.columns.2.x * scaleX, cy: intrinsics.columns.2.y * scaleY,
            cameraToWorld: camera.transform
        ) {
            let file = "\(name)-points.ply"
            try store.data("\(path)/\(file)", ply)
            return Depth(depth: depth, confidence: confidence, pointCloud: file, pointCloudStatus: "available")
        }
        return Depth(depth: depth, confidence: confidence, pointCloud: nil,
                     pointCloudStatus: "Raw depth is retained; pixel format or calibration did not support PLY projection.")
    }

    private static func pixels(_ buffer: CVPixelBuffer, named name: String, path: String,
                               to store: LiDARCaptureStore) throws -> Pixels {
        guard CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else {
            throw BufferError.inaccessiblePixels
        }
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let planar = CVPixelBufferIsPlanar(buffer)
        var planes: [Plane] = []
        for plane in 0..<(planar ? CVPixelBufferGetPlaneCount(buffer) : 1) {
            let width = planar ? CVPixelBufferGetWidthOfPlane(buffer, plane) : CVPixelBufferGetWidth(buffer)
            let height = planar ? CVPixelBufferGetHeightOfPlane(buffer, plane) : CVPixelBufferGetHeight(buffer)
            let stride = planar ? CVPixelBufferGetBytesPerRowOfPlane(buffer, plane) : CVPixelBufferGetBytesPerRow(buffer)
            let address = planar ? CVPixelBufferGetBaseAddressOfPlane(buffer, plane) : CVPixelBufferGetBaseAddress(buffer)
            let bytes = stride.multipliedReportingOverflow(by: height)
            guard let address, !bytes.overflow else { throw BufferError.inaccessiblePixels }
            let file = "\(name)-plane-\(plane).bin"
            try store.bytes("\(path)/\(file)", address, count: bytes.partialValue)
            planes.append(Plane(file: file, width: width, height: height, bytesPerRow: stride))
        }
        var attachmentFile: String?
        let propagated = CVBufferCopyAttachments(buffer, .shouldPropagate) as? [String: Any] ?? [:]
        let local = CVBufferCopyAttachments(buffer, .shouldNotPropagate) as? [String: Any] ?? [:]
        if !propagated.isEmpty || !local.isEmpty {
            let file = "\(name)-attachments.plist"
            try store.data("\(path)/\(file)", plist(["propagated": propagated, "notPropagated": local]))
            attachmentFile = file
        }
        let format = CVPixelBufferGetPixelFormatType(buffer)
        let fourCC = String(decoding: [24, 16, 8, 0].map { UInt8(truncatingIfNeeded: format >> $0) }, as: UTF8.self)
        return Pixels(pixelFormat: format, fourCC: fourCC, width: CVPixelBufferGetWidth(buffer),
                      height: CVPixelBufferGetHeight(buffer), planes: planes, attachments: attachmentFile)
    }

    private static func plist(_ metadata: [String: Any]) throws -> Data {
        try PropertyListSerialization.data(fromPropertyList: plistValue(metadata), format: .binary, options: 0)
    }

    private static func plistValue(_ value: Any) -> Any {
        switch value {
        case let object as [String: Any]: return object.mapValues(plistValue)
        case let array as [Any]: return array.map(plistValue)
        case let colorSpace as CGColorSpace:
            var record: [String: Any] = ["coreVideoType": "CGColorSpace"]
            if let name = colorSpace.name { record["name"] = name as String }
            if let icc = colorSpace.copyICCData() { record["iccProfile"] = icc as Data }
            return record
        case is NSString, is NSNumber, is NSData, is NSDate: return value
        default: return ["unserializedMetadataType": String(describing: type(of: value))]
        }
    }

    private static func featurePoints(_ points: ARPointCloud, path: String, to store: LiDARCaptureStore) throws -> Int {
        let positions = points.points
        let identifiers = points.identifiers
        guard positions.count == identifiers.count else { throw BufferError.inaccessibleGeometry }
        var bytes = Data(capacity: positions.count * 20)
        for index in positions.indices {
            let p = positions[index]
            for coordinate in [p.x, p.y, p.z] {
                var bits = coordinate.bitPattern.littleEndian
                withUnsafeBytes(of: &bits) { bytes.append(contentsOf: $0) }
            }
            var identifier = identifiers[index].littleEndian
            withUnsafeBytes(of: &identifier) { bytes.append(contentsOf: $0) }
        }
        try store.data("\(path)/feature-points.bin", bytes)
        return positions.count
    }

    private static func source(_ source: ARGeometrySource, named name: String, path: String,
                               to store: LiDARCaptureStore) throws -> GeometrySource {
        let wanted = source.count.multipliedReportingOverflow(by: source.stride)
        guard !wanted.overflow, source.offset >= 0, source.offset <= source.buffer.length,
              source.buffer.storageMode != .private, source.buffer.storageMode != .memoryless else {
            throw BufferError.inaccessibleGeometry
        }
        let count = min(wanted.partialValue, source.buffer.length - source.offset)
        guard source.count == 0 || count > (source.count - 1) * source.stride else {
            throw BufferError.inaccessibleGeometry
        }
        try store.bytes("\(path)/\(name)", source.buffer.contents().advanced(by: source.offset), count: count)
        return GeometrySource(file: name, count: source.count, componentsPerVector: source.componentsPerVector,
                              stride: source.stride, originalBufferOffset: source.offset, bytes: count,
                              metalVertexFormat: source.format.rawValue)
    }

    private static func vector(_ value: SIMD3<Float>) -> [Float] { [value.x, value.y, value.z] }

    private static func matrix(_ value: simd_float3x3) -> [Float] {
        [value.columns.0, value.columns.1, value.columns.2].flatMap(vector)
    }

    private static func matrix(_ value: simd_float4x4) -> [Float] {
        [value.columns.0, value.columns.1, value.columns.2, value.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
    }
}
