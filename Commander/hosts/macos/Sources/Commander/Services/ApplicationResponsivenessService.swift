import AppKit
import ApplicationServices
import Darwin
import Foundation
import OSLog

enum ApplicationControlAction: String {
  case quit
  case forceQuit
  case restart
}

enum ApplicationResponsivenessKind: String, Equatable, Sendable {
  case ui
  case agent
  case service
}

enum ApplicationResponsivenessSignal: String, Equatable, Sendable {
  case repeatedAccessibilityTimeout
  case accessibilityProbeInconclusive
}

enum AccessibilityProbeResult: Equatable, Sendable {
  case responded
  case timedOut
  case unavailable
}

@MainActor
final class ApplicationResponsivenessService {
  private static let refreshInterval: TimeInterval = 3
  private let logger = Logger(subsystem: "com.thingtime.Commander", category: "ApplicationResponsiveness")
  private var lastRefreshAt: Date?
  private var refreshInFlight = false
  private var reportedApplications: [ReportedApplication] = []

  private struct Candidate: Sendable {
    let pid: pid_t
    let name: String
    let kind: ApplicationResponsivenessKind
  }

  private struct ReportedApplication: Sendable {
    let pid: pid_t
    let name: String
    let kind: ApplicationResponsivenessKind
    let signal: ApplicationResponsivenessSignal
  }

  func snapshot() -> [[String: Any]] {
    refreshIfNeeded()
    return reportedApplications.map { application in
      [
        "pid": Int(application.pid),
        "name": application.name,
        "kind": application.kind.rawValue,
        "signal": application.signal.rawValue,
      ]
    }
  }

  func hasReportedApplication(_ pid: pid_t) -> Bool {
    reportedApplications.contains { $0.pid == pid }
  }

  private func refreshIfNeeded() {
    guard AXIsProcessTrusted() else {
      reportedApplications = []
      return
    }
    guard !refreshInFlight,
          lastRefreshAt.map({ Date().timeIntervalSince($0) >= Self.refreshInterval }) ?? true else { return }

    let candidates = NSWorkspace.shared.runningApplications.compactMap { application -> Candidate? in
      let pid = application.processIdentifier
      guard pid > 1,
            pid != getpid(),
            !application.isTerminated,
            application.bundleURL != nil,
            let name = application.localizedName?.trimmingCharacters(in: .whitespacesAndNewlines),
            !name.isEmpty else { return nil }
      return Candidate(pid: pid, name: name, kind: Self.applicationKind(for: application.activationPolicy))
    }
    refreshInFlight = true
    lastRefreshAt = Date()
    let report = Self.report
    Task { [weak self, candidates, report] in
      let reported = await Task.detached(priority: .utility) {
        candidates.compactMap(report)
      }.value
      self?.finishRefresh(reported)
    }
  }

  private func finishRefresh(_ applications: [ReportedApplication]) {
    refreshInFlight = false
    reportedApplications = applications.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    let confirmedCount = applications.filter { $0.signal == .repeatedAccessibilityTimeout }.count
    if confirmedCount > 0 {
      logger.warning("Commander confirmed \(confirmedCount, privacy: .public) UI accessibility timeout(s)")
    }
  }

  nonisolated static func applicationKind(
    for activationPolicy: NSApplication.ActivationPolicy
  ) -> ApplicationResponsivenessKind {
    switch activationPolicy {
    case .regular:
      .ui
    case .accessory:
      .agent
    case .prohibited:
      .service
    @unknown default:
      .service
    }
  }

  nonisolated static func signal(
    for kind: ApplicationResponsivenessKind,
    firstProbe: AccessibilityProbeResult,
    confirmationProbe: AccessibilityProbeResult? = nil
  ) -> ApplicationResponsivenessSignal? {
    guard firstProbe == .timedOut else { return nil }

    switch kind {
    case .ui:
      return confirmationProbe == .timedOut ? .repeatedAccessibilityTimeout : nil
    case .agent, .service:
      // Background processes do not have a generic public responsiveness API.
      // An AX timeout is useful diagnostic context, but not proof that they hung.
      return .accessibilityProbeInconclusive
    }
  }

  private nonisolated static func report(for candidate: Candidate) -> ReportedApplication? {
    guard processIsAlive(candidate.pid) else { return nil }

    let firstProbe = accessibilityProbe(for: candidate.pid)
    let confirmationProbe: AccessibilityProbeResult?
    if candidate.kind == .ui, firstProbe == .timedOut {
      Thread.sleep(forTimeInterval: 0.15)
      confirmationProbe = accessibilityProbe(for: candidate.pid)
    } else {
      confirmationProbe = nil
    }
    guard let signal = signal(
      for: candidate.kind,
      firstProbe: firstProbe,
      confirmationProbe: confirmationProbe
    ) else { return nil }

    return ReportedApplication(pid: candidate.pid, name: candidate.name, kind: candidate.kind, signal: signal)
  }

