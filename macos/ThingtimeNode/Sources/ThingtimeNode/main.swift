import AppKit
import Darwin
import Foundation
import Security
import ThingtimeNodeCore

private final class XPCService: NSObject, ThingtimeNodeXPCProtocol {
    private let controller: ThingtimeNodeController

    init(controller: ThingtimeNodeController) {
        self.controller = controller
    }

    func request(_ data: Data, withReply reply: @escaping (Data) -> Void) {
        let request: NodeRequest
        do {
            request = try NodeWireCodec.decodeRequest(data)
        } catch let error as ThingtimeNodeError {
            reply(Self.encoded(.failure(id: "", code: error.code, message: error.localizedDescription)))
            return
        } catch {
            reply(Self.encoded(.failure(id: "", code: "invalid_request", message: "The XPC request is invalid.")))
            return
        }

        Task {
            let access = ThingtimeNodeXPCRequestPolicy.access(for: request.method)
            guard access != .forbidden else {
                reply(Self.encoded(.failure(
                    id: request.id,
                    code: "xpc_method_forbidden",
                    message: "This operation is not available through the local setup bridge."
                )))
                return
            }
            if access == .pairingMutation || access == .permissionMutation {
                let approved = await LocalPairingPresenceGate.shared.confirm(method: request.method)
                guard approved else {
                    reply(Self.encoded(.failure(
                        id: request.id,
                        code: "user_presence_required",
                        message: "The pairing operation was not confirmed on this Mac."
                    )))
                    return
                }
            }
            let response = await controller.handle(request)
            reply(Self.encoded(response))
        }
    }

    private static func encoded(_ response: NodeResponse) -> Data {
        (try? NodeWireCodec.encodeResponse(response))
            ?? Data(#"{"error":{"code":"encoding_error","message":"The node response could not be encoded."},"id":"","ok":false}"#.utf8)
    }
}

@MainActor
private final class LocalPairingPresenceGate {
    static let shared = LocalPairingPresenceGate()

    private var presenting = false
	private weak var activeAlert: NSAlert?
	private var timeoutTimer: Timer?

    func confirm(method: String) -> Bool {
        guard !presenting else { return false }
        presenting = true
		defer {
			timeoutTimer?.invalidate()
			timeoutTimer = nil
			activeAlert = nil
			presenting = false
		}

        let alert = NSAlert()
        alert.alertStyle = .warning
        if method == "pairing.unpair" {
            alert.messageText = "Allow Thingtime to unpair this Mac?"
        } else if method == "permissions.request" {
            alert.messageText = "Allow Thingtime Node to request a macOS permission?"
        } else {
            alert.messageText = "Allow Thingtime to pair this Mac?"
        }
        alert.informativeText = "Only continue if you just requested this action in the Thingtime desktop app."
        alert.addButton(withTitle: "Allow")
        alert.addButton(withTitle: "Cancel")
		activeAlert = alert
		let timeout = ThingtimeNodeXPCRequestPolicy.confirmationTimeoutSeconds(for: method)
		if timeout > 0 {
			timeoutTimer = Timer.scheduledTimer(
				timeInterval: timeout,
				target: self,
				selector: #selector(expireConfirmation(_:)),
				userInfo: nil,
				repeats: false
			)
		}
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertFirstButtonReturn
    }

	@objc private func expireConfirmation(_ timer: Timer) {
		guard presenting, timer === timeoutTimer else { return }
		NSApp.abortModal()
		activeAlert?.window.orderOut(nil)
	}
}

private struct PeerSignatureValidator {
    private let teamIdentifier: String?
    private let allowedIdentifiers: [String]
    private let allowsUnsignedDistribution: Bool

