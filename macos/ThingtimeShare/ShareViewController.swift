import AppKit

@objc(ThingtimeMacShareViewController)
final class ShareViewController: NSViewController {
    private let message = NSTextField(wrappingLabelWithString: "")
    private let progress = NSProgressIndicator()
    private lazy var retry = NSButton(title: "Try Again", target: self, action: #selector(retryTapped))
    private lazy var cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelTapped))
    private var importer: MacShareItemImporter?
    private var batchId: UUID?
    private var saving = false
    private var generation = UUID()

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 150))
        let title = NSTextField(labelWithString: "Share to Thingtime")
        title.font = .boldSystemFont(ofSize: NSFont.systemFontSize)
        message.maximumNumberOfLines = 0
        progress.style = .spinning; progress.controlSize = .small
        progress.setAccessibilityLabel("Preparing shared content")
        let row = NSStackView(views: [progress, message])
        row.orientation = .horizontal; row.alignment = .centerY; row.spacing = 8
        let buttons = NSStackView(views: [cancel, retry]); buttons.spacing = 8
        let stack = NSStackView(views: [title, row, buttons])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -20)
        ])
        preferredContentSize = NSSize(width: 420, height: 180)
    }
    override func viewDidAppear() { super.viewDidAppear(); if batchId == nil && !saving { prepare() } }
    private func prepare() {
        guard !saving else { return }
        saving = true; retry.isHidden = true; generation = UUID()
        let attempt = generation
        message.stringValue = "Preparing shared content…"
        progress.isHidden = false; progress.startAnimation(nil)
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        Task { @MainActor in
            do {
                let adapter = MacShareItemImporter(inbox: try ShareInbox.shared())
                importer = adapter
                let id = try await adapter.save(items)
                guard attempt == generation else { return }
                batchId = id; saving = false; importer = nil
                openContainingApp()
            } catch {
                guard attempt == generation else { return }
                saving = false; importer = nil
                showError(error is ShareInbox.Failure ? error.localizedDescription : "Couldn’t prepare this share. The source has not been changed. Try again or cancel.")
            }
        }
    }
    private func openContainingApp() {
        guard let batchId else { return }
        progress.isHidden = false; progress.startAnimation(nil); retry.isHidden = true
        message.stringValue = "Opening Thingtime…"
        // Contents/PlugIns/ThingtimeShare.appex -> the exact containing .app.
        // Never dispatch through an arbitrary installed URL-scheme handler.
        let app = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        guard app.pathExtension == "app", FileManager.default.fileExists(atPath: app.appendingPathComponent("Contents/Info.plist").path),
              let target = URL(string: "thingtime-share://incoming/" + batchId.uuidString) else {
            showError("Thingtime could not be located. This share is saved on this Mac. Try again after opening the installed app.")
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open([target], withApplicationAt: app, configuration: configuration) { [weak self] application, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if application != nil && error == nil { self.extensionContext?.completeRequest(returningItems: nil) }
                else { self.showError("Couldn’t open Thingtime. This share is saved on this Mac. Try Again reopens the same draft.") }
            }
        }
    }
    private func showError(_ text: String) {
        progress.stopAnimation(nil); progress.isHidden = true
        message.stringValue = text; retry.isHidden = false
        message.setAccessibilityValue(text)
    }
    @objc private func retryTapped() { if batchId != nil { openContainingApp() } else { prepare() } }
    @objc private func cancelTapped() {
        generation = UUID(); importer?.cancel()
        // A committed share stays durable even when its app handoff is cancelled.
        extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
    }
    deinit { importer?.cancel() }
}
