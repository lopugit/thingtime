import AVFoundation
import Photos
import UIKit
import ImageIO

/// Makes its own photo/movie pair. No existing library asset is read.
enum LivePhotoFixture {
    static func seed() async throws -> String {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard status == .authorized || status == .limited else { throw NSError(domain: "ShareAcceptance", code: 1) }
        let id = UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let photo = directory.appendingPathComponent("live-photo.jpg")
        let movie = directory.appendingPathComponent("live-photo.mov")
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 320, height: 240))
        let image = renderer.image { context in
            UIColor.systemTeal.setFill(); context.fill(CGRect(x: 0, y: 0, width: 320, height: 240))
            "Thingtime Live Photo".draw(at: CGPoint(x: 25, y: 110), withAttributes: [.font: UIFont.systemFont(ofSize: 22), .foregroundColor: UIColor.white])
        }
        let destination = CGImageDestinationCreateWithURL(photo as CFURL, "public.jpeg" as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image.cgImage!, [kCGImagePropertyMakerAppleDictionary: ["17": id]] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "ShareAcceptance", code: 2) }
        let writer = try AVAssetWriter(outputURL: movie, fileType: .mov)
        let video = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 320, AVVideoHeightKey: 240])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: 320, kCVPixelBufferHeightKey as String: 240])
        let identifier = AVMutableMetadataItem()
        identifier.keySpace = .quickTimeMetadata; identifier.key = "com.apple.quicktime.content.identifier" as NSString; identifier.value = id as NSString
        writer.metadata = [identifier]
        var format: CMFormatDescription?
        let specification = [kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier as String: "mdta/com.apple.quicktime.still-image-time", kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType as String: "com.apple.metadata.datatype.int8"]
        CMMetadataFormatDescriptionCreateWithMetadataSpecifications(allocator: kCFAllocatorDefault, metadataType: kCMMetadataFormatType_Boxed, metadataSpecifications: [specification] as CFArray, formatDescriptionOut: &format)
        let metadata = AVAssetWriterInput(mediaType: .metadata, outputSettings: nil, sourceFormatHint: format)
        let timed = AVAssetWriterInputMetadataAdaptor(assetWriterInput: metadata)
        writer.add(video); writer.add(metadata)
        guard writer.startWriting() else { throw writer.error! }
        writer.startSession(atSourceTime: .zero)
        let still = AVMutableMetadataItem()
        still.keySpace = .quickTimeMetadata; still.key = "com.apple.quicktime.still-image-time" as NSString; still.value = NSNumber(value: Int8(0)); still.dataType = "com.apple.metadata.datatype.int8"
        timed.append(AVTimedMetadataGroup(items: [still], timeRange: CMTimeRange(start: CMTime(value: 15, timescale: 30), duration: CMTime(value: 1, timescale: 30))))
        metadata.markAsFinished()
        for frame in 0..<30 {
            while !video.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 10_000_000) }
            var pixel: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pixel)
            CVPixelBufferLockBaseAddress(pixel!, [])
            let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel!), width: 320, height: 240, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel!), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
            context.setFillColor(UIColor.systemTeal.cgColor); context.fill(CGRect(x: 0, y: 0, width: 320, height: 240))
            context.setFillColor(UIColor.white.cgColor); context.fill(CGRect(x: frame * 6, y: 90, width: 30, height: 30))
            CVPixelBufferUnlockBaseAddress(pixel!, [])
            guard adaptor.append(pixel!, withPresentationTime: CMTime(value: Int64(frame), timescale: 30)) else { throw writer.error! }
        }
        video.markAsFinished(); await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error! }
        var localID = ""
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .photo, fileURL: photo, options: nil)
            request.addResource(with: .pairedVideo, fileURL: movie, options: nil)
            localID = request.placeholderForCreatedAsset!.localIdentifier
        }
        let asset = PHAsset.fetchAssets(withLocalIdentifiers: [localID], options: nil).firstObject!
        guard asset.mediaSubtypes.contains(.photoLive) else { throw NSError(domain: "ShareAcceptance.NotLivePhoto", code: 3) }
        return localID
    }
}
