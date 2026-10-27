import AuthenticationServices
import LocalAuthentication
import SwiftUI
import OSLog
import ThingtimePasswordCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif
@MainActor final class ProviderViewModel: ObservableObject {
    struct Choice: Identifiable { let id: String; let title: String; let detail: String; let select: () -> Void }
    @Published var title = "Thingtime"
    @Published var message = ""
    @Published var busy = false
    @Published var status = ""
    @Published var choices: [Choice] = []
    @Published var retry: (() -> Void)?
    var cancel: () -> Void = {}
}
private struct ProviderView: View {
    @ObservedObject var model: ProviderViewModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(model.title).font(.title2).bold()
            if !model.message.isEmpty { Text(model.message).font(.callout).fixedSize(horizontal: false, vertical: true) }
            if !model.status.isEmpty {
                HStack(spacing: 8) {
                    if model.busy { ProgressView().controlSize(.small) }
                    Text(model.status).font(.callout).fixedSize(horizontal: false, vertical: true)
                }.accessibilityElement(children: .combine)
            }
            if let retry = model.retry {
                Button("Try again", action: retry).disabled(model.busy)
            } else {
                ScrollView { VStack(alignment: .leading, spacing: 10) {
                    ForEach(model.choices) { choice in
                        Button(action: choice.select) { VStack(alignment: .leading) { Text(choice.title).bold(); Text(choice.detail).font(.caption) }.frame(maxWidth: .infinity, alignment: .leading).padding(8) }.disabled(model.busy)
                    }
                } }
            }
            HStack { Spacer(); Button("Cancel", action: model.cancel) }
        }.padding(24).frame(minWidth: 300, minHeight: 250)
    }
}
@MainActor final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let model = ProviderViewModel()
    private var task: Task<Void, Never>?
    private var authentication: LAContext?
    private var requests = PasswordProviderRequests()
    private let logger = Logger(subsystem: "com.thingtime.passwords.provider", category: "requests")
    private var phase = PasswordProviderPhase.connection
    private var registrationAttempt: PasskeyRegistrationAttempt?
    private var registrationSession: ProviderSession?
    private var registrationAcknowledged = false
    private var registrationStart = PasswordProviderRegistrationStart()
    private var registrationRequest: ASPasskeyCredentialRequest?

    private func show(_ phase: PasswordProviderPhase) {
        self.phase = phase; model.status = phase.message
        logger.info("Request progress: phase=\(phase.rawValue, privacy: .public) code=started")
    }
    override func loadView() {
        let root = ProviderView(model: model)
#if os(macOS)
        let host = NSHostingController(rootView: root)
#else
        let host = UIHostingController(rootView: root)
#endif
        addChild(host); view = host.view
        model.cancel = { [weak self] in self?.cancel() }
    }
#if os(macOS)
    override func viewDidAppear() {
        super.viewDidAppear()
        registrationStart.setVisible(true)
        startRegistrationIfReady()
    }
    override func viewDidDisappear() {
        super.viewDidDisappear()
        registrationStart.setVisible(false)
    }
#else
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        registrationStart.setVisible(true)
        startRegistrationIfReady()
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        registrationStart.setVisible(false)
    }
