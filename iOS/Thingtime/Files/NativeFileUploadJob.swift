import AppleFileSync
import CryptoKit
import Foundation

/// One bounded native multipart job. The shared sync journal owns operation
/// identity and Timeline publication; this host only completes attachment bytes.
struct NativeUploadFileRequest: Decodable, Sendable {
    let source: MobileFolderReader.Entry
    let uploadId: String
    let requestId: String
    let authorization: NativeUploadAuthorization
    func part(_ number: Int) throws -> NativeUploadPartRequest {
        let plan = try FileUploadPart.plan(size: source.size)
        guard number >= 1, number <= plan.count else { throw MobileFolderStore.Failure.invalid }
        let offset = Int64(number - 1) * plan.partSize
        let request = NativeUploadPartRequest(source: source, uploadId: uploadId, requestId: requestId,
            partNumber: number, offset: offset, length: min(plan.partSize, source.size - offset))
        try request.validate()
        return request
    }
}
@MainActor
enum NativeFileUploadJob {
    static func run(_ request: NativeUploadFileRequest, check: () throws -> Void, authorize: () async throws -> Void,
                    json: (String, [String: Any]?) async throws -> [String: Any],
                    upload: (NativeUploadPartRequest) async throws -> String,
                    progress: (Int64) -> Void) async throws {
        let first = try request.part(1)
        let plan = try FileUploadPart.plan(size: request.source.size)
        try Task.checkCancellation(); try check()
        try await authorize(); try check()
        let started = try await json("/api/v1/attachments/uploads", ["requestId": request.requestId,
            "filename": String(request.source.path.split(separator: "/").last ?? ""), "contentType": "application/octet-stream",
            "sizeBytes": request.source.size, "purpose": "file"])
        try Task.checkCancellation(); try check()
        // An accepted completion can be recovered without sending bytes again.
        // The shared caller independently verifies the stored fingerprint before
        // publishing its original file/Timeline operation.
        if try first.verifyPlan(started) { progress(request.source.size); return }
        var composite = SHA256()
        for number in 1...plan.count {
            try Task.checkCancellation(); try check()
            let part = try request.part(number)
            try await authorize(); try check()
            let digest = try await upload(part)
            try Task.checkCancellation(); try check()
            guard digest.utf8.count == 64, digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
                throw MobileFolderStore.Failure.changed
            }
            let chars = Array(digest.utf8)
            var bytes = Data(); bytes.reserveCapacity(32)
            for i in stride(from: 0, to: 64, by: 2) {
                guard let byte = UInt8(String(decoding: chars[i...i+1], as: UTF8.self), radix: 16) else { throw MobileFolderStore.Failure.changed }
                bytes.append(byte)
            }
            composite.update(data: bytes)
            progress(part.offset + part.length)
        }
        let digest = composite.finalize().map { String(format: "%02x", $0) }.joined()
        guard digest == request.source.fingerprint?.sha256 else { throw MobileFolderStore.Failure.changed }
        try Task.checkCancellation(); try check()
        try await authorize(); try check()
        let completed = try await json("/api/v1/attachments/uploads/complete", ["uploadId": request.uploadId])
        try Task.checkCancellation(); try check()
        guard completed["ok"] as? Bool == true else { throw MobileFolderStore.Failure.changed }
    }
}
