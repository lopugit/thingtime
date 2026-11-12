// Appended to the real provider source by render-preview.sh. This harness only
// constructs ProviderView/ProviderViewModel with synthetic display data. It does
// not instantiate CredentialProviderViewController or call credential APIs.
@main enum ProviderPreview {
    @MainActor static func main() {
        let args = CommandLine.arguments
        func value(_ key: String, _ fallback: String) -> String {
            guard let index = args.firstIndex(of: key), args.indices.contains(index + 1) else { return fallback }
            return args[index + 1]
        }
        let width = Double(value("--width", "300")) ?? 300
        let height = Double(value("--height", "380")) ?? 380
        let phase = PasswordProviderPhase(rawValue: value("--phase", "saving")) ?? .saving
        let model = ProviderViewModel()
        model.title = "Save a passkey in Thingtime"
        model.busy = !args.contains("--error")
        model.status = phase.message
        model.choices = [.init(id: "synthetic", title: "Create and save passkey", detail: "Verify with your device", select: {})]
        if args.contains("--empty-passkeys") {
            model.title = "Thingtime"
            model.busy = false; model.status = ""; model.choices = []
            model.message = "No matching passkey is saved in Thingtime for this website. Create a passkey in the website's account security settings and choose Thingtime."
            model.requestedSite = "github.com"
            model.selectionSummary = PasswordCatalogSelection.passkeySummary([], relyingParty: model.requestedSite)
            model.requestDetailsExpanded = args.contains("--details")
        }
        if args.contains("--error") {
            let failure: PasswordProviderError = phase == .indexing ? .unavailable : .networkUnavailable
            model.message = phase.failure(failure)
            model.status = "Step: " + phase.message.replacingOccurrences(of: "…", with: "")
            model.retry = {}
        }
        if args.contains("--excluded") {
            model.title = "Passkey already saved"; model.busy = false; model.status = ""; model.choices = []; model.retry = nil
            model.message = PasswordProviderPhase.vault.failure(.credentialExcluded)
            model.cancelTitle = "Return to website"; model.requestedSite = args.contains("--long-site") ? "registration." + String(repeating: "long-subdomain.", count: 7) + "example.test" : "registration.example.test"
            model.registrationSummary = PasskeyRegistrationPolicy.summary(relyingParty: model.requestedSite, userHandleBytes: 16,
                clientDataHashBytes: 32, supportsES256: true, excludedCredentialIDs: [Data([1])],
                catalog: [try! JSONDecoder().decode(PasswordCatalogItem.self, from: Data("{\"id\":\"synthetic\",\"title\":\"Fixture\",\"username\":\"fixture\",\"domains\":[],\"hasPassword\":false,\"hasTotp\":false,\"relyingParty\":\"registration.example.test\",\"credentialId\":\"AQ\"}".utf8))])
            if args.contains("--large-counts") {
                let item = try! JSONDecoder().decode(PasswordCatalogItem.self, from: Data("{\"id\":\"synthetic\",\"title\":\"Fixture\",\"username\":\"fixture\",\"domains\":[],\"hasPassword\":false,\"hasTotp\":false,\"relyingParty\":\"".utf8) + Data(model.requestedSite.utf8) + Data("\",\"credentialId\":\"AQ\"}".utf8))
                model.registrationSummary = PasskeyRegistrationPolicy.summary(relyingParty: model.requestedSite, userHandleBytes: 64,
                    clientDataHashBytes: 32, supportsES256: true, excludedCredentialIDs: Array(repeating: Data([1]), count: 10_001), catalog: Array(repeating: item, count: 10_001))
            }
            model.requestDetailsExpanded = args.contains("--details")
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let host = NSHostingController(rootView: ProviderView(model: model).background(Color(nsColor: .windowBackgroundColor)))
        let window = NSWindow(contentViewController: host)
        window.setContentSize(NSSize(width: width, height: height))
        window.title = "Thingtime · synthetic provider preview"
        window.center(); window.makeKeyAndOrderFront(nil)
        app.activate(ignoringOtherApps: true)
        if args.contains("--snapshot") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                // ImageRenderer omits native-backed ScrollView contents. Capture
                // the laid-out hosting view used by this actual preview window.
                host.view.layoutSubtreeIfNeeded()
                if let bitmap = host.view.bitmapImageRepForCachingDisplay(in: host.view.bounds) {
                    host.view.cacheDisplay(in: host.view.bounds, to: bitmap)
                    if let png = bitmap.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: value("--snapshot", "/tmp/thingtime-provider-preview.png")))
                    }
                }
                app.terminate(nil)
            }
        }
        withExtendedLifetime((window, model)) { app.run() }
    }
}
