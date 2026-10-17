import AppleFileSync
import WebKit

/// Request-owned native byte transport shared by explicit exports and sync.
/// Only the selected origin and pinned WebView session can supply data. Cookie
/// changes cancel in-flight work; caller owns navigation/foreground/grant checks.
@MainActor
final class NativeFileSession: NSObject, WKHTTPCookieStoreObserver {
    private let session: URLSession
    private let scope: FileSyncOwnerScope
    private let cookieStore: WKHTTPCookieStore
    private let filterCookies: ([HTTPCookie], URL) -> [HTTPCookie]
    private let check: () throws -> Void
    private let invalidated: () -> Void
    private var pinnedCookie: String?
    private var closed = false
    private var identityWatch: Task<Void, Never>?

    init(scope: FileSyncOwnerScope, cookieStore: WKHTTPCookieStore,
         cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
         check: @escaping () throws -> Void, invalidated: @escaping () -> Void,
         configuration: URLSessionConfiguration = .ephemeral) {
        self.scope = scope; self.cookieStore = cookieStore; self.filterCookies = cookies
        self.check = check; self.invalidated = invalidated
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false; configuration.urlCache = nil
        session = URLSession(configuration: configuration, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
        super.init()
    }
    deinit { identityWatch?.cancel(); session.invalidateAndCancel() }
    func close() {
        guard !closed else { return }
        closed = true; identityWatch?.cancel(); identityWatch = nil
        cookieStore.remove(self); pinnedCookie = nil; session.invalidateAndCancel()
    }
    private func checkActive() throws {
        try Task.checkCancellation(); guard !closed else { throw CancellationError() }; try check()
    }
    func open() async throws {
        try checkActive(); cookieStore.add(self)
        let all = await cookieStore.allCookies(); try checkActive()
        pinnedCookie = try Self.authenticationCookie(filterCookies(all, scope.origin.appendingPathComponent("api/v1/auth/me")))
        // Read again after installing the pin so a concurrent cookie update is
        // checked even if its observer callback ran while the pin was absent.
        try await verifyOwner()
        // WKHTTPCookieStore does not consistently notify observers for native
        // setCookie/delete calls. Bound detection during network waits and pickers
        // as well; every read still checks immediately before and after its bytes.
        identityWatch = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 250_000_000) } catch { return }
                guard let self else { return }
                await self.invalidateIfIdentityChanged()
            }
        }
    }
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        Task { [weak self] in await self?.invalidateIfIdentityChanged() }
    }
    private func invalidateIfIdentityChanged() async {
        guard !closed, let pinned = pinnedCookie else { return }
        let all = await cookieStore.allCookies()
        guard !closed else { return }
        let url = scope.origin.appendingPathComponent("api/v1/auth/me")
        if (try? checkActive()) == nil || (try? Self.authenticationCookie(filterCookies(all, url))) != pinned {
            close(); invalidated()
        }
    }
    // Only authentication changes invalidate work; unrelated cookies may refresh.
    static func authenticationCookie(_ cookies: [HTTPCookie]) throws -> String {
        let matches = cookies.filter { $0.name == "tt_auth" }
        guard matches.count == 1, let value = matches.first?.value, !value.isEmpty, value.utf8.count <= 16_384,
              value.unicodeScalars.allSatisfy({ (0x21...0x7e).contains($0.value) && !";,\\\"".unicodeScalars.contains($0) }) else {
            throw MobileDevicePairing.Failure.identity
        }
        return "tt_auth=" + value
    }
    func verifyOwner() async throws {
        let identity = try await json("/api/v1/auth/me")
        guard let user = identity["user"] as? [String: Any], user["id"] as? String == scope.ownerId,
              user["accountKind"] as? String == "user", user["temporary"] as? Bool != true else { throw MobileDevicePairing.Failure.identity }
    }
    func require(_ requirements: [(String, [Int])]) async throws {
        let manifest = try await json(LopuVoiceContract.manifestPath)
        guard requirements.allSatisfy({ LopuVoiceContract.accepts(manifest, baseURL: scope.origin, feature: $0.0, minimum: $0.1) }) else {
            throw MobileDevicePairing.Failure.incompatible
        }
    }
    func json(_ path: String) async throws -> [String: Any] {
        let data = try await read(path, limit: 512 * 1024) {
            guard $0.statusCode == 200 else { throw MobileFolderStore.Failure.unavailable }
        }
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MobileFolderStore.Failure.invalid }
        return value
    }
    func read(_ path: String, limit: Int,
                      validate: @escaping @Sendable (HTTPURLResponse) throws -> Void) async throws -> Data {
        try checkActive()
        guard limit > 0, limit <= FileVersionExport.rangeBytes, path.hasPrefix("/"), !path.hasPrefix("//"),
              let pinned = pinnedCookie,
              let url = URL(string: path, relativeTo: scope.origin)?.absoluteURL, LopuVoiceContract.sameOrigin(url, scope.origin) else { throw CancellationError() }
        let all = await cookieStore.allCookies(); try checkActive()
        guard try Self.authenticationCookie(filterCookies(all, url)) == pinned else { throw MobileDevicePairing.Failure.identity }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue(pinned, forHTTPHeaderField: "Cookie"); request.setValue(scope.origin.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue(scope.ownerId, forHTTPHeaderField: "X-Thingtime-Expected-Actor")
        request.setValue("home", forHTTPHeaderField: "X-Thingtime-Expected-Data-Plane")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let immutableRequest = request
        let reader = Task.detached { [session] in
            let (bytes, response) = try await session.bytes(for: immutableRequest)
            guard let http = response as? HTTPURLResponse, http.url == url else { throw MobileFolderStore.Failure.invalid }
            try validate(http)
            var data = Data(); data.reserveCapacity(min(limit, FileVersionExport.rangeBytes))
            for try await byte in bytes {
                try Task.checkCancellation()
                guard data.count < limit else { throw MobileFolderStore.Failure.limit }; data.append(byte)
            }
            return data
        }
        let data = try await withTaskCancellationHandler(operation: { try await reader.value }, onCancel: { reader.cancel() })
        try checkActive()
        let latest = await cookieStore.allCookies(); try checkActive()
        guard try Self.authenticationCookie(filterCookies(latest, url)) == pinned else { throw MobileDevicePairing.Failure.identity }
        return data
    }
}
