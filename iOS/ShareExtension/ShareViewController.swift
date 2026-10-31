import UIKit

/// This system extension is a local file adapter; it never signs in or uploads.
final class ShareViewController: UIViewController {
    private let titleLabel = UILabel()
    private let messageLabel = UILabel()
    private let progressView = UIProgressView(progressViewStyle: .default)
    private let primaryButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private var cancellation: ShareImportCancellation?
    private var saving = false
    private var finished = false
    private var generation = UUID()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        titleLabel.font = .preferredFont(forTextStyle: .title2)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.numberOfLines = 0
        messageLabel.font = .preferredFont(forTextStyle: .body)
        messageLabel.adjustsFontForContentSizeCategory = true
        messageLabel.numberOfLines = 0
        primaryButton.configuration = .filled()
        primaryButton.addTarget(self, action: #selector(primaryTapped), for: .touchUpInside)
        cancelButton.configuration = .plain()
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [titleLabel, messageLabel, progressView, primaryButton, cancelButton])
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48)
        ])
        preferredContentSize = CGSize(width: 480, height: 340)
        startSaving()
    }
    private func startSaving() {
        guard !saving else { return }
        saving = true
        generation = UUID()
        let attempt = generation
        finished = false
        titleLabel.text = "Save to Thingtime"
        messageLabel.text = "Saving locally…"
        progressView.progress = 0
        progressView.isHidden = false
        primaryButton.isHidden = true
        cancelButton.isHidden = false
        cancelButton.isEnabled = true
        cancelButton.setTitle("Cancel", for: .normal)
        let token = ShareImportCancellation()
        cancellation = token
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let sources = items.flatMap { $0.attachments ?? [] }.map { ProviderShareItem(provider: $0) }
        // Preserve actual extension-item text as well as attachments (for captions, URLs, etc.).
        let text = items.compactMap { $0.attributedContentText?.string }.filter { !$0.isEmpty }
        Task {
            do {
                let importer = ShareItemImporter(inbox: try ShareInbox.shared(), cancellation: token)
                try await importer.save(sources, additionalText: text) { [weak self] completed, total in
                    Task { @MainActor in
                        guard let self, self.generation == attempt, self.saving else { return }
                        self.progressView.setProgress(Float(completed) / Float(total), animated: true)
                        self.messageLabel.text = "Saved \(completed) of \(total) items locally…"
                    }
                }
                saving = false
                finished = true
                titleLabel.text = "Saved locally"
                let device = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
                messageLabel.text = "Open Thingtime to finish placing these files in Files → On My \(device) → Thingtime → Shared. Nothing has been uploaded."
                progressView.isHidden = true
                primaryButton.setTitle("Done", for: .normal)
                primaryButton.isHidden = false
                cancelButton.isHidden = true
                UIAccessibility.post(notification: .announcement, argument: titleLabel.text)
            } catch is CancellationError {
                saving = false
                extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
            } catch {
                saving = false
                titleLabel.text = "Couldn’t save this share"
                messageLabel.text = error.localizedDescription
                progressView.isHidden = true
                primaryButton.setTitle("Try Again", for: .normal)
                primaryButton.isHidden = false
                cancelButton.isEnabled = true
                cancelButton.setTitle("Cancel", for: .normal)
                UIAccessibility.post(notification: .announcement, argument: "Couldn’t save this share. \(error.localizedDescription)")
            }
        }
    }
    @objc private func primaryTapped() {
        if finished { extensionContext?.completeRequest(returningItems: nil) }
        else { startSaving() }
    }
    @objc private func cancelTapped() {
        guard saving else { extensionContext?.cancelRequest(withError: CocoaError(.userCancelled)); return }
        cancellation?.cancel()
        cancelButton.isEnabled = false
        messageLabel.text = "Cancelling…"
    }
    deinit { cancellation?.cancel() }
}
