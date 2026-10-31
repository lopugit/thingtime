// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "ThingtimePasswordCore", platforms: [.macOS(.v14), .iOS(.v17)], products: [.library(name: "ThingtimePasswordCore", targets: ["ThingtimePasswordCore"])], targets: [.target(name: "ThingtimePasswordCore"), .testTarget(name: "ThingtimePasswordCoreTests", dependencies: ["ThingtimePasswordCore"])])
