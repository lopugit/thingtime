// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AppleFileSync",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "AppleFileSync", targets: ["AppleFileSync"])],
    targets: [
        .target(name: "AppleFileSync"),
        .target(name: "FileSyncRecoverySupport", dependencies: ["AppleFileSync"], path: "Tests/RecoverySupport"),
        .executableTarget(name: "FileSyncRecoveryFixture", dependencies: ["FileSyncRecoverySupport"], path: "Tests/RecoveryFixture"),
        .testTarget(name: "AppleFileSyncTests", dependencies: ["AppleFileSync"])
    ],
    swiftLanguageModes: [.v5]
)
