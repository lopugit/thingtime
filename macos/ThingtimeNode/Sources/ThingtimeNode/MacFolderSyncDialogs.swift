import AppKit
import AppleFileSync
import Photos
import ThingtimeNodeCore

/// Owned dialogs only; cancellation never closes another feature's window.
@MainActor
final class MacFolderSyncDialogs {
    private var picker: NSOpenPanel?
    private var alert: NSAlert?
    func cancel() {
        picker?.cancel(nil)
        if let alert, NSApp.modalWindow === alert.window { NSApp.abortModal(); alert.window.orderOut(nil) }
    }
    func chooseSource() async throws -> MacFolderSync.SourceSelection? {
        guard picker == nil, alert == nil else { return nil }
        let dialog = NSAlert(); alert = dialog
        dialog.messageText = "Choose backup source"
        dialog.informativeText = "Select a folder to sync or back up originals from your photo library."
        dialog.addButton(withTitle: "Cancel"); dialog.addButton(withTitle: "Existing folder"); dialog.addButton(withTitle: "Photo library (backup)")
        let choice = presentResponse(dialog)
        try Task.checkCancellation()
        if choice == .alertSecondButtonReturn { return try await choose().map(MacFolderSync.SourceSelection.folder) }
        guard choice == .alertThirdButtonReturn else { return nil }
        let consent = NSAlert(); alert = consent
        consent.messageText = "Back up photo originals?"
        consent.informativeText = "Thingtime will read original photos and videos, including embedded metadata and Live Photo video, from your Photos library. Saved cloud copies remain after device deletion. Nothing uploads until you configure and start a backup. Originals must currently be downloaded on this Mac."
        consent.addButton(withTitle: "Cancel"); consent.addButton(withTitle: "Choose photo access")
        guard present(consent) else { return nil }
        try Task.checkCancellation()
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        try Task.checkCancellation()
        guard status == .authorized || status == .limited else { throw PhotoLibraryReader.Failure.unavailable }
        return .photos
    }
    func choose() async throws -> URL? {
        guard picker == nil, alert == nil else { return nil }
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
        guard picker == nil, alert == nil else { return false }
        let dialog = NSAlert(); alert = dialog
        dialog.messageText = "Allow downloads to \(grant.name)?"
        dialog.informativeText = "This connection on \(grant.scope.origin.absoluteString) can add and replace files in the selected folder. Replaced copies are retained privately. Removing or choosing the folder again clears this approval."
        if allowTrash {
            dialog.messageText = "Allow downloads and recoverable deletions in \(grant.name)?"
            dialog.informativeText += " Files deleted in other connected locations can also be moved into Thingtime's private recovery storage. Restoring a retained file never overwrites an existing file."
        }
        dialog.addButton(withTitle: "Cancel"); dialog.addButton(withTitle: allowTrash ? "Allow sync and trash" : "Allow downloads")
        return present(dialog)
    }
    func restore(_ grant: MobileFolderStore.Grant, request: MobileSyncTrash.Restore) async throws -> Bool {
        guard picker == nil, alert == nil else { return false }
        let dialog = NSAlert(); alert = dialog
        dialog.messageText = "Restore this \(request.expected.kind) to \(grant.name)?"
        dialog.informativeText = "Restore \(request.expected.path) as \(request.path) in this selected folder on \(grant.scope.origin.absoluteString). Existing files are never overwritten."
        dialog.addButton(withTitle: "Cancel"); dialog.addButton(withTitle: "Restore")
        return present(dialog)
    }
    private func present(_ dialog: NSAlert) -> Bool { presentResponse(dialog) == .alertSecondButtonReturn }
    private func presentResponse(_ dialog: NSAlert) -> NSApplication.ModalResponse {
        let timeout = Timer(timeInterval: 120, repeats: false) { [weak dialog] _ in
            guard let dialog, NSApp.modalWindow === dialog.window else { return }
            NSApp.abortModal(); dialog.window.orderOut(nil)
        }
        // A modal panel runs its own mode; a default-mode timer never fires there.
        RunLoop.main.add(timeout, forMode: .modalPanel)
        defer { timeout.invalidate(); alert = nil }
        NSApp.activate(ignoringOtherApps: true)
        return dialog.runModal()
    }
}
