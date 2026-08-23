// swift-tools-version: 6.1
import PackageDescription

let package = Package(
  name: "Commander",
  platforms: [.macOS(.v14)],
  products: [.executable(name: "Commander", targets: ["Commander"])],
  targets: [
    .executableTarget(
      name: "Commander",
      path: "Sources/Commander",
      linkerSettings: [
        .linkedFramework("AppKit"),
        .linkedFramework("ApplicationServices"),
        .linkedFramework("Carbon"),
        .linkedFramework("Metal"),
        .linkedFramework("Security"),
        .linkedFramework("ServiceManagement"),
        .linkedFramework("WebKit"),
      ]
    ),
    .testTarget(
      name: "CommanderTests",
      dependencies: ["Commander"],
      path: "Tests/CommanderTests"
    ),
  ]
)
