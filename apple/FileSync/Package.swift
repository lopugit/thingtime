// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AppleFileSync",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "AppleFileSync", targets: ["AppleFileSync"])],
    targets: [
        .target(name: "CCommanderInventory"),
        .target(name: "AppleFileSync", dependencies: ["CCommanderInventory"]),
        .target(name: "FileSyncRecoverySupport", dependencies: ["AppleFileSync"], path: "Tests/RecoverySupport"),
        .executableTarget(name: "FileSyncRecoveryFixture", dependencies: ["FileSyncRecoverySupport"], path: "Tests/RecoveryFixture"),
        .executableTarget(name: "FileSyncEmbeddedFixture", dependencies: ["AppleFileSync"], path: "Tests/EmbeddedFixture"),
        .testTarget(name: "AppleFileSyncTests", dependencies: ["AppleFileSync"])
    ],
    swiftLanguageModes: [.v5]
)