  private nonisolated static func processIsAlive(_ pid: pid_t) -> Bool {
    if kill(pid, 0) == 0 { return true }
    return errno == EPERM
  }

  private nonisolated static func accessibilityProbe(for pid: pid_t) -> AccessibilityProbeResult {
    let element = AXUIElementCreateApplication(pid)
    guard AXUIElementSetMessagingTimeout(element, 0.75) == .success else { return .unavailable }
    var role: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
    if result == .success { return .responded }
    if result == .cannotComplete { return .timedOut }
    return .unavailable
  }
}

@MainActor
final class UnresponsiveApplicationController {
  typealias SubmitLaunch = (URL) -> Void

  private let responsiveness: ApplicationResponsivenessService
  private let submitLaunch: SubmitLaunch
  private let logger = Logger(subsystem: "com.thingtime.Commander", category: "ApplicationControl")

  init(responsiveness: ApplicationResponsivenessService, submitLaunch: @escaping SubmitLaunch) {
    self.responsiveness = responsiveness
    self.submitLaunch = submitLaunch
  }

  func perform(pid: pid_t, action: ApplicationControlAction) throws -> [String: Any] {
    // Activity only permits controls for a process that it just observed alive. The
    // signal determines the warning shown in the UI; it is not an authorization
    // boundary for an intentional quit, force quit, or restart request.
    guard pid > 1, pid != getpid(), responsiveness.hasReportedApplication(pid) else {
      throw ApplicationControlError.notReportedByActivity
    }
    guard let application = NSWorkspace.shared.runningApplications.first(where: { $0.processIdentifier == pid }),
          !application.isTerminated else {
      throw ApplicationControlError.noLongerRunning
    }
    let name = application.localizedName ?? "this app"

    switch action {
    case .quit:
      guard application.terminate() else { throw ApplicationControlError.notAccepted(name) }
    case .forceQuit:
      guard confirmForceQuit(name: name) else { return ["submitted": false, "cancelled": true] }
      guard application.forceTerminate() else { throw ApplicationControlError.notAccepted(name) }
    case .restart:
      guard let bundleURL = application.bundleURL else { throw ApplicationControlError.cannotRestart(name) }
      guard confirmRestart(name: name) else { return ["submitted": false, "cancelled": true] }
      let gracefulQuitAccepted = application.terminate()
      if !gracefulQuitAccepted, !application.forceTerminate() {
        throw ApplicationControlError.notAccepted(name)
      }
      scheduleRestart(of: application, at: bundleURL, forceImmediately: !gracefulQuitAccepted)
    }
    return ["submitted": true, "action": action.rawValue]
  }

  private func confirmForceQuit(name: String) -> Bool {
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = "Force quit \(name)?"
    alert.informativeText = "Any unsaved work in \(name) may be lost."
    alert.addButton(withTitle: "Cancel")
    alert.addButton(withTitle: "Force Quit")
    return alert.runModal() == .alertSecondButtonReturn
  }

  private func confirmRestart(name: String) -> Bool {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "Quit and restart \(name)?"
    alert.informativeText = "Commander will ask \(name) to quit, then force quit it after 3 seconds if needed. Unsaved work may be lost if force quitting is required."
    alert.addButton(withTitle: "Cancel")
    alert.addButton(withTitle: "Quit and Restart")
    return alert.runModal() == .alertSecondButtonReturn
  }

  private func scheduleRestart(of application: NSRunningApplication, at bundleURL: URL, forceImmediately: Bool) {
    let submitLaunch = submitLaunch
    let logger = logger
    Task { @MainActor in
      if !forceImmediately {
        let deadline = Date().addingTimeInterval(3)
        while !application.isTerminated && Date() < deadline {
          try? await Task.sleep(for: .milliseconds(100))
        }
      }
      if !application.isTerminated, !application.forceTerminate() {
        logger.error("Commander could not force quit an app before restart")
        return
      }
      let terminationDeadline = Date().addingTimeInterval(2)
      while !application.isTerminated && Date() < terminationDeadline {
        try? await Task.sleep(for: .milliseconds(100))
      }
      guard application.isTerminated else {
        logger.error("Commander did not restart an app because it remained running")
        return
      }
      submitLaunch(bundleURL)
    }
  }
}

private enum ApplicationControlError: LocalizedError {
  case notReportedByActivity
  case noLongerRunning
  case cannotRestart(String)
  case notAccepted(String)

  var errorDescription: String? {
    switch self {
    case .notReportedByActivity:
      "That app is no longer listed in Activity. Refresh and try again if needed."
    case .noLongerRunning:
      "That app has already quit."
    case .cannotRestart(let name):
      "Commander cannot find the app bundle needed to restart \(name)."
    case .notAccepted(let name):
      "macOS did not accept the request to quit \(name)."
    }
  }
}
