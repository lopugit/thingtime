import AppKit
import AuthenticationServices
import Foundation

/// Refuse redirects on credential-bearing API calls, including same-origin ones.
private final class WidgetRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class WidgetConnection: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WidgetConnection()
    @Published private(set) var credential: WidgetCredential?
    @Published private(set) var things: [WidgetThing] = []
    @Published private(set) var busy = false
    @Published var error: String?
    @Published var address: String
    @Published private(set) var origin: URL
    @Published private(set) var lastRefresh: Date?
    @Published var shareContent = WidgetStore.enabled {
        didSet {
            WidgetStore.setEnabled(shareContent)
            if shareContent { publishSnapshot() }
        }
    }
    private var browserSession: ASWebAuthenticationSession?
    private var generation = UUID()
    private let redirectPolicy = WidgetRedirectPolicy()
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 35
        return URLSession(configuration: configuration, delegate: redirectPolicy, delegateQueue: nil)
    }()
    // Registered by the server's built-in native app registry; never a secret.
    static let clientID = "ttapp_thingtime_widgets"

    override init() {
        let value = UserDefaults.standard.string(forKey: "widgets.connection.origin")
            ?? Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String ?? "https://thingtime.com"
        let initialOrigin = (try? WidgetOAuthRequest.normalizeOrigin(value)) ?? URL(string: "https://thingtime.com")!
        origin = initialOrigin
        address = initialOrigin.absoluteString
        super.init()
        do {
            credential = try WidgetCredentialStore.read(origin: origin.absoluteString)
            if let credential, credential.expiresAt <= Date() {
                try WidgetCredentialStore.remove(origin: origin.absoluteString)
                self.credential = nil
            }
            if let snapshot = WidgetStore.read(), snapshot.origin == origin.absoluteString,
               snapshot.owner == credential?.ownerID {
                things = snapshot.things
                lastRefresh = snapshot.date
            } else { WidgetStore.clear() }
        } catch { self.error = error.localizedDescription; WidgetStore.clear() }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
    }

    func cancelSignIn() {
        generation = UUID()
        browserSession?.cancel()
        browserSession = nil
        busy = false
    }

    func connect() {
        guard !busy else { return }
        error = nil
        let proposed: URL
        do { proposed = try WidgetOAuthRequest.normalizeOrigin(address) }
        catch { self.error = error.localizedDescription; return }
        busy = true
        let attempt = UUID()
        generation = attempt
        Task {
            do {
                // Negotiate before activating or persisting a new origin.
                try await checkCapabilities(at: proposed)
                guard generation == attempt else { return }
                let transaction = try WidgetOAuthRequest(origin: proposed, clientID: Self.clientID)
                let auth = ASWebAuthenticationSession(url: transaction.authorizationURL,
                    callbackURLScheme: WidgetOAuthRequest.callback.scheme) { [weak self] callback, failure in
                    Task { @MainActor in
                        guard let self, self.generation == attempt else { return }
                        self.browserSession = nil
                        guard let callback, failure == nil else {
                            self.busy = false
                            self.error = "Sign-in was cancelled. Your existing connection is unchanged."
                            return
                        }
                        await self.finishSignIn(transaction, callback: callback, attempt: attempt)
                    }
                }
                auth.presentationContextProvider = self
                auth.prefersEphemeralWebBrowserSession = false
                browserSession = auth
                guard auth.start() else { throw ConnectionFailure.message("The browser could not start sign-in. Please try again.") }
            } catch {
                guard generation == attempt else { return }
                browserSession = nil
                busy = false
                self.error = error.localizedDescription
            }
        }
    }

    private func finishSignIn(_ transaction: WidgetOAuthRequest, callback: URL, attempt: UUID) async {
        var transaction = transaction
        var pendingToken: String?
        do {
            let body = try transaction.consume(callback)
            let result = try await request(at: transaction.origin, path: "/api/v1/oauth/token", body: body)
            guard let token = result["accessToken"] as? String, !token.isEmpty,
                  let expiresIn = result["expiresIn"] as? Double, expiresIn > 0,
                  result["tokenType"] as? String == "Bearer" else { throw ConnectionFailure.invalidResponse }
            pendingToken = token
            guard generation == attempt else {
                await discardToken(token, at: transaction.origin)
                return
            }
            let profile = try await request(at: transaction.origin, path: "/api/v1/oauth/userinfo", token: token)
            guard let user = profile["user"] as? [String: Any],
                  let id = user["id"] as? String, !id.isEmpty,
                  let username = user["username"] as? String else { throw ConnectionFailure.invalidResponse }
            guard generation == attempt else {
                await discardToken(token, at: transaction.origin)
                return
            }
            let next = WidgetCredential(origin: transaction.origin.absoluteString, accessToken: token,
                expiresAt: Date().addingTimeInterval(expiresIn), ownerID: id,
                displayName: user["displayName"] as? String ?? username, scopes: profile["scopes"] as? [String] ?? [])
            try WidgetCredentialStore.save(next)
            pendingToken = nil
            let previous = credential
            WidgetStore.clear()
            things = []
            lastRefresh = nil
            credential = next
            origin = transaction.origin
            address = origin.absoluteString
            UserDefaults.standard.set(origin.absoluteString, forKey: "widgets.connection.origin")
            busy = false
            if let previous {
                Task { await discardToken(previous.accessToken, at: URL(string: previous.origin)!) }
                if previous.origin != next.origin { try? WidgetCredentialStore.remove(origin: previous.origin) }
            }
            await refresh()
        } catch {
            if let pendingToken { await discardToken(pendingToken, at: transaction.origin) }
            guard generation == attempt else { return }
            busy = false
            self.error = error.localizedDescription
        }
    }

    private func discardToken(_ token: String, at origin: URL) async {
        _ = try? await request(at: origin, path: "/api/v1/oauth/token", token: token, body: ["grantType": "revoke"])
    }

    func refresh() async {
        guard !busy, let credential else { return }
        guard credential.expiresAt > Date() else {
            error = "Your connection expired. Sign in again to refresh your widgets."
            WidgetStore.clear()
            things = []
            return
        }
        busy = true
        let attempt = generation
        defer { if generation == attempt { busy = false } }
        do {
            try await checkCapabilities(at: origin)
            let allThings = credential.scopes.contains("account.things") || credential.scopes.contains("account.things.read")
            guard allThings || credential.scopes.contains("things") else {
                things = []
                lastRefresh = nil
                WidgetStore.clear()
                error = "To display Things, change permissions and approve read access or choose individual Things."
                return
            }
            let result = try await request(at: origin, path: allThings ? "/api/v1/things?limit=50" : "/api/v1/oauth/shared", token: credential.accessToken)
            guard generation == attempt else { return }
            guard let rows = result["things"] as? [[String: Any]] else { throw ConnectionFailure.invalidResponse }
            things = rows.prefix(50).compactMap { row in
                guard let id = (row["id"] ?? row["shareId"]) as? String,
                      WidgetRoute.path(for: WidgetRoute.url(action: .things, thingID: id)) != nil else { return nil }
                let crystal = row["crystal"] as? [String: Any] ?? [:]
                func string(_ value: Any?, _ limit: Int) -> String { String((value as? String ?? "").prefix(limit)) }
                return WidgetThing(id: id, title: string(crystal["name"] ?? crystal["title"] ?? "Untitled Thing", 160),
                    text: string(crystal["text"] ?? crystal["description"], 1200),
                    kind: string((row["thingtime"] as? [String])?.first, 40),
                    value: string((crystal["value"] as? NSNumber)?.stringValue ?? crystal["value"], 100))
            }
            lastRefresh = Date()
            error = nil
            publishSnapshot()
        } catch {
            guard generation == attempt else { return }
            if case ConnectionFailure.unauthorized = error {
                WidgetStore.clear()
                things = []
            }
            self.error = error.localizedDescription
        }
    }

    func disconnect() {
        cancelSignIn()
        let oldCredential = credential
        let oldOrigin = origin
        do {
            try WidgetCredentialStore.remove(origin: origin.absoluteString)
            credential = nil
            things = []
            lastRefresh = nil
            WidgetStore.clear()
            error = nil
            if let oldCredential {
                let attempt = generation
                Task {
                    do {
                        _ = try await request(at: oldOrigin, path: "/api/v1/oauth/token",
                            token: oldCredential.accessToken, body: ["grantType": "revoke"])
                    } catch {
                        guard generation == attempt else { return }
                        if case ConnectionFailure.unauthorized = error { return }
                        self.error = "Disconnected locally. The server could not confirm revocation; revoke Thingtime Widgets in your account’s connected apps."
                    }
                }
            }
        } catch { self.error = error.localizedDescription }
    }

    func open(_ url: URL) {
        guard let path = WidgetRoute.path(for: url), let target = URL(string: path, relativeTo: origin)?.absoluteURL else { return }
        NSWorkspace.shared.open(target)
    }
    func takePending() { if let url = WidgetActionInbox.take() { open(url) } }

    private func publishSnapshot() {
        guard shareContent, let credential, let lastRefresh, Date().timeIntervalSince(lastRefresh) < 1800 else { return }
        WidgetStore.save(["owner": credential.ownerID, "things": things.map {
            ["id": $0.id, "title": $0.title, "text": $0.text, "kind": $0.kind, "value": $0.value]
        }], origin: origin.absoluteString, date: lastRefresh)
    }

    private func checkCapabilities(at origin: URL) async throws {
        let manifest = try await request(at: origin, path: "/.well-known/thingtime-capabilities.json", envelope: false)
        guard manifest["schemaVersion"] as? Int == 1, manifest["origin"] as? String == origin.absoluteString,
              let features = manifest["features"] as? [String: [String: Any]] else {
            throw ConnectionFailure.message("This server does not publish a compatible Thingtime capability manifest.")
        }
        let requirements = ["api.apps-public": [1, 1, 0], "api.oauth-desktop-authorize": [1, 2, 0],
                            "api.oauth-token": [1, 2, 0], "api.oauth-userinfo": [1, 0, 0], "api.oauth-shared": [1, 0, 0], "api.oauth-scopes": [1, 1, 0], "api.things": [1, 10, 0]]
        for (feature, minimum) in requirements {
            guard let version = features[feature]?["version"] as? String, Self.compatible(version, minimum: minimum) else {
                throw ConnectionFailure.message("This Thingtime server needs an update before it can connect Widgets.")
            }
        }
    }

    static func compatible(_ version: String, minimum: [Int]) -> Bool {
        let segments = version.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3, segments.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }) else { return false }
        let parts = segments.compactMap { Int($0) }
        guard parts.count == 3, minimum.count == 3, parts[0] == minimum[0] else { return false }
        return parts[1] > minimum[1] || (parts[1] == minimum[1] && parts[2] >= minimum[2])
    }

    private enum ConnectionFailure: LocalizedError {
        case unauthorized, invalidResponse, message(String)
        var errorDescription: String? {
            switch self {
            case .unauthorized: return "This connection is no longer authorized. Please sign in again."
            case .invalidResponse: return "Thingtime returned an unexpected response. Please try again."
            case .message(let message): return message
            }
        }
    }
    private func request(at origin: URL, path: String, token: String? = nil,
                         body: [String: String]? = nil, envelope: Bool = true) async throws -> [String: Any] {
        guard let url = URL(string: path, relativeTo: origin)?.absoluteURL else { throw ConnectionFailure.invalidResponse }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ConnectionFailure.invalidResponse }
        if http.statusCode == 401 { throw ConnectionFailure.unauthorized }
        guard (200..<300).contains(http.statusCode), data.count <= 2_000_000,
              let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              !envelope || result["ok"] as? Bool == true else { throw ConnectionFailure.invalidResponse }
        return result
    }
}
