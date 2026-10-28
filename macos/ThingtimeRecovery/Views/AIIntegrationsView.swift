import SwiftUI
import ThingtimeRecoveryCore

struct AIIntegrationsView: View {
    @ObservedObject var store: AIIntegrationStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("AI Apps").font(.largeTitle.bold())
                        Text("Connect your AI apps to Thingtime.").foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { Task { await store.checkNow() } } label: {
                        Label("Check Now", systemImage: "arrow.clockwise")
                    }
                    .disabled(store.isWorking)
                    .accessibilityIdentifier("ai-apps-check-now")
                    .help("Discover installed apps and update integrations with automatic updates enabled")
                }
                Toggle(isOn: Binding(get: { store.automaticSetup }, set: { enabled in Task { await store.setAutomaticSetup(enabled) } })) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Automatic setup").font(.headline)
                        Text(store.usesIsolatedHome ? "Set up newly discovered supported apps. Individual app switches control updates; this test app checks only while open." : "Set up newly discovered supported apps. Individual app switches control updates, even when automatic setup is off.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .toggleStyle(.switch)
                .accessibilityIdentifier("ai-apps-automatic-setup")
                .disabled(store.isWorking)
                if store.needsBackgroundSchedule && !store.usesIsolatedHome {
                    Label(store.backgroundScheduleEnabled ? "Background schedule configured · checks every hour" : "Background schedule unavailable · checks only while Recovery is open", systemImage: store.backgroundScheduleEnabled ? "clock.arrow.circlepath" : "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(store.backgroundScheduleEnabled ? Color.secondary : Color.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    if store.isWorking { ProgressView().controlSize(.small); Text("Checking AI app integrations…") }
                    else if let date = store.lastChecked { Text("Checked \(date.formatted(date: .omitted, time: .shortened))") }
                    else { Text("Discovering installed apps") }
                    Spacer()
                    Text("Available bundle: \(store.bundledVersion ?? "unavailable")")
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            .padding(24)
            Divider()
            ScrollView {
              LazyVStack(alignment: .leading, spacing: 16) {
                if let error = store.errorMessage {
                    Label { Text(error).textSelection(.enabled) } icon: { Image(systemName: "exclamationmark.triangle") }
                        .foregroundStyle(.red).padding(.vertical, 6)
                }
                if let notice = store.notice {
                    Label { Text(notice).textSelection(.enabled) } icon: { Image(systemName: "checkmark.circle") }
                        .padding(.vertical, 6)
                }
                ForEach(store.targets) { target in
                    VStack(alignment: .leading, spacing: 16) {
                        AIIntegrationTargetRow(target: target, store: store)
                            .padding(.vertical, 4)
                        Divider()
                    }
                }
                if store.targets.isEmpty && !store.isWorking {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("No AI apps discovered").font(.headline)
                        Text("Install a supported AI app, then choose Check Now. Existing app settings are preserved.")
                            .foregroundStyle(.secondary)
                    }.padding(.vertical, 16)
                }
                Section {
                    Text("Recovery keeps enabled integrations up to date using verified Thingtime releases. Pinned versions stay unchanged. After installation, your AI app may ask you to restart or sign in to Thingtime.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    ForEach(Array(store.diagnostics.enumerated()), id: \.offset) { _, diagnostic in
                        Text(diagnostic).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
              }
              .padding(24)
            }
            .frame(minHeight: 0, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct AIIntegrationTargetRow: View {
    let target: AIIntegrationTarget
    @ObservedObject var store: AIIntegrationStore
    @State private var expanded = false
    @State private var pendingRemoval = false

    private var managed: Bool { target.installedVersion != nil }
    private var supported: Bool { target.supportsMCP || target.supportsSkills }
    private var canInstall: Bool { supported && target.status != .conflict && target.status != .unsupported && target.status != .manual }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "app.connected.to.app.below.fill").font(.title2).foregroundStyle(.secondary).frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 5) {
                    Text(target.title).font(.headline)
                    Text(statusText).font(.subheadline).foregroundStyle(target.status == .conflict ? Color.orange : Color.secondary)
                    Text("MCP: \(target.supportsMCP ? "supported" : "manual setup") · Skills: \(target.supportsSkills ? "supported" : "not supported")")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if store.workingTargetID == target.id { ProgressView().controlSize(.small) }
                if canInstall {
                    Button(managed ? "Update" : "Install") { Task { await store.install(target) } }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("\(managed ? "Update" : "Install") Thingtime for \(target.title)")
                        .accessibilityIdentifier("ai-app-\(target.id)-install")
                        .disabled(store.isWorking || (target.status == .installed && target.installedVersion == target.latestVersion))
                        .help("\(managed ? "Update" : "Install") the Thingtime integration for \(target.title)")
                }
            }
            DisclosureGroup("Details and options", isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Installed: \(target.installedVersion ?? "not managed") · Available in bundle: \(target.latestVersion ?? "unavailable")")
                        .font(.caption).textSelection(.enabled)
                    if let conflict = target.conflictReason {
                        Label(conflict, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    }
                    if let manual = target.manualSetup {
                        Text(manual).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    }
                    if let link = setupURL {
                        Link("Setup documentation", destination: link)
                            .accessibilityLabel("Setup documentation for \(target.title)")
                            .accessibilityIdentifier("ai-app-\(target.id)-documentation")
                    }
                    path("App", values: target.applicationPaths)
                    path("Command", values: target.binaryPaths)
                    path("MCP settings", values: target.configurationPath.map { [$0] } ?? [])
                    path("Skills", values: target.skillPath.map { [$0] } ?? [])
                    if supported {
                        Toggle("Automatic updates for \(target.title)", isOn: Binding(get: { target.autoUpdate }, set: { enabled in Task { await store.setAutoUpdate(enabled, for: target) } }))
                            .accessibilityIdentifier("ai-app-\(target.id)-auto-update")
                            .disabled(store.isWorking)
                        if managed {
                            Toggle("Pin installed version\(target.pinnedVersion.map { " (\($0))" } ?? "")", isOn: Binding(get: { target.pinnedVersion != nil }, set: { enabled in Task { await store.setPinned(enabled, for: target) } }))
                                .accessibilityLabel("Pin installed version for \(target.title)")
                                .accessibilityIdentifier("ai-app-\(target.id)-pin")
                                .disabled(store.isWorking)
                            HStack {
                                Button("Roll Back") { Task { await store.rollback(target) } }
                                    .accessibilityLabel("Roll back Thingtime for \(target.title)")
                                    .accessibilityIdentifier("ai-app-\(target.id)-rollback")
                                    .help("Restore the previous manager-owned integration when a backup exists")
                                Button("Uninstall…", role: .destructive) { pendingRemoval = true }
                                    .accessibilityLabel("Uninstall Thingtime from \(target.title)")
                                    .accessibilityIdentifier("ai-app-\(target.id)-uninstall")
                            }
                            .buttonStyle(.bordered)
                            .disabled(store.isWorking)
                            Text("Rollback and uninstall only change integration files owned by this manager. Restart the AI app after changes; complete sign-in there if prompted.")
                                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
            }
            .font(.callout)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ai-app-\(target.id)")
        .confirmationDialog("Remove the managed Thingtime integration from \(target.title)?", isPresented: $pendingRemoval, titleVisibility: .visible) {
            Button("Uninstall Integration", role: .destructive) { Task { await store.uninstall(target) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The app and unrelated settings will be kept. Only changes owned by this manager will be removed.")
        }
    }

    @ViewBuilder private func path(_ label: String, values: [String]) -> some View {
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                ForEach(values, id: \.self) { value in
                    Text(value).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var statusText: String {
        switch target.status {
        case .available: return "Ready to install"
        case .installed: return target.pinnedVersion == nil ? "Up to date" : "Installed · pinned"
        case .updateAvailable: return target.pinnedVersion == nil ? "Update available" : "Update available · pinned"
        case .conflict: return "Needs attention · settings preserved"
        case .manual: return "Connection managed in the app"
        case .unsupported: return "Automatic setup unavailable"
        }
    }

    private var setupURL: URL? {
        let address: String
        switch target.kind {
        case .chatGPT: address = "https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt"
        case .claudeDesktop: address = "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
        case .claudeCode: address = "https://code.claude.com/docs/en/mcp"
        case .codex: address = "https://developers.openai.com/codex/mcp"
        case .copilot: address = "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers"
        case .cursor: address = "https://docs.cursor.com/context/model-context-protocol"
        case .vscode: address = "https://code.visualstudio.com/docs/copilot/customization/mcp-servers"
        case .windsurf: address = "https://docs.windsurf.com/windsurf/cascade/mcp"
        case .gemini: address = "https://geminicli.com/docs/tools/mcp-server/"
        case .openCode: address = "https://opencode.ai/docs/mcp-servers/"
        case .unsupported: return nil
        }
        return URL(string: address)
    }
}
