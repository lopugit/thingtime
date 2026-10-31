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
        .executable(name: "ThingtimeNodeBridge", targets: ["ThingtimeNodeBridge"]),
        .executable(name: "ThingtimeSpeech", targets: ["ThingtimeSpeech"])
    ],
    dependencies: [.package(path: "../../apple/FileSync")],
    targets: [
        .target(
            name: "ThingtimeNodeCore",
            dependencies: [.product(name: "AppleFileSync", package: "FileSync")],
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
            dependencies: ["ThingtimeNodeCore", .product(name: "AppleFileSync", package: "FileSync")]
        ),
        .executableTarget(
            name: "ThingtimeNodeBridge",
            dependencies: ["ThingtimeNodeCore"]
        ),
        .executableTarget(
            name: "ThingtimeSpeech",
            dependencies: ["ThingtimeSpeechCore"],
            linkerSettings: [.linkedFramework("Speech"), .linkedFramework("AVFoundation")]
        ),
        .target(name: "ThingtimeSpeechCore"),
        .testTarget(
            name: "ThingtimeSpeechCoreTests",
            dependencies: ["ThingtimeSpeechCore"]
        ),
        .executableTarget(
            name: "MacFolderSyncFixture",
            dependencies: ["ThingtimeNodeCore", .product(name: "AppleFileSync", package: "FileSync")],
            path: "Tests/MacFolderSyncFixture"
        ),
        .testTarget(
            name: "ThingtimeNodeCoreTests",
            dependencies: ["ThingtimeNodeCore", .product(name: "AppleFileSync", package: "FileSync")]
        )
    ],
    swiftLanguageModes: [.v5]
)
