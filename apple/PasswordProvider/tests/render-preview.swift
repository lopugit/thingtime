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
        if args.contains("--error") {
            let failure: PasswordProviderError = phase == .indexing ? .unavailable : .networkUnavailable
            model.message = phase.failure(failure)
            model.status = "Step: " + phase.message.replacingOccurrences(of: "…", with: "")
            model.retry = {}
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let host = NSHostingController(rootView: ProviderView(model: model))
        let window = NSWindow(contentViewController: host)
        window.setContentSize(NSSize(width: width, height: height))
        window.title = "Thingtime · synthetic provider preview"
        window.center(); window.makeKeyAndOrderFront(nil)
        app.activate(ignoringOtherApps: true)
        if args.contains("--snapshot") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                let renderer = ImageRenderer(content: ProviderView(model: model).frame(width: width, height: height).background(Color(nsColor: .windowBackgroundColor)))
                renderer.scale = 2
                if let image = renderer.cgImage,
                   let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: value("--snapshot", "/tmp/thingtime-provider-preview.png")))
                }
                app.terminate(nil)
            }
        }
        withExtendedLifetime((window, model)) { app.run() }
    }
}
