import Foundation

// Only the isolated development bundle opts in. Normal installed builds retain
// their stable port, profile, Keychain service and global shortcut behavior.
enum CommanderDevelopmentEnvironment {
  static var enabled: Bool {
    Bundle.main.bundleIdentifier?.hasPrefix("com.thingtime.Commander.development.") == true
      && Bundle.main.object(forInfoDictionaryKey: "CommanderIsolatedDevelopment") as? Bool == true
  }

  static var root: URL { Bundle.main.bundleURL.deletingLastPathComponent() }

  static var port: Int? {
    guard enabled,
          let port = Bundle.main.object(forInfoDictionaryKey: "CommanderDevelopmentPort") as? Int,
          (1024...65535).contains(port) else { return nil }
    return port
  }
}
