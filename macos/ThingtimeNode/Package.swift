// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ThingtimeNode",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(name: "ThingtimeNodeCore", targets: ["ThingtimeNodeCore"]),
        .executable(name: "ThingtimeNode", targets: ["ThingtimeNode"]),
        .executable(name: "ThingtimeNodeBridge", targets: ["ThingtimeNodeBridge"])
    ],
    targets: [
        .target(
            name: "ThingtimeNodeCore",
            resources: [
                .process("Resources")
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("AudioToolbox"),
                .linkedFramework("CoreAudio"),
                .linkedFramework("CoreWLAN"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("CoreImage"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("CryptoKit"),
                .linkedFramework("ImageIO"),
                .linkedFramework("IOBluetooth"),
                .linkedFramework("IOKit"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("Security"),
                .linkedFramework("SystemConfiguration")
            ]
        ),
        .executableTarget(
            name: "ThingtimeNode",
            dependencies: ["ThingtimeNodeCore"]
        ),
        .executableTarget(
            name: "ThingtimeNodeBridge",
            dependencies: ["ThingtimeNodeCore"]
        ),
        .testTarget(
            name: "ThingtimeNodeCoreTests",
            dependencies: ["ThingtimeNodeCore"]
        )
    ],
    swiftLanguageModes: [.v5]
)
