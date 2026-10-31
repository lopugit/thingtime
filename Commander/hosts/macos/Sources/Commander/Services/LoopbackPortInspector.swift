import Darwin
import Foundation

struct LoopbackPortProcess: Equatable, Sendable {
  let pid: Int32
  let command: String
}

enum LoopbackPortInspectorError: LocalizedError {
  case listenerChanged(port: Int)
  case cannotTerminate(pid: Int32)

  var errorDescription: String? {
    switch self {
    case .listenerChanged(let port):
      "The process listening on port \(port) changed before Commander could close it."
    case .cannotTerminate(let pid):
      "Commander could not stop process \(pid)."
    }
  }
}

struct LoopbackPortInspector {
  private static let maximumPort = 65_535

  func listener(on port: Int) -> LoopbackPortProcess? {
    guard (1...Self.maximumPort).contains(port) else { return nil }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    process.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-Fpct"]
    let output = Pipe()
    process.standardOutput = output
    process.standardError = Pipe()
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      return nil
    }
    return Self.parse(String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self))
  }

  func nextAvailablePort(after port: Int, maximumAttempts: Int = 100) -> Int? {
    guard maximumAttempts > 0, port >= 0, port < Self.maximumPort else { return nil }
    let firstCandidate = max(1, port + 1)
    let lastCandidate = port + min(maximumAttempts, Self.maximumPort - port)
    for candidate in firstCandidate...lastCandidate where listener(on: candidate) == nil {
      return candidate
    }
    return nil
  }

  func terminate(_ process: LoopbackPortProcess, listeningOn port: Int) throws {
    guard listener(on: port)?.pid == process.pid else {
      throw LoopbackPortInspectorError.listenerChanged(port: port)
    }
    guard process.pid > 1, kill(process.pid, SIGTERM) == 0 else {
      throw LoopbackPortInspectorError.cannotTerminate(pid: process.pid)
    }
  }

  static func parse(_ output: String) -> LoopbackPortProcess? {
    var pid: Int32?
    var command: String?
    for line in output.split(separator: "\n", omittingEmptySubsequences: true) {
      guard let field = line.first else { continue }
      switch field {
      case "p": pid = Int32(line.dropFirst())
      case "c": command = String(line.dropFirst())
      default: continue
      }
      if let pid, let command { return LoopbackPortProcess(pid: pid, command: command) }
    }
    return nil
  }
}
