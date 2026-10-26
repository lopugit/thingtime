import Foundation
import WebKit
import ThingtimePasswordCore
@MainActor final class PasswordBridge {
    private var generation = UUID()
    private var pendingConnection: (ownerId: String, origin: URL)?
    @discardableResult func clear() -> Bool {
        generation = UUID(); pendingConnection = nil
        do {
            try PasswordSessionStore.clear()
            PasswordIdentityIndex.clear()
            return true
        } catch { return false }
    }
    private func disconnect(reply: (Bool, String, PasswordConnectionStatus?) -> Void) {
        let cleared = clear()
        reply(cleared, cleared ? "Password AutoFill disconnected." : "Password AutoFill could not be disconnected. Unlock your device and try again.", cleared ? .disconnected : nil)
    }
    private func sessionCookies(_ cookies: [HTTPCookie], root: URL) -> [HTTPCookie] {
        let host = root.host?.lowercased() ?? ""
        return cookies.filter { cookie in
            let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return cookie.name == "tt_auth" && cookie.isHTTPOnly && cookie.isSecure && cookie.path == "/" && (host == domain || host.hasSuffix("." + domain)) && (cookie.expiresDate.map { $0 > Date() } ?? true)
        }
    }
    private func verifyAuthority(_ current: UUID, session: ProviderSession, webView: WKWebView, root: URL, requireStored: Bool = true) async throws {
        guard current == generation, let visible = webView.url, LopuVoiceContract.sameOrigin(visible, root) else { throw PasswordProviderError.invalidSession }
        let cookies = sessionCookies(await webView.configuration.websiteDataStore.httpCookieStore.allCookies(), root: root)
        guard current == generation, let visible = webView.url, LopuVoiceContract.sameOrigin(visible, root),
              cookies.count == 1, "tt_auth=\(cookies[0].value)" == session.cookie else { throw PasswordProviderError.invalidSession }
        if requireStored { guard try PasswordSessionStore.load() == session else { throw PasswordProviderError.invalidSession } }
    }
    func handle(action: String, ownerId: String?, webView: WKWebView, root: URL, reply: @escaping (Bool, String, PasswordConnectionStatus?) -> Void) {
        guard action != "disconnect", let ownerId, !ownerId.isEmpty else { disconnect(reply: reply); return }
        guard ["connect", "sync"].contains(action), root.scheme == "https", let visible = webView.url, LopuVoiceContract.sameOrigin(visible, root) else { reply(false, "Use your HTTPS Thingtime deployment.", nil); return }
        if action == "sync" {
            if let pending = pendingConnection {
                if pending.ownerId == ownerId, LopuVoiceContract.sameOrigin(pending.origin, root) { reply(true, "Password AutoFill connection is in progress.", nil) }
                else { disconnect(reply: reply) }
                return
            }
            guard let prior = try? PasswordSessionStore.load() else { reply(true, PasswordConnectionStatus.disconnected.message, .disconnected); return }
            guard prior.ownerId == ownerId, LopuVoiceContract.sameOrigin(prior.origin, root) else { disconnect(reply: reply); return }
        }
        generation = UUID(); let current = generation
        pendingConnection = action == "connect" ? (ownerId, root) : nil
        Task { [weak self, weak webView] in
            guard let self, let webView else { return }
            defer { if current == self.generation { self.pendingConnection = nil } }
            do {
                let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
                let matches = self.sessionCookies(cookies, root: root)
                guard matches.count == 1, let cookie = matches.first,
                      var components = URLComponents(url: root, resolvingAgainstBaseURL: false) else { throw PasswordProviderError.invalidSession }
                components.path = ""; components.query = nil; components.fragment = nil
                guard let origin = components.url else { throw PasswordProviderError.invalidSession }
                let session = try ProviderSession(origin: origin, ownerId: ownerId, cookie: "tt_auth=\(cookie.value)")
                let catalog = try await PasswordClient(account: session).catalog()
                try await self.verifyAuthority(current, session: session, webView: webView, root: root, requireStored: false)
                try PasswordSessionStore.save(session)
                let status = try await PasswordIdentityIndex.synchronizeConnection(catalog) {
                    try await self.verifyAuthority(current, session: session, webView: webView, root: root)
                }
                guard current == self.generation else { reply(false, "Password AutoFill request was replaced. Please try again.", nil); return }
                reply(true, status.message, status)
            } catch {
                if current == self.generation {
                    let cleared = self.clear()
                    reply(false, cleared ? "Could not connect. Sign in to Thingtime and try again." : "Password AutoFill could not be disconnected. Unlock your device and try again.", nil)
                }
                else { reply(false, "Password AutoFill request was replaced. Please try again.", nil) }
            }
        }
    }
}
