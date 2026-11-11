import UIKit
import WebKit

final class Control: UIViewController, WKNavigationDelegate {
    let mode = ProcessInfo.processInfo.arguments.contains("remove") ? "remove" : "preserve"
    var events: [[String: Any]] = []
    var finishes = 0
    var web: WKWebView!
    func record(_ stage: String, _ extra: [String: Any] = [:]) {
        var item: [String: Any] = ["stage": stage, "time": Date().timeIntervalSince1970,
            "pid": ProcessInfo.processInfo.processIdentifier, "mode": mode,
            "simulatorRootPresent": getenv("IPHONE_SIMULATOR_ROOT") != nil]
        item.merge(extra) { _, new in new }; events.append(item)
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("receipt.json")
        try! JSONSerialization.data(withJSONObject: events, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
    }
    override func viewDidLoad() {
        super.viewDidLoad(); web = WKWebView(frame: view.bounds)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]; web.navigationDelegate = self
        view.addSubview(web); record("created")
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard events.count == 1 else { return }
        record("visible")
        web.loadHTMLString("<!doctype html><html><body><label>Diagnostic text<input id='editor' value='ordinary text'></label></body></html>", baseURL: nil)
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { record("provisional") }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finishes += 1; record("finished", ["number": finishes])
        if finishes == 1 {
            web.evaluateJavaScript("const e=document.getElementById('editor');e.focus();e.value='diagnostic mispelled text';e.dispatchEvent(new Event('input',{bubbles:true}));e.value") { [self] value, error in
                record("edited", ["valueMatched": value as? String == "diagnostic mispelled text", "javascriptError": error != nil])
                if mode == "remove" { unsetenv("IPHONE_SIMULATOR_ROOT") }
                record("before-spellcheck")
                let text = "mispelled"
                let result = UITextChecker().rangeOfMisspelledWord(in: text, range: NSRange(location: 0, length: text.utf16.count), startingAt: 0, wrap: false, language: "en_US")
                record("spellcheck-returned", ["resultLocation": result.location])
                record("reload-requested"); web.reload()
            }
        } else { record("passed") }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { record("navigation-error", ["code": (error as NSError).code]) }
}
final class Scene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: scene); window?.rootViewController = Control(); window?.makeKeyAndVisible()
    }
}
final class App: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Control", sessionRole: session.role)
        configuration.delegateClass = Scene.self; return configuration
    }
}
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(App.self))
