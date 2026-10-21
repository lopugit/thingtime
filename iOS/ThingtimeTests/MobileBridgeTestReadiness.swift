import XCTest
import WebKit
@testable import Thingtime

/// Exercise the bridge's real lifecycle/origin gate. A missing prerequisite is
/// a test failure, not a skipped test or permission to bypass the product gate.
@MainActor
enum MobileBridgeTestReadiness {
    /// Hosted tests can start before SwiftUI connects its first scene. Retain a
    /// real test window instead of exercising WebKit in an unattached view.
    static func attach(_ webView: WKWebView) async throws -> UIWindow {
        for _ in 0..<250 {
            if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
                let window = UIWindow(windowScene: scene)
                let controller = UIViewController()
                controller.view = webView
                window.rootViewController = controller
                window.makeKeyAndVisible()
                return window
            }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        throw NSError(domain: "MobileBridgeTestReadiness", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Native bridge test host has no connected window scene"])
    }

    static func require(_ webView: WKWebView, origin: URL) async throws {
        for _ in 0..<100 {
            if UIApplication.shared.applicationState == .active,
               let current = webView.url, LopuVoiceContract.sameOrigin(current, origin) { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        let state: String
        switch UIApplication.shared.applicationState {
        case .active: state = "active"
        case .inactive: state = "inactive"
        case .background: state = "background"
        @unknown default: state = "unknown"
        }
        let sameOrigin = webView.url.map { LopuVoiceContract.sameOrigin($0, origin) } ?? false
        throw NSError(domain: "MobileBridgeTestReadiness", code: 1, userInfo: [NSLocalizedDescriptionKey:
            "Native bridge prerequisite failed: appState=\(state), pageOriginMatches=\(sameOrigin), " +
            "pageURLPresent=\(webView.url != nil), loading=\(webView.isLoading), attachedToWindow=\(webView.window != nil), " +
            "sceneStates=\(UIApplication.shared.connectedScenes.map { $0.activationState.rawValue }.sorted())"])
    }
}
