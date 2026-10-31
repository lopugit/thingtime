// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ThingtimeRecovery",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "ThingtimeRecoveryCore", targets: ["ThingtimeRecoveryCore"]),
        .executable(name: "ThingtimeRecovery", targets: ["ThingtimeRecovery"]),
        .executable(name: "ThingtimeRecoveryInstaller", targets: ["ThingtimeRecoveryInstaller"])
    ],
    targets: [
        .target(
            name: "ThingtimeRecoveryCore",
            path: ".",
            sources: ["Models", "Services"],
            linkerSettings: [
                .linkedFramework("AppKit")
            ]
        ),
        .executableTarget(
            name: "ThingtimeRecovery",
            dependencies: ["ThingtimeRecoveryCore"],
            path: ".",
            sources: ["App/ThingtimeRecoveryApp.swift", "Stores", "Views"]
        ),
        .executableTarget(
            name: "ThingtimeRecoveryInstaller",
            dependencies: ["ThingtimeRecoveryCore"],
            path: ".",
            sources: ["App/ThingtimeRecoveryInstallerMain.swift"]
        ),
        .testTarget(
            name: "ThingtimeRecoveryCoreTests",
            dependencies: ["ThingtimeRecoveryCore", "ThingtimeRecovery"],
            path: "Tests/ThingtimeRecoveryCoreTests"
        )
    ],
    swiftLanguageModes: [.v5]
)