    init() {
        teamIdentifier = Self.currentTeamIdentifier()
        allowsUnsignedDistribution = ProcessInfo.processInfo.environment["THINGTIME_NODE_UNSIGNED_DISTRIBUTION"] == "1"
        let configured = ProcessInfo.processInfo.environment["THINGTIME_NODE_ALLOWED_CLIENT_IDENTIFIERS"]
            .map { $0.split(separator: ",").map { String($0) } }
        allowedIdentifiers = (configured ?? [
            "com.thingtime.desktop",
            "com.thingtime.desktop.node",
            "com.thingtime.desktop.node.bridge"
        ])
            .filter {
                !$0.isEmpty
                    && $0.utf8.count <= 255
                    && $0.range(of: #"^[A-Za-z0-9.-]+$"#, options: .regularExpression) != nil
            }
    }

    func accepts(_ connection: NSXPCConnection) -> Bool {
        guard connection.effectiveUserIdentifier == getuid() else { return false }
        guard !allowedIdentifiers.isEmpty else { return false }

        var guest: SecCode?
        let attributes = [kSecGuestAttributePid as String: NSNumber(value: connection.processIdentifier)] as CFDictionary
        guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &guest) == errSecSuccess,
              let guest else { return false }

        if allowsUnsignedDistribution {
            var requirement: SecRequirement?
            guard SecRequirementCreateWithString("identifier \"com.thingtime.desktop.node.bridge\"" as CFString, [], &requirement) == errSecSuccess,
                  let requirement else { return false }
            return SecCodeCheckValidity(guest, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess
        }

        guard let teamIdentifier,
              teamIdentifier.range(of: #"^[A-Z0-9]{10}$"#, options: .regularExpression) != nil else {
            // A Mach service that is not stably signed must not accept control
            // requests from arbitrary same-user processes.
            return false
        }

        var requirement: SecRequirement?
        let identifiers = allowedIdentifiers.map { "identifier \"\($0)\"" }.joined(separator: " or ")
        let source = "anchor apple generic and certificate leaf[subject.OU] = \"\(teamIdentifier)\" and (\(identifiers))" as CFString
        guard SecRequirementCreateWithString(source, [], &requirement) == errSecSuccess,
              let requirement else { return false }
        return SecCodeCheckValidity(guest, [], requirement) == errSecSuccess
    }

    private static func currentTeamIdentifier() -> String? {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess,
              let staticCode else { return nil }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
              let dictionary = information as? [String: Any] else { return nil }
        return dictionary[kSecCodeInfoTeamIdentifier as String] as? String
    }
}

private final class XPCListenerDelegate: NSObject, NSXPCListenerDelegate {
    private let service: XPCService
    private let validator = PeerSignatureValidator()

