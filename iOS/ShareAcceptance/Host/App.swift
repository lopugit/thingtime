import UIKit
import UniformTypeIdentifiers

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Acceptance", sessionRole: session.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: scene)
        window?.rootViewController = FixtureController()
        window?.makeKeyAndVisible()
    }
}

final class FixtureController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let button = UIButton(type: .system)
        button.setTitle("Share fixture", for: .normal)
        button.accessibilityIdentifier = "share-fixture"
        button.addTarget(self, action: #selector(share), for: .touchUpInside)
        button.frame = CGRect(x: 60, y: 180, width: 260, height: 80)
        view.addSubview(button)
        let seed = UIButton(type: .system)
        seed.setTitle("Seed Live Photo", for: .normal)
        seed.accessibilityIdentifier = "seed-live-photo"
        seed.frame = CGRect(x: 60, y: 280, width: 260, height: 80)
        seed.addTarget(self, action: #selector(seedLivePhoto), for: .touchUpInside)
        view.addSubview(seed)
    }
    private func presentShare(_ controller: UIActivityViewController) {
        controller.popoverPresentationController?.sourceView = view
        controller.popoverPresentationController?.sourceRect = CGRect(x: 190, y: 220, width: 1, height: 1)
        present(controller, animated: true)
    }
    @objc func seedLivePhoto() {
        Task { @MainActor in
            let label = UILabel(frame: CGRect(x: 20, y: 380, width: 350, height: 160))
            label.numberOfLines = 0; view.addSubview(label)
            do { let id = try await LivePhotoFixture.seed(); label.text = "Live Photo seeded: " + id; label.accessibilityIdentifier = "live-photo-seeded" }
            catch { label.text = "Live Photo failed: \(error)"; label.accessibilityIdentifier = "live-photo-failed" }
        }
    }
    @objc func share() {
        let args = ProcessInfo.processInfo.arguments
        let kind = args.firstIndex(of: "--fixture").map { args[$0 + 1] } ?? "text"
        let text = "Thingtime share acceptance – text\nUnicode: café 🌏"
        let resources = Bundle.main.resourceURL!
        var items: [Any] = []
        switch kind {
        case "text": items = [text]
        case "url": items = [URL(string: "https://example.com/thingtime-share?fixture=1")!]
        case "image": items = [UIImage(contentsOfFile: resources.appendingPathComponent("fixture.png").path)!]
        case "mixed": items = [text, URL(string: "https://example.com/share")!, resources.appendingPathComponent("fixture.pdf"), resources.appendingPathComponent("fixture.wav"), resources.appendingPathComponent("fixture.mp4")]
        case "many": items = (0..<25).map { index -> URL in
            let path = FileManager.default.temporaryDirectory.appendingPathComponent("attachment-\(index).bin")
            try! Data("attachment \(index) exact bytes".utf8).write(to: path)
            return path
        }
        case "directory":
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("fixture-folder", isDirectory: true)
            try! FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try! Data("directory child exact bytes".utf8).write(to: folder.appendingPathComponent("child.txt"))
            items = [folder]
        case "slow":
            let provider = NSItemProvider()
            provider.registerDataRepresentation(forTypeIdentifier: "public.utf8-plain-text", visibility: .all) { completion in
                DispatchQueue.global().asyncAfter(deadline: .now() + 4) { completion(Data(text.utf8), nil) }
                return nil
            }
            presentShare(UIActivityViewController(activityItemsConfiguration: UIActivityItemsConfiguration(itemProviders: [provider])))
            return
        case "unavailable":
            let provider = NSItemProvider()
            provider.registerDataRepresentation(forTypeIdentifier: "public.data", visibility: .all) { completion in
                completion(nil, NSError(domain: "Thingtime.ShareAcceptance.UnavailableFixture", code: 1)); return nil
            }
            presentShare(UIActivityViewController(activityItemsConfiguration: UIActivityItemsConfiguration(itemProviders: [provider])))
            return
        case "custom":
            let provider = NSItemProvider()
            provider.registerDataRepresentation(forTypeIdentifier: "com.thingtime.acceptance.unknown", visibility: .all) { completion in
                completion(Data("unknown custom type exact bytes".utf8), nil); return nil
            }
            let controller = UIActivityViewController(activityItemsConfiguration: UIActivityItemsConfiguration(itemProviders: [provider]))
            presentShare(controller); return
        default: items = [resources.appendingPathComponent("fixture.\(kind)")]
        }
        presentShare(UIActivityViewController(activityItems: items, applicationActivities: nil))
    }
}
