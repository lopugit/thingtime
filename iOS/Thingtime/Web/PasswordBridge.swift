import Foundation
import WebKit
import ThingtimePasswordCore
@MainActor final class PasswordBridge {
    private var generation = UUID()
    private var pendingConnection: (ownerId: String, origin: URL)?
    func clear() { generation = UUID(); pendingConnection = nil; PasswordSessionStore.clear(); PasswordIdentityIndex.clear() }
    func handle(action: String, ownerId: String?, webView: WKWebView, root: URL, reply: @escaping (Bool, String) -> Void) {
        guard action != "disconnect", let ownerId, !ownerId.isEmpty else { clear(); reply(true, "Password AutoFill disconnected."); return }
        guard ["connect", "sync"].contains(action), root.scheme == "https", let visible = webView.url, LopuVoiceContract.sameOrigin(visible, root) else { reply(false, "Use your HTTPS Thingtime deployment."); return }
        if action == "sync" {
            if let pending = pendingConnection {
                if pending.ownerId == ownerId, LopuVoiceContract.sameOrigin(pending.origin, root) { reply(true, "Password AutoFill connection is in progress.") }
                else { clear(); reply(true, "Password AutoFill disconnected.") }
                return
            }
            guard let prior = try? PasswordSessionStore.load() else { reply(true, "Password AutoFill is not connected."); return }
            guard prior.ownerId == ownerId, LopuVoiceContract.sameOrigin(prior.origin, root) else { clear(); reply(true, "Password AutoFill disconnected."); return }
        }
        generation = UUID(); let current = generation
        pendingConnection = action == "connect" ? (ownerId, root) : nil
        Task { [weak self, weak webView] in
            guard let self, let webView else { return }
            defer { if current == self.generation { self.pendingConnection = nil } }
            do {
                let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
                let host = root.host?.lowercased() ?? ""
                let matches = cookies.filter { cookie in
                    let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                    return cookie.name == "tt_auth" && cookie.isHTTPOnly && cookie.isSecure && cookie.path == "/" && (host == domain || host.hasSuffix("." + domain)) && (cookie.expiresDate.map { $0 > Date() } ?? true)
                }
                guard matches.count == 1, let cookie = matches.first,
                      var components = URLComponents(url: root, resolvingAgainstBaseURL: false) else { throw PasswordProviderError.invalidSession }
                components.path = ""; components.query = nil; components.fragment = nil
                guard let origin = components.url else { throw PasswordProviderError.invalidSession }
                let session = try ProviderSession(origin: origin, ownerId: ownerId, cookie: "tt_auth=\(cookie.value)")
                let catalog = try await PasswordClient(account: session).catalog()
                guard current == self.generation, let visible = webView.url, LopuVoiceContract.sameOrigin(visible, root) else { reply(false, "Password AutoFill request was replaced. Please try again."); return }
                try PasswordSessionStore.save(session)
                try? await PasswordIdentityIndex.synchronize(catalog)
                guard current == self.generation else { reply(false, "Password AutoFill request was replaced. Please try again."); return }
                reply(true, "Connected. Enable Thingtime in Settings → General → AutoFill & Passwords.")
            } catch {
                if current == self.generation { self.clear(); reply(false, "Could not connect. Sign in to Thingtime and try again.") }
                else { reply(false, "Password AutoFill request was replaced. Please try again.") }
            }
        }
    }
}
