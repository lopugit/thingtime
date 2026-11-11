import Foundation

// Bundle identity is signed build metadata, never a renderer/CLI value. The
// production identifier deliberately produces the historical notification.
enum PasswordHostIdentity {
    static var destinationChanged: Notification.Name {
        destinationChanged(for: Bundle.main.bundleIdentifier)
    }
    static func destinationChanged(for bundleIdentifier: String?) -> Notification.Name {
        Notification.Name((bundleIdentifier ?? "thingtime.invalid-host") + ".destination-changed")
    }
}
