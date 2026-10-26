// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "OfflineNativeVM", platforms: [.macOS(.v13)], products: [.executable(name: "offline-native-vm", targets: ["offline-native-vm"])], targets: [.target(name: "OfflineVMCore"), .executableTarget(name: "offline-native-vm", dependencies: ["OfflineVMCore"]), .testTarget(name: "OfflineVMCoreTests", dependencies: ["OfflineVMCore"])])
