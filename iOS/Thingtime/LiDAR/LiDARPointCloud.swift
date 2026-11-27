import CoreVideo
import Foundation
import simd

/// The dense export is derived independently of the retained depth bytes.
/// Its allocation is bounded to one depth image, regardless of scan length.
enum LiDARPointCloud {
    static func make(depth: CVPixelBuffer, confidence: CVPixelBuffer?, fx: Float, fy: Float,
                     cx: Float, cy: Float, cameraToWorld: simd_float4x4) throws -> Data? {
        let format = CVPixelBufferGetPixelFormatType(depth)
        guard format == kCVPixelFormatType_DepthFloat32 || format == kCVPixelFormatType_OneComponent32Float,
              fx.isFinite, fx > 0, fy.isFinite, fy > 0, cx.isFinite, cy.isFinite else { return nil }

        guard CVPixelBufferLockBaseAddress(depth, .readOnly) == kCVReturnSuccess else {
            throw LiDARFrameWriter.BufferError.inaccessiblePixels
        }
        defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(depth) else {
            throw LiDARFrameWriter.BufferError.inaccessiblePixels
        }
        let width = CVPixelBufferGetWidth(depth)
        let height = CVPixelBufferGetHeight(depth)
        let row = CVPixelBufferGetBytesPerRow(depth)
        guard row >= width * MemoryLayout<Float>.size else {
            throw LiDARFrameWriter.BufferError.inaccessiblePixels
        }

        var confidenceLocked = false
        defer {
            if let confidence, confidenceLocked { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
        }
        var confidenceBase: UnsafeMutableRawPointer?
        var confidenceRow = 0
        if let confidence, CVPixelBufferGetWidth(confidence) == width,
           CVPixelBufferGetHeight(confidence) == height,
           CVPixelBufferGetPixelFormatType(confidence) == kCVPixelFormatType_OneComponent8 {
            guard CVPixelBufferLockBaseAddress(confidence, .readOnly) == kCVReturnSuccess else {
                throw LiDARFrameWriter.BufferError.inaccessiblePixels
            }
            confidenceLocked = true
            confidenceBase = CVPixelBufferGetBaseAddress(confidence)
            confidenceRow = CVPixelBufferGetBytesPerRow(confidence)
        }

        var count = 0
        for y in 0..<height {
            let values = base.advanced(by: y * row).assumingMemoryBound(to: Float.self)
            for x in 0..<width where values[x].isFinite && values[x] > 0 { count += 1 }
        }
        let stride = confidenceBase == nil ? 12 : 13
        var header = """
        ply
        format binary_little_endian 1.0
        comment ARKit world space, meters
        element vertex \(count)
        property float x
        property float y
        property float z

        """
        if confidenceBase != nil { header += "property uchar confidence\n" }
        header += "end_header\n"
        let prefix = Data(header.utf8)
        var result = Data(count: prefix.count + count * stride)
        result.replaceSubrange(0..<prefix.count, with: prefix)
        result.withUnsafeMutableBytes { (output: UnsafeMutableRawBufferPointer) in
            guard let baseOutput = output.baseAddress else { return }
            var writeAt = baseOutput.advanced(by: prefix.count)
            let xAxis = cameraToWorld.columns.0 / fx
            let yAxis = cameraToWorld.columns.1 / fy
            let zAxis = cameraToWorld.columns.2
            let origin = cameraToWorld.columns.3
            for y in 0..<height {
                let values = base.advanced(by: y * row).assumingMemoryBound(to: Float.self)
                let confidenceValues = confidenceBase?.advanced(by: y * confidenceRow).assumingMemoryBound(to: UInt8.self)
                let rowRay = yAxis * (cy - Float(y)) - zAxis
                for x in 0..<width {
                    let value = values[x]
                    guard value.isFinite, value > 0 else { continue }
                    let point = (xAxis * (Float(x) - cx) + rowRay) * value + origin
                    var xyz = SIMD4(point.x.bitPattern.littleEndian, point.y.bitPattern.littleEndian,
                                    point.z.bitPattern.littleEndian, 0)
                    withUnsafeBytes(of: &xyz) { writeAt.copyMemory(from: $0.baseAddress!, byteCount: 12) }
                    if let confidenceValues {
                        writeAt.advanced(by: 12).storeBytes(of: confidenceValues[x], as: UInt8.self)
                    }
                    writeAt += stride
                }
            }
        }
        return result
    }
}