#endif
    private func beginRequest() {
        registrationStart.reset(); registrationRequest = nil
        requests.reset(); task?.cancel(); task = nil
        authentication?.invalidate(); authentication = nil
        registrationAttempt = nil; registrationSession = nil; registrationAcknowledged = false
        model.title = "Thingtime"
        model.busy = false; model.choices = []; model.retry = nil
        model.message = ""; model.status = ""
    }
    private func cancel(_ code: ASExtensionError.Code = .userCanceled) {
        beginRequest()
        extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: code.rawValue))
    }
    private func perform(_ work: @escaping (UUID) async throws -> Void) {
        // Button disabling is visual feedback; this guard also fences queued clicks.
        guard let current = requests.start() else { return }
        task?.cancel(); authentication?.invalidate()
        model.busy = true; model.message = ""; model.retry = nil; show(.connection)
        task = Task { [weak self] in
            guard let self else { return }
            do { try await work(current) }
            catch {
                if self.requests.isCurrent(current) && !Task.isCancelled {
                    let failure = error as? PasswordProviderError ?? .unavailable
                    // Only closed phase/error categories are logged. Never log
                    // underlying errors, server responses or credential values.
                    self.logger.error("Request failed: phase=\(self.phase.rawValue, privacy: .public) code=\(String(describing: failure), privacy: .public)")
                    self.model.message = self.phase.failure(failure)
                    if failure.allowsRetryInCurrentRequest {
                        self.model.retry = { [weak self] in self?.perform(work) }
                    } else {
                        // Keep pending material fenced to its original session
                        // until cancellation; a new ceremony must start afresh.
                        self.model.retry = nil; self.model.choices = []
                    }
                    self.model.status = ""
                }
            }
            if self.requests.finish(current) {
                self.model.busy = false
                if self.model.status == self.phase.message { self.model.status = "" }
                self.authentication = nil
            }
        }
    }
    private func verify(_ current: UUID, session: ProviderSession) throws {
        try Task.checkCancellation()
        guard requests.isCurrent(current) else { throw CancellationError() }
        try PasswordSessionStore.load().requireUnchanged(from: session)
    }
    private func authenticate(_ current: UUID, session: ProviderSession) async throws {
        show(.verification)
        let context = LAContext(); authentication = context
        do {
            guard try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Use your saved Thingtime credential") else { throw PasswordProviderError.cancelled }
        } catch let error as LAError {
            switch error.code {
            case .userCancel, .appCancel, .systemCancel: throw PasswordProviderError.cancelled
            default: throw PasswordProviderError.unavailable
            }
        }
        try verify(current, session: session)
    }
    private func domains(_ identifiers: [ASCredentialServiceIdentifier]) -> [String] {
        identifiers.compactMap { identifier in
            if identifier.type == .domain { return identifier.identifier.lowercased() }
            guard let url = URL(string: identifier.identifier), url.scheme == "https" else { return nil }
            return url.host?.lowercased()
        }
    }
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) { list(serviceIdentifiers) }
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier], requestParameters: ASPasskeyCredentialRequestParameters) { list(serviceIdentifiers, parameters: requestParameters) }
    @available(iOS 18, macOS 15, *) override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) { list(serviceIdentifiers, otp: true) }
    private func list(_ services: [ASCredentialServiceIdentifier], parameters: ASPasskeyCredentialRequestParameters? = nil, otp: Bool = false) {
        _ = view; beginRequest()
        let hosts = domains(services)
        perform { [weak self] current in
            guard let self else { return }
            let session = try PasswordSessionStore.load(), client = PasswordClient(account: session)
            self.show(.vault)
            let catalog = try await client.catalog(); try self.verify(current, session: session)
            let matches = catalog.filter { item in
                if let rp = item.relyingParty {
                    guard let parameters, rp == parameters.relyingPartyIdentifier, let id = item.credentialId.flatMap({ Data(base64URL: $0) }) else { return false }
                    return parameters.allowedCredentials.isEmpty || parameters.allowedCredentials.contains(id)
                }
                return (otp ? item.hasTotp : item.hasPassword) && (services.isEmpty || item.domains.contains(where: hosts.contains))
            }
            self.model.message = matches.isEmpty ? "No matching credentials. Add this site's exact HTTPS address to an entry in Thingtime." : "Choose an account. Your device will verify you before filling."
            self.model.choices = matches.map { item in .init(id: item.id, title: item.title, detail: item.username, select: { [weak self] in
                self?.select(item.id, hosts: hosts, anySite: services.isEmpty, parameters: parameters, otp: otp)
            }) }
        }
    }
    private func select(_ id: String, hosts: [String], anySite: Bool = false, parameters: ASPasskeyCredentialRequestParameters? = nil, passkeyRequest: ASPasskeyCredentialRequest? = nil, otp: Bool = false) {
        perform { [weak self] current in
            guard let self else { return }
            let session = try PasswordSessionStore.load(), client = PasswordClient(account: session)
            try await self.authenticate(current, session: session)
            self.show(.vault)
            let entry = try await client.read(id); try self.verify(current, session: session)
            self.show(.filling)
            if entry.passwordType == "passkey" {
                let material = try PasskeyMaterial(entry: entry)
                let identity = passkeyRequest?.credentialIdentity as? ASPasskeyCredentialIdentity
                guard let rp = parameters?.relyingPartyIdentifier ?? identity?.relyingPartyIdentifier,
                      let hash = parameters?.clientDataHash ?? passkeyRequest?.clientDataHash,
                      parameters.map({ $0.allowedCredentials.isEmpty || $0.allowedCredentials.contains(material.credentialID) }) ?? (identity?.credentialID == material.credentialID),
                      identity.map({ $0.userHandle == material.userHandle }) ?? true else { throw PasswordProviderError.invalidCredential }
                let signed = try material.assertion(clientDataHash: hash, relyingParty: rp)
                self.extensionContext.completeAssertionRequest(using: ASPasskeyAssertionCredential(userHandle: material.userHandle, relyingParty: rp, signature: signed.signature, clientDataHash: hash, authenticatorData: signed.authenticatorData, credentialID: material.credentialID), completionHandler: nil)
            } else {
                guard anySite || hosts.contains(where: { entry.matches(host: $0) }) else { throw PasswordProviderError.invalidCredential }
                if otp {
                    guard #available(iOS 18, macOS 15, *), let secret = entry.fields.first(where: { $0.type == "totp" && !$0.value.isEmpty })?.value else { throw PasswordProviderError.invalidCredential }
                    self.extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: try TOTP.code(secret)), completionHandler: nil)
                } else {
                    guard !entry.value("password").isEmpty else { throw PasswordProviderError.invalidCredential }
                    self.extensionContext.completeRequest(withSelectedCredential: ASPasswordCredential(user: entry.value("username"), password: entry.value("password")), completionHandler: nil)
                }
            }
            self.model.choices = []
        }
    }
    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) { cancel(.userInteractionRequired) }
    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) { cancel(.userInteractionRequired) }
    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        _ = view; beginRequest()
        guard let id = credentialIdentity.recordIdentifier else { cancel(.credentialIdentityNotFound); return }
        select(id, hosts: domains([credentialIdentity.serviceIdentifier]))
    }
    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        _ = view; beginRequest()
        guard let id = credentialRequest.credentialIdentity.recordIdentifier else { cancel(.credentialIdentityNotFound); return }
        var otp = false
        if #available(iOS 18, macOS 15, *) { otp = credentialRequest is ASOneTimeCodeCredentialRequest }
        select(id, hosts: domains([credentialRequest.credentialIdentity.serviceIdentifier]), passkeyRequest: credentialRequest as? ASPasskeyCredentialRequest, otp: otp)
    }
    override func prepareInterfaceForExtensionConfiguration() {
        _ = view; beginRequest()
        model.message = "Open Thingtime → Passwords → Connect Password AutoFill to use your signed-in account."
        model.choices = [.init(id: "done", title: "Done", detail: "", select: { [weak self] in self?.extensionContext.completeExtensionConfigurationRequest() })]
    }
    override func prepareInterface(forPasskeyRegistration registrationRequest: any ASCredentialRequest) {
        guard let request = registrationRequest as? ASPasskeyCredentialRequest, let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else { cancel(.failed); return }
        // The system can deliver preparation/presentation in either order.
        // Repeated preparation of the same request must not cancel active work
        // or re-arm device verification after a failure.
        if self.registrationRequest === request { startRegistrationIfReady(); return }
        _ = view; beginRequest()
        self.registrationRequest = request
        model.title = "Save a passkey in Thingtime"
        model.message = "\(identity.userName) · \(identity.relyingPartyIdentifier)"
        registrationStart.prepare()
        startRegistrationIfReady()
    }
    private func startRegistrationIfReady() {
        guard let request = registrationRequest,
              let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity,
              registrationStart.takeStart() else { return }
        register(request, identity: identity)
    }
    private func register(_ request: ASPasskeyCredentialRequest, identity: ASPasskeyCredentialIdentity) {
        perform { [weak self] current in
            guard let self else { return }
            guard request.clientDataHash.count == 32, request.supportedAlgorithms.contains(.ES256) else { throw PasswordProviderError.unsupportedAlgorithm }
            let session = try PasswordSessionStore.load(), client = PasswordClient(account: session)
            if let priorSession = self.registrationSession {
                try session.requireUnchanged(from: priorSession)
            }
            try await self.authenticate(current, session: session)
            self.show(.vault)
            let catalog = try await client.catalog(); try self.verify(current, session: session)
            if #available(iOS 18, macOS 15, *), let excluded = request.excludedCredentials {
                guard !catalog.contains(where: { item in item.relyingParty == identity.relyingPartyIdentifier && item.credentialId.flatMap({ Data(base64URL: $0) }).map({ id in excluded.contains { $0.credentialID == id } }) == true }) else { throw PasswordProviderError.invalidCredential }
            }
            // Retain the immutable payload and idempotency identity until this
            // system request ends, including a timeout after the server commits.
            if self.registrationAttempt == nil {
                self.registrationAttempt = try PasskeyRegistrationAttempt(relyingParty: identity.relyingPartyIdentifier, userHandle: identity.userHandle, username: identity.userName)
                self.registrationSession = session
            }
            guard let attempt = self.registrationAttempt else { throw PasswordProviderError.unavailable }
            let key = attempt.key, id = attempt.recordID
            if !self.registrationAcknowledged {
                self.show(.saving)
                _ = try await client.save(key.entry, id: id, writeId: attempt.writeID)
                try self.verify(current, session: session)
                self.registrationAcknowledged = true
            }
            // Never report a usable passkey until encrypted server persistence is
            // acknowledged and the same local Thingtime session is still active.
            try self.verify(current, session: session)
            self.show(.confirming)
            let stored = try await client.read(id)
            guard try attempt.matches(stored) else { throw PasswordProviderError.unavailable }
            try self.verify(current, session: session)
            self.show(.indexing)
            try await PasswordIdentityIndex.savePasskey(key, recordID: id)
            try self.verify(current, session: session)
            self.show(.filling)
            self.extensionContext.completeRegistrationRequest(using: ASPasskeyRegistrationCredential(relyingParty: key.relyingParty, clientDataHash: request.clientDataHash, credentialID: key.credentialID, attestationObject: try key.registration()), completionHandler: nil)
            self.model.choices = []
            self.registrationAttempt = nil; self.registrationSession = nil
        }
    }
}
