import AppKit

// Real OS sharing-service acceptance host. Only synthetic task-owned content.
@main
final class ShareAcceptance: NSObject, NSApplicationDelegate, NSSharingServiceDelegate {
    private var service: NSSharingService?
    private var window: NSWindow?
    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = CommandLine.arguments
        let mode = arguments.count > 1 ? arguments[1] : "list"
        let items: [Any]
        switch mode {
        case "text": items = ["Thingtime macOS share acceptance — line one\nLine two 🥰"]
        case "url": items = [URL(string: "https://example.com/thingtime-share-acceptance?source=macOS")!]
        case "files": items = arguments.dropFirst(2).map { URL(fileURLWithPath: $0) }
        default: items = [URL(string: "https://example.com/thingtime-share-acceptance")!]
        }
        let services = NSSharingService.sharingServices(forItems: items)
        if mode == "list" {
            for item in services { print(item.title) }
            NSApplication.shared.terminate(nil)
            return
        }
        guard !items.isEmpty, let selected = services.first(where: { $0.title == "Thingtime" }) else {
            fputs("The installed Thingtime sharing service is unavailable for these items.\n", stderr)
            exit(1)
        }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 180),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Thingtime Share Acceptance"
        window.contentView = NSTextField(labelWithString: "Sharing synthetic \(mode) through the macOS Share service.")
        window.center(); window.makeKeyAndOrderFront(nil)
        self.window = window
        selected.delegate = self; service = selected
        selected.perform(withItems: items)
    }
    func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) {
        print("macOS sharing service completed")
        NSApplication.shared.terminate(nil)
    }
    func sharingService(_ sharingService: NSSharingService, didFailToShareItems items: [Any], error: Error) {
        fputs("macOS sharing service failed (\((error as NSError).domain), \((error as NSError).code)).\n", stderr)
        exit(1)
    }
    static func main() {
        let application = NSApplication.shared
        let delegate = ShareAcceptance()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }
}
