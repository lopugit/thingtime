import Darwin
import Foundation

/// An explicitly approved user script, NOT a sandbox. It has the signed-in
/// user's OS access, a minimal environment, and bounded foreground execution.
public enum DeviceScript {
    static let maximumOutputBytes = 16_384
    static func validate(_ input: [String: JSONValue]) -> String? {
        guard Set(input.keys) == ["script", "timeoutSeconds"],
              let script = input["script"]?.stringValue, !script.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              script.utf8.count <= 16_384, !script.contains("\0"),
              let timeout = input["timeoutSeconds"]?.numberValue, timeout.isFinite,
              timeout.rounded() == timeout, (1...30).contains(timeout) else {
            return "A script requires Bash source (up to 16 KiB) and timeoutSeconds from 1 to 30."
        }
        return nil
    }

    public static func execute(_ input: [String: JSONValue]) throws -> JSONValue {
        if let invalid = validate(input) { throw ThingtimeNodeError.invalidRequest(invalid) }
        let script = input["script"]!.stringValue!
        let timeout = input["timeoutSeconds"]!.numberValue!
        // Pass source through an unlinked private descriptor, never argv or a
        // persistent script file. No login/profile startup files are evaluated.
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-script-XXXXXX").path
        var template = Array(path.utf8CString)
        let sourceFD = mkstemp(&template)
        guard sourceFD >= 0 else { throw ThingtimeNodeError.invalidRequest("Cannot prepare the script.") }
        defer { close(sourceFD) }
        unlink(template)
        let source = Data(script.utf8)
        guard source.withUnsafeBytes({ Darwin.write(sourceFD, $0.baseAddress, $0.count) }) == source.count,
              lseek(sourceFD, 0, SEEK_SET) == 0 else { throw ThingtimeNodeError.invalidRequest("Cannot prepare the script.") }
        var out: [Int32] = [0, 0], err: [Int32] = [0, 0]
        guard pipe(&out) == 0 else { throw ThingtimeNodeError.invalidRequest("Cannot capture script output.") }
        defer { close(out[0]); close(out[1]) }
        guard pipe(&err) == 0 else { throw ThingtimeNodeError.invalidRequest("Cannot capture script output.") }
        defer { close(err[0]); close(err[1]) }
        var actions: posix_spawn_file_actions_t?, attributes: posix_spawnattr_t?
        guard posix_spawn_file_actions_init(&actions) == 0 else { throw ThingtimeNodeError.invalidRequest("Cannot prepare script descriptors.") }
        guard posix_spawnattr_init(&attributes) == 0 else {
            posix_spawn_file_actions_destroy(&actions)
            throw ThingtimeNodeError.invalidRequest("Cannot prepare script process.")
        }
        defer { posix_spawn_file_actions_destroy(&actions); posix_spawnattr_destroy(&attributes) }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        guard posix_spawn_file_actions_adddup2(&actions, sourceFD, STDIN_FILENO) == 0,
              posix_spawn_file_actions_adddup2(&actions, out[1], STDOUT_FILENO) == 0,
              posix_spawn_file_actions_adddup2(&actions, err[1], STDERR_FILENO) == 0,
              posix_spawn_file_actions_addchdir_np(&actions, home) == 0,
              posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT)) == 0,
              posix_spawnattr_setpgroup(&attributes, 0) == 0 else {
            throw ThingtimeNodeError.invalidRequest("Cannot prepare the isolated script process group.")
        }
        let argumentStrings: [String] = ["/bin/bash", "--noprofile", "--norc", "-s"]
        let arguments: [UnsafeMutablePointer<CChar>?] = argumentStrings.map { $0.withCString { strdup($0) } } + [nil]
        let environmentStrings: [String] = ["PATH=/usr/bin:/bin:/usr/sbin:/sbin", "HOME=\(home)", "LANG=en_US.UTF-8"]
        let environment: [UnsafeMutablePointer<CChar>?] = environmentStrings.map { $0.withCString { strdup($0) } } + [nil]
        defer { arguments.forEach { free($0) }; environment.forEach { free($0) } }
        var pid: pid_t = 0
        let started = ProcessInfo.processInfo.systemUptime
        let spawned = arguments.withUnsafeBufferPointer { argv in
            environment.withUnsafeBufferPointer { env in
                posix_spawn(&pid, "/bin/bash", &actions, &attributes, argv.baseAddress!, env.baseAddress!)
            }
        }
        guard spawned == 0 else { throw ThingtimeNodeError.invalidRequest("Cannot start Bash.") }
        // A separate process group allows timeout/overflow cleanup to include
        // ordinary child processes. Deliberately detached daemons are outside
        // this contract; the script is approved code, not untrusted isolation.
        defer { kill(-pid, SIGKILL) }
        _ = fcntl(out[0], F_SETFL, O_NONBLOCK); _ = fcntl(err[0], F_SETFL, O_NONBLOCK)
        var stdout = Data(), stderr = Data(), status: Int32 = 0
        var outputBytes = 0
        var timedOut = false, truncated = false, exited = false
        func drain(_ fd: Int32, into data: inout Data) {
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = Darwin.read(fd, &buffer, buffer.count)
                if count <= 0 { return }
                let remaining = max(0, maximumOutputBytes - outputBytes)
                data.append(contentsOf: buffer.prefix(min(count, remaining)))
                outputBytes += min(count, remaining)
                if count > remaining { truncated = true; return }
            }
        }
        while !exited {
            drain(out[0], into: &stdout); drain(err[0], into: &stderr)
            let waited = waitpid(pid, &status, WNOHANG)
            if waited < 0 && errno != EINTR { throw ThingtimeNodeError.invalidRequest("Cannot read script exit status.") }
            exited = waited == pid
            if !exited && (truncated || ProcessInfo.processInfo.systemUptime - started >= timeout) {
                timedOut = !truncated
                kill(-pid, SIGKILL)
                while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
                exited = true
            }
            if !exited { usleep(10_000) }
        }
        drain(out[0], into: &stdout); drain(err[0], into: &stderr)
        let signal = status & 0x7f
        return .object(["script": .object([
            "stdout": .string(String(decoding: stdout, as: UTF8.self)),
            "stderr": .string(String(decoding: stderr, as: UTF8.self)),
            "exitCode": signal == 0 ? .number(Double((status >> 8) & 0xff)) : .null,
            "signal": signal == 0 ? .null : .number(Double(signal)),
            "timedOut": .bool(timedOut), "truncated": .bool(truncated)
        ])])
    }
}
