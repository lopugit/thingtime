import Combine
import Foundation
import ThingtimeRecoveryCore

@MainActor
final class AIIntegrationStore: ObservableObject {
    @Published private(set) var targets: [AIIntegrationTarget] = []
    @Published private(set) var automaticSetup = false
    @Published private(set) var backgroundScheduleEnabled = false
    @Published private(set) var bundledVersion: String?
    @Published private(set) var isWorking = false
    @Published private(set) var workingTargetID: String?
    @Published private(set) var lastChecked: Date?
    @Published private(set) var notice: String?
    @Published private(set) var errorMessage: String?
    @Published private(set) var diagnostics: [String] = []

    private let managerFactory: (URL?) -> AIIntegrationManager
    private let usesInjectedManager: Bool
    let usesIsolatedHome: Bool
    private var didReconcileBackgroundSchedule = false

    init(manager: AIIntegrationManager? = nil) {
        let environment = ProcessInfo.processInfo.environment
        let customHome = environment["THINGTIME_RECOVERY_INTEGRATION_HOME"].flatMap { $0.hasPrefix("/") ? URL(fileURLWithPath: $0) : nil }
        let customBundle = environment["THINGTIME_RECOVERY_INTEGRATION_BUNDLE"].flatMap { $0.hasPrefix("/") ? URL(fileURLWithPath: $0) : nil }
        usesIsolatedHome = customHome != nil
        usesInjectedManager = manager != nil
        managerFactory = { selectedBundle in
            manager ?? AIIntegrationManager(
                homeDirectory: customHome ?? FileManager.default.homeDirectoryForCurrentUser,
                bundleDirectory: customBundle ?? selectedBundle ?? (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("AIIntegrationBundle"),
                applicationDirectories: customHome.map { [$0.appendingPathComponent("Applications")] },
                environment: customHome.map { ["PATH": $0.appendingPathComponent("bin").path, "CODEX_HOME": $0.appendingPathComponent(".codex").path] } ?? environment
            )
        }
    }

    func checkNow() async {
        guard !isWorking else { return }
        let reconcile = !usesIsolatedHome && !didReconcileBackgroundSchedule
        didReconcileBackgroundSchedule = true
        await perform(reconcileSchedule: reconcile, refreshSource: true) { manager in manager.sync() }
    }

    func install(_ target: AIIntegrationTarget) async {
        await perform(targetID: target.id) { [target] manager in [try manager.install(target: target)] }
    }

    func uninstall(_ target: AIIntegrationTarget) async {
        await perform(targetID: target.id) { [target] manager in [try manager.uninstall(target: target)] }
    }

    func rollback(_ target: AIIntegrationTarget) async {
        await perform(targetID: target.id) { [target] manager in [try manager.rollback(target: target)] }
    }

    func setAutoUpdate(_ enabled: Bool, for target: AIIntegrationTarget) async {
        await perform(targetID: target.id) { [target] manager in
            try manager.setAutoUpdate(target: target, enabled: enabled)
            return []
        }
    }

    func setPinned(_ pinned: Bool, for target: AIIntegrationTarget) async {
        await perform(targetID: target.id) { [target] manager in
            try manager.setPinned(target: target, version: pinned ? target.installedVersion : nil)
            return []
        }
    }

    func setAutomaticSetup(_ enabled: Bool) async {
        guard !isWorking else { return }
        let previousValue = automaticSetup
        let isolated = usesIsolatedHome
        await perform { manager in
            try manager.setAutomaticSetup(enabled)
            do {
                if !isolated { try AIIntegrationBackgroundService().setEnabled(Self.needsBackgroundSchedule(manager.state())) }
            } catch {
                try? manager.setAutomaticSetup(previousValue)
                throw error
            }
            return enabled ? manager.sync() : []
        }
    }

    var needsBackgroundSchedule: Bool {
        automaticSetup || targets.contains { $0.installedVersion != nil && $0.autoUpdate && $0.pinnedVersion == nil }
    }

    private nonisolated static func needsBackgroundSchedule(_ state: AIIntegrationState) -> Bool {
        state.automaticSetup || state.targets.contains { $0.installedVersion != nil && $0.autoUpdate && $0.pinnedVersion == nil }
    }

    // One foreground operation owns discovery and publication. Keeping the old
    // rows until a complete snapshot arrives prevents an empty list on failure.
    private func perform(targetID: String? = nil, reconcileSchedule: Bool = true, refreshSource: Bool = false, operation: @escaping (AIIntegrationManager) throws -> [AIIntegrationResult]) async {
        guard !isWorking else { return }
        isWorking = true
        workingTargetID = targetID
        errorMessage = nil
        notice = nil
        defer { isWorking = false; workingTargetID = nil }
        let isolated = usesIsolatedHome
        var updateWarning: String?
        var selectedBundle: URL?
        if !isolated && !usesInjectedManager {
            let source = AIIntegrationUpdateSource()
            do {
                selectedBundle = try await Task.detached(priority: .utility) { try source.currentBundle() }.value
            } catch {
                updateWarning = "The saved update bundle could not be verified: \(error.localizedDescription) Using the installed Recovery bundle."
            }
            if refreshSource {
                let currentManager = managerFactory(selectedBundle)
                let state = await Task.detached(priority: .utility) { currentManager.state() }.value
                if Self.needsBackgroundSchedule(state) {
                    do {
                        if let refreshed = try await source.refresh() {
                            selectedBundle = refreshed
                            updateWarning = nil
                        }
                    }
                    catch {
                        updateWarning = "Could not check for a verified integration update: \(error.localizedDescription) Using the last verified or installed Recovery bundle; try Check Now again later."
                    }
                }
            }
        }
        let manager = managerFactory(selectedBundle)
        do {
            let output = try await Task.detached(priority: .utility) {
                var results = try operation(manager)
                let state = manager.state()
                if reconcileSchedule && !isolated {
                    let service = AIIntegrationBackgroundService()
                    let needed = Self.needsBackgroundSchedule(state)
                    if service.isEnabled != needed {
                        do { try service.setEnabled(needed) }
                        catch {
                            results.append(AIIntegrationResult(targetID: "background-schedule", success: false, message: "Background schedule could not be updated: \(error.localizedDescription) Checks continue while Recovery is open."))
                        }
                    }
                }
                return (results, state.targets, state, !isolated && AIIntegrationBackgroundService().isEnabled)
            }.value
            targets = output.1
            automaticSetup = output.2.automaticSetup
            backgroundScheduleEnabled = output.3
            bundledVersion = output.2.latestVersion
            diagnostics = output.2.diagnostics
            lastChecked = Date()
            var failures = output.0.filter { !$0.success }.map(\.message)
            if let updateWarning { failures.append(updateWarning) }
            if !failures.isEmpty { errorMessage = failures.joined(separator: "\n") }
            let successes = output.0.filter(\.success).map(\.message)
            if !successes.isEmpty { notice = successes.joined(separator: "\n") }
        } catch {
            errorMessage = [error.localizedDescription, updateWarning].compactMap { $0 }.joined(separator: "\n")
        }
    }
}
