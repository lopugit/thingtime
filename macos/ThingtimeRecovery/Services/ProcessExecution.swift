import Foundation

public enum ProcessExecution {
    @discardableResult
    public static func run(_ executable: String, arguments: [String], label: String) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        process.waitUntilExit()
        let standardOutput = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let standardError = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            let detail = (standardError.isEmpty ? standardOutput : standardError).trimmingCharacters(in: .whitespacesAndNewlines)
            throw RecoveryError.operationFailed("\(label) failed\(detail.isEmpty ? "." : ": \(detail)")")
        }
        return "\(standardOutput)\n\(standardError)"
    }

    public static func launchApplication(_ appURL: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-n", appURL.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        // `open` has handed the app to LaunchServices almost immediately. Some
        // macOS versions then retain the CLI process until the GUI exits, so
        // reap only that launcher instead of leaving the installer blocked.
        Thread.sleep(forTimeInterval: 0.5)
        if process.isRunning { process.terminate() }
        process.waitUntilExit()
    }
}
