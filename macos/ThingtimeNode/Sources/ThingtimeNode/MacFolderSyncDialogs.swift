import AppKit
import AppleFileSync
import Photos
import ThingtimeNodeCore

/// Owned dialogs only; cancellation never closes another feature's window.
@MainActor
final class MacFolderSyncDialogs {
    private let alertTimeout: Duration
    private var picker: NSOpenPanel?
    private var alertHost: NSWindow?
    private var dismissAlert: (() -> Void)?

    init(alertTimeout: Duration = .seconds(120)) {
        self.alertTimeout = alertTimeout
    }

    func cancel() {
        picker?.cancel(nil)
        cancelAlert()
    }

    private func cancelAlert() {
        let dismiss = dismissAlert
        dismissAlert = nil
        dismiss?()
    }
    func chooseSource() async throws -> MacFolderSync.SourceSelection? {
        guard picker == nil, alertHost == nil else { return nil }
        let dialog = NSAlert()
        dialog.messageText = "Choose backup source"
        dialog.informativeText = "Select a folder to sync or back up originals from your photo library."
        dialog.addButton(withTitle: "Cancel"); dialog.addButton(withTitle: "Existing folder"); dialog.addButton(withTitle: "Photo library (backup)")
        let choice = await presentResponse(dialog)
        try Task.checkCancellation()
        if choice == .alertSecondButtonReturn { return try await choose().map(MacFolderSync.SourceSelection.folder) }
        guard choice == .alertThirdButtonReturn else { return nil }
        let consent = NSAlert()
        consent.messageText = "Back up photo originals?"
        consent.informativeText = "Thingtime will read original photos and videos, including embedded metadata and Live Photo video, from your Photos library. Saved cloud copies remain after device deletion. Nothing uploads until you configure and start a backup. Originals must currently be downloaded on this Mac."
        consent.addButton(withTitle: "Cancel"); consent.addButton(withTitle: "Choose photo access")
        guard await present(consent) else { return nil }
        try Task.checkCancellation()
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        try Task.checkCancellation()
        guard status == .authorized || status == .limited else { throw PhotoLibraryReader.Failure.unavailable }
        return .photos
    }
    func choose() async throws -> URL? {
        guard picker == nil, alertHost == nil else { return nil }
        let panel = NSOpenPanel()
        panel.title = "Choose a folder for Thingtime sync"
        panel.message = "Thingtime can read this selected folder. Downloads require separate approval for each connection."
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true; picker = panel
        let timeout = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { [weak panel] _ in panel?.cancel(nil) }
        defer { timeout.invalidate(); picker = nil }
        NSApp.activate(ignoringOtherApps: true)
        return await withCheckedContinuation { continuation in
            panel.begin { response in continuation.resume(returning: response == .OK ? panel.url : nil) }
        }
    }
    func approve(_ grant: MobileFolderStore.Grant, allowTrash: Bool = false) async throws -> Bool {
        guard picker == nil, alertHost == nil else { return false }
        let dialog = NSAlert()
        dialog.messageText = "Allow downloads to \(grant.name)?"
        dialog.informativeText = "This connection on \(grant.scope.origin.absoluteString) can add and replace files in the selected folder. Replaced copies are retained privately. Removing or choosing the folder again clears this approval."
        if allowTrash {
            dialog.messageText = "Allow downloads and recoverable deletions in \(grant.name)?"
            dialog.informativeText += " Files deleted in other connected locations can also be moved into Thingtime's private recovery storage. Restoring a retained file never overwrites an existing file."
        }
        dialog.addButton(withTitle: "Cancel"); dialog.addButton(withTitle: allowTrash ? "Allow sync and trash" : "Allow downloads")
        return await present(dialog)
    }
    func restore(_ grant: MobileFolderStore.Grant, request: MobileSyncTrash.Restore) async throws -> Bool {
        guard picker == nil, alertHost == nil else { return false }
        let dialog = NSAlert()
        dialog.messageText = "Restore this \(request.expected.kind) to \(grant.name)?"
        dialog.informativeText = "Restore \(request.expected.path) as \(request.path) in this selected folder on \(grant.scope.origin.absoluteString). Existing files are never overwritten."
        dialog.addButton(withTitle: "Cancel"); dialog.addButton(withTitle: "Restore")
        return await present(dialog)
    }

    private func present(_ dialog: NSAlert) async -> Bool {
        await presentResponse(dialog) == .alertSecondButtonReturn
    }

    private func presentResponse(_ dialog: NSAlert) async -> NSApplication.ModalResponse {
        // Node is a menu bar app. Give the alert its own temporary sheet host
        // so AppKit can keep servicing MainActor requests while it awaits input.
        let host = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 120),
                            styleMask: [.titled], backing: .buffered, defer: true)
        host.title = "Thingtime Folder Sync"
        host.center()
        alertHost = host
        let timeout = Task { @MainActor [weak self, weak host, alertTimeout] in
            try await Task.sleep(for: alertTimeout)
            if let self, let host, self.alertHost === host { self.cancelAlert() }
        }
        defer {
            timeout.cancel()
            host.orderOut(nil)
            dismissAlert = nil
            alertHost = nil
        }
        NSApp.activate(ignoringOtherApps: true)
        host.makeKeyAndOrderFront(nil)
        return await withCheckedContinuation { continuation in
            dismissAlert = { [weak host] in
                if let host, let sheet = host.attachedSheet { host.endSheet(sheet, returnCode: .cancel) }
            }
            dialog.beginSheetModal(for: host) { [weak self] response in
                self?.dismissAlert = nil
                continuation.resume(returning: response)
            }
        }
    }
}
