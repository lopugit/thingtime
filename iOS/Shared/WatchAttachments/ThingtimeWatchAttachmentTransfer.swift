import Foundation

struct ThingtimeWatchAttachmentMetadata: Codable, Equatable, Sendable {
    let requestId: String
    let filename: String
    let contentType: String
    let sizeBytes: Int64

    var transferDictionary: [String: Any] {
        [
            "kind": ThingtimeWatchAttachmentTransfer.fileKind,
            "requestId": requestId,
            "filename": filename,
            "contentType": contentType,
            "sizeBytes": sizeBytes
        ]
    }
}

enum ThingtimeWatchAttachmentTransfer {
    static let fileKind = "private-thing-attachment-v1"
    static let resultKind = "private-thing-attachment-result-v1"
    static let maximumBytes: Int64 = 32 * 1024 * 1024

    static func makeMetadata(
        requestId: String = UUID().uuidString.lowercased(),
        filename: String,
        contentType: String,
        sizeBytes: Int64
    ) throws -> ThingtimeWatchAttachmentMetadata {
        guard UUID(uuidString: requestId) != nil else {
            throw ThingtimeWatchAttachmentTransferError.invalidRequestId
        }
        let cleanName = filename.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty,
              cleanName.count <= 255,
              cleanName == URL(fileURLWithPath: cleanName).lastPathComponent,
              cleanName.rangeOfCharacter(from: .controlCharacters) == nil else {
            throw ThingtimeWatchAttachmentTransferError.invalidFilename
        }
        let cleanType = contentType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let typeParts = cleanType.split(separator: "/", omittingEmptySubsequences: false)
        guard cleanType.count <= 127,
              typeParts.count == 2,
              typeParts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(isMIMECharacter) }) else {
            throw ThingtimeWatchAttachmentTransferError.invalidContentType
        }
        guard sizeBytes > 0, sizeBytes <= maximumBytes else {
            throw ThingtimeWatchAttachmentTransferError.invalidSize
        }
        return ThingtimeWatchAttachmentMetadata(
            requestId: requestId.lowercased(),
            filename: cleanName,
            contentType: cleanType,
            sizeBytes: sizeBytes
        )
    }

    static func metadata(from dictionary: [String: Any]?) throws -> ThingtimeWatchAttachmentMetadata {
        guard let dictionary,
              dictionary["kind"] as? String == fileKind,
              let requestId = dictionary["requestId"] as? String,
              let filename = dictionary["filename"] as? String,
              let contentType = dictionary["contentType"] as? String,
              let size = dictionary["sizeBytes"] as? NSNumber else {
            throw ThingtimeWatchAttachmentTransferError.invalidMetadata
        }
        return try makeMetadata(
            requestId: requestId,
            filename: filename,
            contentType: contentType,
            sizeBytes: size.int64Value
        )
    }

    private static func isMIMECharacter(_ character: Character) -> Bool {
        character.isASCII && (character.isLetter || character.isNumber || "!#$&^_.+-".contains(character))
    }
}

enum ThingtimeWatchAttachmentTransferError: LocalizedError, Equatable {
    case invalidMetadata
    case invalidRequestId
    case invalidFilename
    case invalidContentType
    case invalidSize

    var errorDescription: String? {
        switch self {
        case .invalidMetadata: "The selected attachment metadata is invalid."
        case .invalidRequestId: "The attachment request identifier is invalid."
        case .invalidFilename: "The attachment filename is invalid."
        case .invalidContentType: "The attachment file type is invalid."
        case .invalidSize: "Attachments must be between 1 byte and 32 MB."
        }
    }
}

enum ThingtimeWatchUploadRequirements {
    static let minimumVersions = [
        "api.attachment-uploads": "1.0.0",
        "api.attachment-upload-parts": "1.0.0",
        "api.attachment-upload-complete": "1.0.0",
        "api.things": "1.1.0"
    ]

    static func satisfies(actual: String, minimum: String) -> Bool {
        guard let actual = semanticVersion(actual), let minimum = semanticVersion(minimum) else { return false }
        return actual.major == minimum.major &&
            (actual.minor > minimum.minor || (actual.minor == minimum.minor && actual.patch >= minimum.patch))
    }

    private static func semanticVersion(_ value: String) -> (major: Int, minor: Int, patch: Int)? {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
              let major = Int(parts[0]),
              let minor = Int(parts[1]),
              let patch = Int(parts[2]) else { return nil }
        return (major, minor, patch)
    }
}
