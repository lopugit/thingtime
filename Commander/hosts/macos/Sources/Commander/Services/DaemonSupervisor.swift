import Darwin
import Foundation

struct DaemonReady: Decodable, Sendable {
  let type: String
  let protocolVersion: Int
  let port: Int
  let url: String
  let sessionToken: String
  let nativeToken: String
  let pid: Int32
}

enum DaemonError: LocalizedError, Sendable {
  case alreadyRunning
  case portInUse(port: Int, details: String?)
  case missingResource(String)
  case invalidHandshake(String)
  case timedOut(seconds: TimeInterval, details: String?)
  case stopped(status: Int32, details: String?)

  var errorDescription: String? {
    switch self {
    case .alreadyRunning:
      "The Commander service is already starting or running."
    case .portInUse(let port, let details):
      Self.withDetails("Commander’s local port \(port) is already in use.", details)
    case .missingResource(let name):
      "The Commander app is missing \(name). Rebuild the app bundle."
    case .invalidHandshake(let line):
      "The Commander service returned an invalid handshake: \(line)"
    case .timedOut(let seconds, let details):
      Self.withDetails("The Commander service did not become ready within \(Int(seconds)) seconds.", details)
    case .stopped(let status, let details):
      Self.withDetails("The Commander service exited unexpectedly (status \(status)).", details)
    }
  }

  private static func withDetails(_ summary: String, _ details: String?) -> String {
    guard let details, !details.isEmpty else { return summary }
    return "\(summary)\n\nService output:\n\(details)"
  }
}

final class DaemonSupervisor: @unchecked Sendable {
  static let defaultPort = 47820
  typealias ReadyCompletion = @MainActor @Sendable (Result<DaemonReady, Error>) -> Void
  typealias UnexpectedExitHandler = @MainActor @Sendable (DaemonError) -> Void

  private static let maximumDiagnosticBytes = 16 * 1024
  private static let maximumHandshakeBytes = 1024 * 1024
  private let lock = NSLock()
  private var process: Process?
  private var outputPipe: Pipe?
  private var errorPipe: Pipe?
  private var outputBuffer = Data()
  private var diagnosticBuffer = Data()
  private var startupResolved = false
  private var readyWasDelivered = false
  private var stopping = false
  private var timeoutWorkItem: DispatchWorkItem?

  @MainActor
  func start(
    port: Int = defaultPort,
    timeout: TimeInterval = 12,
    onUnexpectedExit: @escaping UnexpectedExitHandler,
    completion: @escaping ReadyCompletion
  ) {
    lock.lock()
    let alreadyRunning = process != nil
    lock.unlock()
    guard !alreadyRunning else {
      completion(.failure(DaemonError.alreadyRunning))
      return
    }

    guard let resources = Bundle.main.resourceURL else {
      completion(.failure(DaemonError.missingResource("Resources")))
      return
    }
    let daemonURL = resources.appendingPathComponent("commander-daemon.mjs")
    let uiURL = resources.appendingPathComponent("ui", isDirectory: true)
    guard FileManager.default.fileExists(atPath: daemonURL.path) else {
      completion(.failure(DaemonError.missingResource("commander-daemon.mjs")))
      return
    }
    guard FileManager.default.fileExists(atPath: uiURL.appendingPathComponent("launcher.html").path),
          FileManager.default.fileExists(atPath: uiURL.appendingPathComponent("settings.html").path) else {
      completion(.failure(DaemonError.missingResource("ui launcher/settings entry points")))
      return
    }

    let bundledNode = resources.appendingPathComponent("node/bin/node")
    let rustCore = resources.appendingPathComponent("commander-core")
    let filesystemIndexer = resources.appendingPathComponent("commander-indexer")
    let process = Process()
    var arguments = [
      daemonURL.path,
      "--ui", uiURL.path,
      "--port", String(port),
      "--parent-pid", String(getpid())
    ]
    if FileManager.default.isExecutableFile(atPath: rustCore.path) {
      arguments += ["--rust-core", rustCore.path]
    }
    if FileManager.default.isExecutableFile(atPath: filesystemIndexer.path) {
      arguments += ["--filesystem-indexer", filesystemIndexer.path]
    }
    if FileManager.default.isExecutableFile(atPath: bundledNode.path) {
      process.executableURL = bundledNode
    } else {
      process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
      arguments.insert("node", at: 0)
    }
    process.arguments = arguments
    process.currentDirectoryURL = resources

    let output = Pipe()
    let errors = Pipe()
    process.standardOutput = output
    process.standardError = errors

    lock.lock()
    self.process = process
    outputPipe = output
    errorPipe = errors
    outputBuffer.removeAll(keepingCapacity: true)
    diagnosticBuffer.removeAll(keepingCapacity: true)
    startupResolved = false
    readyWasDelivered = false
    stopping = false
    lock.unlock()

    output.fileHandleForReading.readabilityHandler = { [weak self] handle in
      guard let self else { return }
      let data = handle.availableData
      if !data.isEmpty { self.consumeStandardOutput(data, expectedPort: port, completion: completion) }
    }
    errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
      guard let self else { return }
      let data = handle.availableData
      if !data.isEmpty { self.consumeDiagnosticOutput(data) }
    }
    process.terminationHandler = { [weak self] terminatedProcess in
      self?.processDidTerminate(
        terminatedProcess,
        port: port,
        completion: completion,
        onUnexpectedExit: onUnexpectedExit
      )
    }

