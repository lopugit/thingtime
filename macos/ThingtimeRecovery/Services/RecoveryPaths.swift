import Foundation

public struct RecoveryPaths: Hashable {
    public let homeDirectory: URL

    public init(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser) {
        self.homeDirectory = homeDirectory.standardizedFileURL
    }

    public var applicationSupportDirectory: URL {
        homeDirectory
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("com.thingtime.desktop", isDirectory: true)
    }

    public var desktopCacheRoot: URL {
        applicationSupportDirectory.appendingPathComponent("release-cache", isDirectory: true)
    }

    public var recoveryCacheRoot: URL {
        applicationSupportDirectory.appendingPathComponent("recovery-cache", isDirectory: true)
    }

    public var applicationsDirectory: URL {
        homeDirectory.appendingPathComponent("Applications", isDirectory: true)
    }

    public func cacheRoot(for component: RecoveryComponent) -> URL {
        switch component {
        case .desktop: desktopCacheRoot
        case .recovery: recoveryCacheRoot
        case .commander: homeDirectory.appendingPathComponent("Library/Application Support/com.thingtime.Commander/release-cache", isDirectory: true)
        }
    }

    public func installedApp(for component: RecoveryComponent) -> URL {
        applicationsDirectory.appendingPathComponent(component.appName, isDirectory: true)
    }
}