    init(service: XPCService) {
        self.service = service
    }

    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        guard validator.accepts(connection) else {
            ThingtimeNodeLog.lifecycle.error("Rejected an XPC connection that did not meet the peer requirement")
            return false
        }
        connection.exportedInterface = NSXPCInterface(with: ThingtimeNodeXPCProtocol.self)
        connection.exportedObject = service
        connection.resume()
        return true
    }
}

private actor NodeControllerRelay {
    private var controller: ThingtimeNodeController?

    func install(_ controller: ThingtimeNodeController) {
        self.controller = controller
    }

    func dispatch(_ command: LeasedCommand) async -> NodeResponse {
        guard let controller else {
            return .failure(
                id: command.leaseID,
                code: ThingtimeNodeError.commandOutcomeUncertain.code,
                message: "Thingtime was still starting, so the command was not run."
            )
        }
        return await controller.handleLeasedCommand(command)
    }
}

private actor MultiAccountControlPlaneRuntime {
    private struct AccountRuntime {
        let refreshToken: String
        let scheduler: ControlPlaneScheduler
        let liveSync: LiveAISyncCoordinator
        let flushTask: Task<Void, Never>
    }

    private let baseURL: URL
    private let endpointScope: ThingtimeNodeEndpointScope
    private let credentialStore: any DeviceCredentialStore
    private let telemetry: DeviceTelemetryCollector
    private let connector: ConnectorRuntime
    private let desktopChat: DesktopChatRuntime
    private let controllerRelay: NodeControllerRelay
    private var accounts: [String: AccountRuntime] = [:]

    init(
        baseURL: URL,
        endpointScope: ThingtimeNodeEndpointScope,
        credentialStore: any DeviceCredentialStore,
        telemetry: DeviceTelemetryCollector,
        connector: ConnectorRuntime,
        desktopChat: DesktopChatRuntime,
        controllerRelay: NodeControllerRelay
    ) {
        self.baseURL = baseURL
        self.endpointScope = endpointScope
        self.credentialStore = credentialStore
        self.telemetry = telemetry
        self.connector = connector
        self.desktopChat = desktopChat
        self.controllerRelay = controllerRelay
    }

    func reconcile() async throws {
        let credentials = try await credentialStore.loadAll()
        let desired = Dictionary(uniqueKeysWithValues: credentials.map { ($0.deviceID, $0) })

        for deviceID in accounts.keys where desired[deviceID] == nil {
            await stopAccount(deviceID)
        }
        for credential in credentials {
            if let current = accounts[credential.deviceID], current.refreshToken == credential.refreshToken {
                continue
            }
            if accounts[credential.deviceID] != nil { await stopAccount(credential.deviceID) }
            try await startAccount(credential)
        }
    }

    func captureConnectorEvent(_ event: ConnectorEvent) async {
        for (deviceID, runtime) in accounts.sorted(by: { $0.key < $1.key }) {
            do {
                try await runtime.liveSync.bindPairing(deviceID: deviceID)
                _ = try await runtime.liveSync.captureConnectorEvent(event)
            } catch {
                ThingtimeNodeLog.connector.error(
                    "Live AI event capture failed for a paired account: \(error.localizedDescription, privacy: .public)"
                )
            }
        }
    }

    func stop() async {
        for deviceID in Array(accounts.keys) { await stopAccount(deviceID) }
    }

    private func startAccount(_ credential: DeviceCredential) async throws {
        let deviceID = credential.deviceID
        let fixedStore = InMemoryDeviceCredentialStore(credential: credential)
        let client = try ThingtimeAPIClient(baseURL: baseURL, credentialStore: fixedStore)
        let liveSync = try LiveAISyncCoordinator(
            fileURL: endpointScope.liveAIJournalFileURL(deviceID: deviceID)
        ) { body in
            try await client.syncLiveAI(body)
        }
        try await liveSync.bindPairing(deviceID: deviceID)

        let telemetry = telemetry
        let connector = connector
        let desktopChat = desktopChat
        let controllerRelay = controllerRelay
        let scheduler = ControlPlaneScheduler(
            client: client,
            hooks: ControlPlaneSchedulerHooks(
                makeHeartbeat: {
                    await DeviceHeartbeat(
                        deviceID: deviceID,
                        telemetry: telemetry.snapshot(),
                        connector: connector.health(),
                        connectorProjects: connector.cachedProjectReferences(),
                        additionalConnectors: desktopChat.connectorStates()
                    )
                },
                dispatchCommand: { command in
                    let response = await controllerRelay.dispatch(command)
                    do {
                        _ = try await liveSync.captureSuccessfulLeasedResponse(command: command, response: response)
                    } catch {
                        ThingtimeNodeLog.connector.error(
                            "Live AI command capture failed for a paired account: \(error.localizedDescription, privacy: .public)"
                        )
                    }
                    return response
                },
                reportError: { error in
                    ThingtimeNodeLog.lifecycle.error(
                        "Control-plane cycle failed for a paired account: \(error.localizedDescription, privacy: .public)"
                    )
                }
            )
        )
        let flushTask = Task {
            while !Task.isCancelled {
                let retryDelay: Duration
                do {
                    _ = try await liveSync.flush(maximumRequests: 8)
                    retryDelay = .seconds(2)
                } catch {
                    ThingtimeNodeLog.connector.error(
                        "Live AI sync failed for a paired account; the durable outbox will retry: \(error.localizedDescription, privacy: .public)"
                    )
                    retryDelay = .seconds(10)
                }
                do {
                    try await Task.sleep(for: retryDelay)
                } catch {
                    return
                }
            }
        }
        accounts[deviceID] = AccountRuntime(
            refreshToken: credential.refreshToken,
            scheduler: scheduler,
            liveSync: liveSync,
            flushTask: flushTask
        )
        await scheduler.start()
    }

    private func stopAccount(_ deviceID: String) async {
        guard let runtime = accounts.removeValue(forKey: deviceID) else { return }
        runtime.flushTask.cancel()
        await runtime.scheduler.stop()
        await runtime.flushTask.value
    }
}

@MainActor
private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    // Construct telemetry with the delegate, before NSApplication begins its
    // launch notifications. An agent restarted inside an inactive/locked Aqua
    // session then observes sessionDidResignActive before did-finish instead of
    // briefly treating that session as unlocked.
    private let telemetry = DeviceTelemetryCollector()
    private var controller: ThingtimeNodeController?
    private var connectorRuntime: ConnectorRuntime?
    private var desktopChatRuntime: DesktopChatRuntime?
    private var controlPlaneRuntime: MultiAccountControlPlaneRuntime?
    private var liveSyncEventTask: Task<Void, Never>?
    private var desktopChatEventTask: Task<Void, Never>?
    private var listener: NSXPCListener?
    private var listenerDelegate: XPCListenerDelegate?
    private var summaryItem: NSMenuItem?
    private let launchdManaged = ProcessInfo.processInfo.environment["THINGTIME_NODE_MACH_SERVICE"] == "1"

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        telemetry.establishSessionActivityAfterApplicationLaunch()
        configureMenu()
        do {
            let telemetry = self.telemetry
            let baseURL = try apiBaseURL()
            let endpointScope = try ThingtimeNodeEndpointScope(baseURL: baseURL)
            let journal = try CommandJournal(fileURL: endpointScope.commandJournalFileURL())
            let credentialStore = KeychainDeviceCredentialStore(
                account: endpointScope.credentialAccount,
                legacyAccount: endpointScope.legacyCredentialAccount
            )
            let pairing = PairingManager(store: credentialStore)
            let connectorConfiguration = try connectorConfiguration()
            let connector = ConnectorRuntime(configuration: connectorConfiguration)
            let desktopChat = DesktopChatRuntime(
                connector: DesktopChatAccessibilityConnector(
                    backend: SystemDesktopChatAccessibilityBackend()
                )
            )
            let actionExecutor = SafeActionExecutor(telemetry: telemetry)
            let apiClient = try ThingtimeAPIClient(
                baseURL: endpointScope.canonicalBaseURL,
                credentialStore: credentialStore
            )
            let controllerRelay = NodeControllerRelay()
            let controlPlaneRuntime = MultiAccountControlPlaneRuntime(
                baseURL: endpointScope.canonicalBaseURL,
                endpointScope: endpointScope,
                credentialStore: credentialStore,
                telemetry: telemetry,
                connector: connector,
                desktopChat: desktopChat,
                controllerRelay: controllerRelay
            )
            let controller = ThingtimeNodeController(
                journal: journal,
                pairing: pairing,
                connector: connector,
                telemetry: telemetry,
                actionExecutor: actionExecutor,
                controlPlaneClient: apiClient,
                desktopChat: desktopChat,
                pairingScopeChanged: { _ in
                    try await controlPlaneRuntime.reconcile()
                    if try await pairing.status().paired == false {
                        await desktopChat.clearActiveSessions()
                    }
                }
            )
            self.controller = controller
            connectorRuntime = connector
            desktopChatRuntime = desktopChat
            self.controlPlaneRuntime = controlPlaneRuntime
            if ProcessInfo.processInfo.environment["THINGTIME_NODE_MACH_SERVICE"] == "1" {
                let service = XPCService(controller: controller)
                let delegate = XPCListenerDelegate(service: service)
                let listener = NSXPCListener(machServiceName: ThingtimeNodeXPC.machServiceName)
                listener.delegate = delegate
                listener.resume()
                self.listener = listener
                self.listenerDelegate = delegate
            }
            liveSyncEventTask = Task {
                do {
                    await controllerRelay.install(controller)
                    try await controlPlaneRuntime.reconcile()
                } catch {
                    ThingtimeNodeLog.connector.error(
                        "Paired account runtime setup failed closed: \(error.localizedDescription, privacy: .public)"
                    )
                    return
                }
                let events = await connector.events()
                if connectorConfiguration != nil {
                    do {
                        try await connector.start()
                        try await connector.refreshProjectReferences()
                    } catch {
                        ThingtimeNodeLog.connector.error("Connector startup failed: \(error.localizedDescription, privacy: .public)")
                    }
                }
                for await event in events {
                    if Task.isCancelled { return }
                    await controlPlaneRuntime.captureConnectorEvent(event)
                }
            }
            desktopChatEventTask = Task {
                let events = await desktopChat.events()
                await desktopChat.startMonitoring()
                for await event in events {
                    if Task.isCancelled { return }
                    await controlPlaneRuntime.captureConnectorEvent(event)
                }
            }
            refreshStatus(nil)
            ThingtimeNodeLog.lifecycle.info("Thingtime Node started")
        } catch {
            summaryItem?.title = ThingtimeStatusMenuCopy.unavailable
            ThingtimeNodeLog.lifecycle.error("Thingtime Node setup failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        listener?.invalidate()
        liveSyncEventTask?.cancel()
        desktopChatEventTask?.cancel()
        let controlPlaneRuntime = controlPlaneRuntime
        let connector = connectorRuntime
        let desktopChat = desktopChatRuntime
        Task {
            await controlPlaneRuntime?.stop()
            await connector?.stop()
            await desktopChat?.stopMonitoring(clearSessions: true)
        }
        ThingtimeNodeLog.lifecycle.info("Thingtime Node stopped")
    }

    private func configureMenu() {
        let environment = ProcessInfo.processInfo.environment
        let iconID = ThingtimeMenuBarIconID(environmentValue: environment["THINGTIME_NODE_MENU_BAR_ICON"])
        let image = ThingtimeMenuBarIconRenderer.image(
            id: iconID,
            customPath: environment["THINGTIME_NODE_MENU_BAR_CUSTOM_ICON_PATH"]
        )
        statusItem.length = image.size.width + 8
        statusItem.button?.title = ""
        statusItem.button?.image = image
        statusItem.button?.imagePosition = .imageOnly
        statusItem.button?.setAccessibilityLabel("Thingtime")
        let menu = NSMenu()
        let summary = NSMenuItem(title: ThingtimeStatusMenuCopy.starting, action: nil, keyEquivalent: "")
        summary.isEnabled = false
        menu.addItem(summary)
        summaryItem = summary
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: ThingtimeStatusMenuCopy.refreshStatus, action: #selector(refreshStatus(_:)), keyEquivalent: "r"))
        menu.addItem(NSMenuItem(title: ThingtimeStatusMenuCopy.openThingtime, action: #selector(openThingtime(_:)), keyEquivalent: "o"))
        menu.addItem(.separator())
        if launchdManaged {
            menu.addItem(NSMenuItem(title: ThingtimeStatusMenuCopy.restartThingtime, action: #selector(restart(_:)), keyEquivalent: ""))
        }
        menu.addItem(NSMenuItem(title: ThingtimeStatusMenuCopy.quitThingtime, action: #selector(quit(_:)), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        statusItem.menu = menu
    }

    @objc private func refreshStatus(_ sender: Any?) {
        guard let controller else { return }
        Task {
            let response = await controller.handle(NodeRequest(method: "node.status"))
            if response.ok, let status = try? response.result?.decode(NodeStatus.self) {
                summaryItem?.title = ThingtimeStatusMenuCopy.healthy(accountCount: status.pairing.deviceIDs.count)
            } else {
                summaryItem?.title = ThingtimeStatusMenuCopy.degraded
            }
        }
    }

    @objc private func openThingtime(_ sender: Any?) {
        guard let url = URL(string: "things", relativeTo: try? apiBaseURL()) else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func restart(_ sender: Any?) {
        NSApp.terminate(nil)
    }

    @objc private func quit(_ sender: Any?) {
        guard launchdManaged else {
            NSApp.terminate(nil)
            return
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["bootout", "gui/\(getuid())/com.thingtime.desktop.node"]
        do {
            try process.run()
        } catch {
            summaryItem?.title = ThingtimeStatusMenuCopy.couldNotQuit
            ThingtimeNodeLog.lifecycle.error(
                "Thingtime could not stop its login service: \(error.localizedDescription, privacy: .public)"
            )
        }
    }

    private func connectorConfiguration() throws -> ConnectorRuntimeConfiguration? {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["THINGTIME_NODE_CONNECTOR_EXECUTABLE"], !path.isEmpty else { return nil }
        let decoder = JSONDecoder()
        let arguments: [String]
        if let json = environment["THINGTIME_NODE_CONNECTOR_ARGUMENTS_JSON"]?.data(using: .utf8) {
            arguments = try decoder.decode([String].self, from: json)
        } else {
            arguments = []
        }
        let childEnvironment: [String: String]
        if let json = environment["THINGTIME_NODE_CONNECTOR_ENV_JSON"]?.data(using: .utf8) {
            childEnvironment = try decoder.decode([String: String].self, from: json)
        } else {
            childEnvironment = [:]
        }
        return try ConnectorRuntimeConfiguration(
            executableURL: URL(fileURLWithPath: path),
            arguments: arguments,
            environment: childEnvironment
        )
    }

    private func apiBaseURL() throws -> URL {
        let rawValue = ProcessInfo.processInfo.environment["THINGTIME_NODE_API_BASE_URL"]
            ?? "https://thingtime.com/"
        guard var components = URLComponents(string: rawValue),
              components.query == nil,
              components.fragment == nil else {
            throw ThingtimeAPIClientError.invalidBaseURL
        }
        if components.path.isEmpty { components.path = "/" }
        guard components.path.hasSuffix("/"), let url = components.url else {
            throw ThingtimeAPIClientError.invalidBaseURL
        }
        return url
    }
}

@main
private enum ThingtimeNodeApplication {
    @MainActor
    static func main() {
        if Bundle.main.object(forInfoDictionaryKey: "ThingtimeNodeElectronManaged") as? Bool == true,
           ProcessInfo.processInfo.environment["THINGTIME_NODE_MACH_SERVICE"] != "1" {
            // System Settings may relaunch a TCC client through LaunchServices.
            // The Electron-embedded helper is launchd-owned, so that unmanaged
            // copy exits before creating a second menu item or control loop.
            exit(EXIT_SUCCESS)
        }
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.run()
    }
}