    do {
      try process.run()
    } catch {
      resolveLaunchFailure(error, for: process, completion: completion)
      return
    }

    let timeoutWorkItem = DispatchWorkItem { [weak self] in
      self?.startupDidTimeOut(after: timeout, process: process, completion: completion)
    }
    lock.lock()
    let shouldScheduleTimeout = process === self.process && !startupResolved
    if shouldScheduleTimeout { self.timeoutWorkItem = timeoutWorkItem }
    lock.unlock()
    if shouldScheduleTimeout {
      DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeout, execute: timeoutWorkItem)
    }
  }

  func isReadyAndRunning(pid: Int32) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return readyWasDelivered && process?.processIdentifier == pid && process?.isRunning == true
  }

  func stop() {
    let running = detachProcess(expectedStop: true)
    guard let running else { return }
    running.terminationHandler = nil
    terminateAndWait(running)
  }

  private func consumeStandardOutput(
    _ data: Data,
    expectedPort: Int,
    completion: @escaping ReadyCompletion
  ) {
    lock.lock()
    guard !startupResolved else {
      lock.unlock()
      return
    }
    outputBuffer.append(data)
    if outputBuffer.count > Self.maximumHandshakeBytes {
      startupResolved = true
      outputBuffer.removeAll(keepingCapacity: false)
      let timeout = timeoutWorkItem
      timeoutWorkItem = nil
      lock.unlock()
      timeout?.cancel()
      stopAfterStartupFailure()
      Task { @MainActor in
        completion(.failure(DaemonError.invalidHandshake("readiness message exceeds the 1 MiB limit")))
      }
      return
    }
    guard let newline = outputBuffer.firstIndex(of: 0x0A) else {
      lock.unlock()
      return
    }
    let lineData = outputBuffer[..<newline]
    do {
      let ready = try JSONDecoder().decode(DaemonReady.self, from: lineData)
      guard ready.type == "ready", ready.protocolVersion == 1,
            ready.pid == process?.processIdentifier,
            ready.port == expectedPort,
            let readyURL = URL(string: ready.url),
            readyURL.scheme == "http", readyURL.host == "127.0.0.1", readyURL.port == ready.port,
            !ready.sessionToken.isEmpty, !ready.nativeToken.isEmpty else {
        throw DaemonError.invalidHandshake("readiness values do not match the launched loopback service")
      }
      startupResolved = true
      readyWasDelivered = true
      outputBuffer.removeAll(keepingCapacity: false)
      let timeout = timeoutWorkItem
      timeoutWorkItem = nil
      lock.unlock()
      timeout?.cancel()
      Task { @MainActor in completion(.success(ready)) }
    } catch {
      startupResolved = true
      outputBuffer.removeAll(keepingCapacity: false)
      let timeout = timeoutWorkItem
      timeoutWorkItem = nil
      lock.unlock()
      timeout?.cancel()
      stopAfterStartupFailure()
      let handshakeError = (error as? DaemonError)
        ?? DaemonError.invalidHandshake("readiness JSON could not be decoded")
      Task { @MainActor in completion(.failure(handshakeError)) }
    }
  }

  private func consumeDiagnosticOutput(_ data: Data) {
    lock.lock()
    diagnosticBuffer.append(data)
    if diagnosticBuffer.count > Self.maximumDiagnosticBytes {
      diagnosticBuffer.removeFirst(diagnosticBuffer.count - Self.maximumDiagnosticBytes)
    }
    lock.unlock()
    if let message = String(data: data, encoding: .utf8) {
      NSLog("Commander service: %@", message.trimmingCharacters(in: .whitespacesAndNewlines))
    }
  }

  private func startupDidTimeOut(
    after seconds: TimeInterval,
    process timedProcess: Process,
    completion: @escaping ReadyCompletion
  ) {
    lock.lock()
    guard process === timedProcess, !startupResolved else {
      lock.unlock()
      return
    }
    startupResolved = true
    stopping = true
    timeoutWorkItem = nil
    let details = diagnosticDetailsLocked()
    lock.unlock()

    _ = detachProcess(expectedStop: true)
    timedProcess.terminationHandler = nil
    terminateAndWait(timedProcess)
    Task { @MainActor in
      completion(.failure(DaemonError.timedOut(seconds: seconds, details: details)))
    }
  }

  private func resolveLaunchFailure(
    _ error: Error,
    for failedProcess: Process,
    completion: @escaping ReadyCompletion
  ) {
    lock.lock()
    guard process === failedProcess, !startupResolved else {
      lock.unlock()
      return
    }
    startupResolved = true
    lock.unlock()
    _ = detachProcess(expectedStop: true)
    Task { @MainActor in completion(.failure(error)) }
  }

  private func processDidTerminate(
    _ terminatedProcess: Process,
    port: Int,
    completion: @escaping ReadyCompletion,
    onUnexpectedExit: @escaping UnexpectedExitHandler
  ) {
    lock.lock()
    guard process === terminatedProcess else {
      lock.unlock()
      return
    }
    let expected = stopping
    let ready = readyWasDelivered
    let startupHadResolved = startupResolved
    startupResolved = true
    let details = diagnosticDetailsLocked()
    let timeout = timeoutWorkItem
    timeoutWorkItem = nil
    process = nil
    let output = outputPipe
    let errors = errorPipe
    outputPipe = nil
    errorPipe = nil
    lock.unlock()
    timeout?.cancel()
    clearPipeHandlers(output: output, errors: errors)

    guard !expected else { return }
    let error: DaemonError
    // Pipe delivery can race process termination. Confirm the listener as well
    // as reading Node's EADDRINUSE diagnostic, so this stays actionable even
    // when stderr is drained just after the child exits.
    if !ready, !startupHadResolved,
       (Self.isPortInUse(details) || LoopbackPortInspector().listener(on: port) != nil) {
      error = .portInUse(port: port, details: details)
    } else {
      error = .stopped(status: terminatedProcess.terminationStatus, details: details)
    }
    if ready {
      Task { @MainActor in onUnexpectedExit(error) }
    } else if !startupHadResolved {
      Task { @MainActor in completion(.failure(error)) }
    }
  }

  private func detachProcess(expectedStop: Bool) -> Process? {
    lock.lock()
    stopping = expectedStop
    let running = process
    process = nil
    let timeout = timeoutWorkItem
    timeoutWorkItem = nil
    let output = outputPipe
    let errors = errorPipe
    outputPipe = nil
    errorPipe = nil
    lock.unlock()
    timeout?.cancel()
    clearPipeHandlers(output: output, errors: errors)
    return running
  }

  private func stopAfterStartupFailure() {
    let running = detachProcess(expectedStop: true)
    running?.terminationHandler = nil
    if let running { terminateAndWait(running) }
  }

  private func terminateAndWait(_ running: Process) {
    guard running.isRunning else { return }
    running.terminate()
    let deadline = Date().addingTimeInterval(0.75)
    while running.isRunning, Date() < deadline {
      usleep(20_000)
    }
    if running.isRunning {
      kill(running.processIdentifier, SIGKILL)
      running.waitUntilExit()
    }
  }

  private func clearPipeHandlers(output: Pipe?, errors: Pipe?) {
    output?.fileHandleForReading.readabilityHandler = nil
    errors?.fileHandleForReading.readabilityHandler = nil
  }

  private func diagnosticDetailsLocked() -> String? {
    let text = String(decoding: diagnosticBuffer, as: UTF8.self)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  private static func isPortInUse(_ details: String?) -> Bool {
    details?.localizedCaseInsensitiveContains("EADDRINUSE") == true
  }
}
