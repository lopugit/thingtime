import Foundation
import FileSyncRecoverySupport

@main
struct RecoveryFixture {
    @MainActor static func main() throws {
        guard CommandLine.arguments.count == 4 else { throw CocoaError(.fileReadInvalidFileName) }
        let root = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
        if CommandLine.arguments[2].hasPrefix("upload-part-") {
            try UploadPartProcessAcceptance.run(phase: CommandLine.arguments[1], scenario: CommandLine.arguments[2], root: root)
        } else if CommandLine.arguments[2].hasPrefix("trash-") {
            try TrashProcessAcceptance.run(phase: CommandLine.arguments[1], scenario: CommandLine.arguments[2], root: root)
        } else {
            try PublicationProcessAcceptance.run(phase: CommandLine.arguments[1], scenario: CommandLine.arguments[2], root: root)
        }
        print("Verified fresh-process native file recovery: \(CommandLine.arguments[2])")
    }
}
