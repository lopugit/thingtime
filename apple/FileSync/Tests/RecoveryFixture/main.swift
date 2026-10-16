import Foundation
import FileSyncRecoverySupport

@main
struct RecoveryFixture {
    @MainActor static func main() throws {
        guard CommandLine.arguments.count == 4 else { throw CocoaError(.fileReadInvalidFileName) }
        try PublicationProcessAcceptance.run(phase: CommandLine.arguments[1], scenario: CommandLine.arguments[2],
            root: URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true))
        print("Verified fresh-process publication recovery: \(CommandLine.arguments[2])")
    }
}
