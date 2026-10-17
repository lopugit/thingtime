import AppKit
import AppleFileSync

/// Owned dialogs only; cancellation never closes another feature's window.
@MainActor
final class MacFolderSyncDialogs {
    private var picker: NSOpenPanel?
    private var alert: NSAlert?
    func cancel() {
        picker?.cancel(nil)
        if let alert, NSApp.modalWindow === alert.window { NSApp.abortModal(); alert.window.orderOut(nil) }
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
    func approve(_ grant: MobileFolderStore.Grant) async throws -> Bool {
        guard picker == nil, alert == nil else { return false }
        let dialog = NSAlert(); alert = dialog
        dialog.messageText = "Allow downloads to \(grant.name)?"
        dialog.informativeText = "This connection on \(grant.scope.origin.absoluteString) can add and replace files in the selected folder. Replaced copies are retained privately. Removing or choosing the folder again clears this approval."
        dialog.addButton(withTitle: "Cancel"); dialog.addButton(withTitle: "Allow downloads")
        let timeout = Timer(timeInterval: 120, repeats: false) { [weak dialog] _ in
            guard let dialog, NSApp.modalWindow === dialog.window else { return }
            NSApp.abortModal(); dialog.window.orderOut(nil)
        }
        // A modal panel runs its own mode; a default-mode timer never fires there.
        RunLoop.main.add(timeout, forMode: .modalPanel)
        defer { timeout.invalidate(); alert = nil }
        NSApp.activate(ignoringOtherApps: true)
        return dialog.runModal() == .alertSecondButtonReturn
    }
}
