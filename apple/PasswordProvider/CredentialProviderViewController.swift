import AuthenticationServices
import LocalAuthentication
import SwiftUI
import ThingtimePasswordCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif
@MainActor final class ProviderViewModel: ObservableObject {
    struct Choice: Identifiable { let id: String; let title: String; let detail: String; let select: () -> Void }
    @Published var title = "Thingtime Passwords"
    @Published var message = ""
    @Published var busy = false
    @Published var choices: [Choice] = []
    var cancel: () -> Void = {}
}
private struct ProviderView: View {
    @ObservedObject var model: ProviderViewModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(model.title).font(.title2).bold()
            if !model.message.isEmpty { Text(model.message).font(.callout) }
            ScrollView { VStack(alignment: .leading, spacing: 10) {
                ForEach(model.choices) { choice in
                    Button(action: choice.select) { VStack(alignment: .leading) { Text(choice.title).bold(); Text(choice.detail).font(.caption) }.frame(maxWidth: .infinity, alignment: .leading).padding(8) }.disabled(model.busy)
                }
            } }
            HStack { if model.busy { ProgressView().controlSize(.small) }; Spacer(); Button("Cancel", action: model.cancel) }
        }.padding(24).frame(minWidth: 300, minHeight: 250)
    }
}
@MainActor final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let model = ProviderViewModel()
    private var task: Task<Void, Never>?
    private var authentication: LAContext?
    private var epoch = UUID()
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
    private func cancel(_ code: ASExtensionError.Code = .userCanceled) {
        epoch = UUID(); task?.cancel(); authentication?.invalidate(); authentication = nil
        model.choices = []; extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: code.rawValue))
    }
    private func perform(_ work: @escaping (UUID) async throws -> Void) {
        task?.cancel(); authentication?.invalidate(); epoch = UUID(); let current = epoch
        model.busy = true; model.message = ""
        task = Task { [weak self] in
            guard let self else { return }
            do { try await work(current) }
            catch { if current == self.epoch && !Task.isCancelled { self.model.message = "Could not complete this request. Open Thingtime, sign in, and reconnect Password AutoFill if your session expired." } }
            if current == self.epoch { self.model.busy = false }
        }
    }
    private func verify(_ current: UUID, session: ProviderSession) throws {
        try Task.checkCancellation()
        guard epoch == current, try PasswordSessionStore.load() == session else { throw PasswordProviderError.invalidSession }
    }
    private func authenticate(_ current: UUID, session: ProviderSession) async throws {
        let context = LAContext(); authentication = context
        guard try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Use your saved Thingtime credential") else { throw PasswordProviderError.cancelled }
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
        _ = view; model.choices = []
        let hosts = domains(services)
        perform { [weak self] current in
            guard let self else { return }
            let session = try PasswordSessionStore.load(), client = PasswordClient(account: session)
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
            let entry = try await client.read(id); try self.verify(current, session: session)
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
        _ = view
        guard let id = credentialIdentity.recordIdentifier else { cancel(.credentialIdentityNotFound); return }
        select(id, hosts: domains([credentialIdentity.serviceIdentifier]))
    }
    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        _ = view
        guard let id = credentialRequest.credentialIdentity.recordIdentifier else { cancel(.credentialIdentityNotFound); return }
        var otp = false
        if #available(iOS 18, macOS 15, *) { otp = credentialRequest is ASOneTimeCodeCredentialRequest }
        select(id, hosts: domains([credentialRequest.credentialIdentity.serviceIdentifier]), passkeyRequest: credentialRequest as? ASPasskeyCredentialRequest, otp: otp)
    }
    override func prepareInterfaceForExtensionConfiguration() {
        _ = view
        model.message = "Open Thingtime → Passwords → Connect Password AutoFill to use your signed-in account."
        model.choices = [.init(id: "done", title: "Done", detail: "", select: { [weak self] in self?.extensionContext.completeExtensionConfigurationRequest() })]
    }
    override func prepareInterface(forPasskeyRegistration registrationRequest: any ASCredentialRequest) {
        _ = view
        guard let request = registrationRequest as? ASPasskeyCredentialRequest, let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else { cancel(.failed); return }
        model.title = "Save a passkey in Thingtime"
        model.message = "\(identity.userName) · \(identity.relyingPartyIdentifier)"
        model.choices = [.init(id: "register", title: "Create and save passkey", detail: "Verify with your device", select: { [weak self] in self?.register(request, identity: identity) })]
    }
    private func register(_ request: ASPasskeyCredentialRequest, identity: ASPasskeyCredentialIdentity) {
        perform { [weak self] current in
            guard let self else { return }
            guard request.clientDataHash.count == 32, request.supportedAlgorithms.contains(.ES256) else { throw PasswordProviderError.unsupportedAlgorithm }
            let session = try PasswordSessionStore.load(), client = PasswordClient(account: session)
            try await self.authenticate(current, session: session)
            let catalog = try await client.catalog(); try self.verify(current, session: session)
            if #available(iOS 18, macOS 15, *), let excluded = request.excludedCredentials {
                guard !catalog.contains(where: { item in item.relyingParty == identity.relyingPartyIdentifier && item.credentialId.flatMap({ Data(base64URL: $0) }).map({ id in excluded.contains { $0.credentialID == id } }) == true }) else { throw PasswordProviderError.invalidCredential }
            }
            let key = try PasskeyMaterial(relyingParty: identity.relyingPartyIdentifier, userHandle: identity.userHandle, username: identity.userName)
            let id = UUID().uuidString.lowercased(), write = UUID().uuidString.lowercased()
            _ = try await client.save(key.entry, id: id, writeId: write)
            // Never report a usable passkey until encrypted server persistence is
            // acknowledged and the same local Thingtime session is still active.
            try self.verify(current, session: session)
            let stored = try await client.read(id), confirmed = try PasskeyMaterial(entry: stored)
            guard confirmed.credentialID == key.credentialID, confirmed.privateKey == key.privateKey else { throw PasswordProviderError.unavailable }
            try self.verify(current, session: session)
            try await PasswordIdentityIndex.savePasskey(key, recordID: id)
            try self.verify(current, session: session)
            self.extensionContext.completeRegistrationRequest(using: ASPasskeyRegistrationCredential(relyingParty: key.relyingParty, clientDataHash: request.clientDataHash, credentialID: key.credentialID, attestationObject: try key.registration()), completionHandler: nil)
            self.model.choices = []
        }
    }
}
