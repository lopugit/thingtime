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
  }

  private struct ReportedApplication: Sendable {
    let pid: pid_t
    let name: String
  }

  func snapshot() -> [[String: Any]] {
    refreshIfNeeded()
    return reportedApplications.map { application in
      [
        "pid": Int(application.pid),
        "name": application.name,
      ]
    }
  }

  func isReportedUnresponsive(_ pid: pid_t) -> Bool {
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
      return Candidate(pid: pid, name: name)
    }
    refreshInFlight = true
    lastRefreshAt = Date()
    let probe = Self.applicationIsNotResponding
    Task { [weak self, candidates, probe] in
      let reported = await Task.detached(priority: .utility) {
        candidates.filter { probe($0.pid) }.map { ReportedApplication(pid: $0.pid, name: $0.name) }
      }.value
      self?.finishRefresh(reported)
    }
  }

  private func finishRefresh(_ applications: [ReportedApplication]) {
    refreshInFlight = false
    reportedApplications = applications.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    if !applications.isEmpty {
      logger.warning("Commander detected \(applications.count, privacy: .public) unresponsive application(s)")
    }
  }

  nonisolated static func errorMeansNotResponding(_ error: AXError) -> Bool {
    error == .cannotComplete
  }

  private nonisolated static func applicationIsNotResponding(_ pid: pid_t) -> Bool {
    let element = AXUIElementCreateApplication(pid)
    guard AXUIElementSetMessagingTimeout(element, 0.2) == .success else { return false }
    var role: CFTypeRef?
    return errorMeansNotResponding(
      AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
    )
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
    guard pid > 1, pid != getpid(), responsiveness.isReportedUnresponsive(pid) else {
      throw ApplicationControlError.notReportedUnresponsive
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
  case notReportedUnresponsive
  case noLongerRunning
  case cannotRestart(String)
  case notAccepted(String)

  var errorDescription: String? {
    switch self {
    case .notReportedUnresponsive:
      "That app is no longer reported as not responding. Refresh Activity and try again if needed."
    case .noLongerRunning:
      "That app has already quit."
    case .cannotRestart(let name):
      "Commander cannot find the app bundle needed to restart \(name)."
    case .notAccepted(let name):
      "macOS did not accept the request to quit \(name)."
    }
  }
}
