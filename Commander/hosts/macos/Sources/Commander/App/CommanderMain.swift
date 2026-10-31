import AppKit

@main
enum CommanderMain {
  @MainActor
  static func main() {
    let application = NSApplication.shared
    let delegate = CommanderAppDelegate()
    application.delegate = delegate
    application.run()
    _ = delegate
  }
}
