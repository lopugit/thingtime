import AppleFileSync
import Foundation

struct NativeUploadPartRequest: Decodable, Sendable {
    let source: MobileFolderReader.Entry
    let uploadId: String
    let requestId: String
    let partNumber: Int
    let offset: Int64
    let length: Int64
    func validate() throws {
        let pattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$"
        let plan = try FileUploadPart.plan(size: source.size)
        guard uploadId.range(of: pattern, options: .regularExpression) != nil,
              requestId.range(of: pattern, options: .regularExpression) != nil,
              source.kind == "file", !source.path.isEmpty, source.path.utf16.count <= 4096,
              !source.version.isEmpty, source.version.utf8.count <= 512,
              source.fingerprint?.algorithm == "sha256-parts-v1", source.fingerprint?.partCount == plan.count,
              source.fingerprint?.partSizeBytes == plan.partSize, source.fingerprint?.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              partNumber >= 1, partNumber <= plan.count, offset == Int64(partNumber - 1) * plan.partSize,
              length == min(plan.partSize, source.size - offset) else { throw MobileFolderStore.Failure.invalid }
    }
    private struct PlanResponse: Decodable {
        struct Upload: Decodable { let id: String; let partSizeBytes: Int64; let partCount: Int; let state: String? }
        let ok: Bool
        let upload: Upload
    }
    func verifyPlan(_ value: [String: Any]) throws -> Bool {
        let plan = try FileUploadPart.plan(size: source.size)
        let response = try JSONDecoder().decode(PlanResponse.self, from: JSONSerialization.data(withJSONObject: value))
        guard response.ok, response.upload.id == uploadId, response.upload.partSizeBytes == plan.partSize,
              response.upload.partCount == plan.count else { throw MobileFolderStore.Failure.changed }
        return response.upload.state == "ready"
    }
}
