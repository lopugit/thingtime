import UIKit
import CryptoKit

@main final class ProfileControl: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "ProfileControl", sessionRole: session.role)
        configuration.delegateClass = ProfileScene.self
        return configuration
    }
    static func performChecks() {
        var report: [String: Any] = ["passed": false, "scope": "native Keychain profile only; no Node/HTTP/WebView acceptance"]
        let files = FileManager.default
        let documents = files.urls(for: .documentDirectory, in: .userDomainMask)[0]
        do {
            let root = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("NativeAccountHome")
            let origin = "http://127.0.0.1:29741"
            let store = ThingtimeLocalAccountProfile.Store.keychain(service: Bundle.main.bundleIdentifier! + ".fixture")
            report["stage"] = "first-profile"
            let bytes = try ThingtimeLocalAccountProfile.prepare(root: root, origin: origin, store: store)
            let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            let marker = documents.appendingPathComponent("previous-digest")
            let restart = ProcessInfo.processInfo.arguments.contains("restart")
            if restart {
                guard try String(contentsOf: marker, encoding: .utf8) == digest else { throw ThingtimeLocalAccountProfile.Failure.unavailable }
            } else { try digest.write(to: marker, atomically: true, encoding: .utf8) }
            report["stage"] = "retained-profile"
            let again = try ThingtimeLocalAccountProfile.prepare(root: root, origin: origin, store: store)
            let a = try JSONDecoder().decode(ThingtimeLocalAccountProfile.Envelope.self, from: bytes)
            let b = try JSONDecoder().decode(ThingtimeLocalAccountProfile.Envelope.self, from: again)
            guard a.profileId == b.profileId, a.jwt == b.jwt, a.vault == b.vault, a.outbox == b.outbox else { throw ThingtimeLocalAccountProfile.Failure.unavailable }
            func refuses(_ operation: () throws -> Data) -> Bool { do { _ = try operation(); return false } catch { return true } }
            let missing = ThingtimeLocalAccountProfile.Store(read: { nil }, add: { _ in fatalError("must never regenerate") })
            let corrupt = ThingtimeLocalAccountProfile.Store(read: { Data("corrupt".utf8) }, add: { _ in fatalError("must never regenerate") })
            let checks = [
                "missingKeysRefused": refuses { try ThingtimeLocalAccountProfile.prepare(root: root, origin: origin, store: missing) },
                "corruptKeysRefused": refuses { try ThingtimeLocalAccountProfile.prepare(root: root, origin: origin, store: corrupt) },
                "wrongOriginRefused": refuses { try ThingtimeLocalAccountProfile.prepare(root: root, origin: "http://127.0.0.1:29742", store: store) },
                "wrongPathRefused": refuses { try ThingtimeLocalAccountProfile.prepare(root: root.appendingPathComponent("foreign"), origin: origin, store: store) }
            ]
            guard checks.values.allSatisfy({ $0 }) else { throw ThingtimeLocalAccountProfile.Failure.unavailable }
            report.merge(checks) { _,new in new }
            report["sameProfileAndKeysRetained"] = true; report["realKeychain"] = true
            report["processRestart"] = restart; report["pid"] = ProcessInfo.processInfo.processIdentifier
            report["passed"] = true
        } catch { report["error"] = String(describing: error) }
        try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]).write(to: documents.appendingPathComponent("receipt.json"), options: .atomic)
    }
}
final class ProfileScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: scene); window?.rootViewController = UIViewController(); window?.makeKeyAndVisible()
        ProfileControl.performChecks()
    }
}
