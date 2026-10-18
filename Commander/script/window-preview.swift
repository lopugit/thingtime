import AppKit

/// A disposable native development harness: no daemon, network, credentials,
/// global hotkeys, or access to Commander's installed profile.
@MainActor
final class WindowPreviewDelegate: NSObject, NSApplicationDelegate {
  private var window: CommanderUtilityWindow!
  private let status = NSTextField(labelWithString: "")

  func applicationDidFinishLaunching(_ notification: Notification) {
    window = CommanderUtilityWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 520), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Commander Window Preview"
    window.isReleasedWhenClosed = false
    let stack = NSStackView()
    stack.orientation = .vertical
    stack.spacing = 20
    stack.addArrangedSubview(NSTextField(labelWithString: "Double-click the titlebar to maximize and restore."))
    let duplicate = NSButton(title: "Simulate native + web zoom delivery", target: self, action: #selector(zoomTwice))
    stack.addArrangedSubview(duplicate)
    let above = NSButton(checkboxWithTitle: "Keep above", target: self, action: #selector(toggleAbove(_:)))
    stack.addArrangedSubview(above)
    stack.addArrangedSubview(status)
    stack.translatesAutoresizingMaskIntoConstraints = false
    window.contentView!.addSubview(stack)
    NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: window.contentView!.centerXAnchor), stack.centerYAnchor.constraint(equalTo: window.contentView!.centerYAnchor)])
    window.center()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  @objc private func zoomTwice() {
    window.zoom(nil)
    window.zoom(nil)
    status.stringValue = "One gesture → \(Int(window.frame.width)) × \(Int(window.frame.height))"
  }

  @objc private func toggleAbove(_ sender: NSButton) {
    window.level = sender.state == .on ? .floating : .normal
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct WindowPreview {
  @MainActor static func main() {
    let app = NSApplication.shared
    let delegate = WindowPreviewDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
  }
}
