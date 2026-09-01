import Foundation

/// The installed-app OAuth callback is intentionally handled outside the web
/// bridge. A browser may invoke this URL, but only the signed Commander host
/// can forward it to the daemon using the per-launch native credential.
enum CommanderOAuthCallback {
  static let scheme = "com.thingtime.commander"
  static let redirectURI = "\(scheme)://oauth/callback"
  private static let maximumCodeCharacters = 4096
  private static let maximumStateCharacters = 512
  private static let maximumErrorCharacters = 1024

  static func isValid(_ url: URL) -> Bool {
    guard url.scheme?.lowercased() == scheme,
          url.host?.lowercased() == "oauth",
          url.path == "/callback",
          url.port == nil,
          url.user == nil,
          url.password == nil,
          url.fragment == nil,
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return false
    }

    let items = components.queryItems ?? []
    let grouped = Dictionary(grouping: items, by: \.name)
    guard grouped.values.allSatisfy({ $0.count == 1 }),
          let state = grouped["state"]?.first?.value,
          state.count >= 16,
          state.count <= maximumStateCharacters else {
      return false
    }

    let code = grouped["code"]?.first?.value
    let error = grouped["error"]?.first?.value
    guard (code == nil) != (error == nil) else { return false }
    if let code { return !code.isEmpty && code.count <= maximumCodeCharacters }
    guard let error, !error.isEmpty, error.count <= maximumErrorCharacters else { return false }
    return grouped["error_description"]?.first?.value.map { $0.count <= maximumErrorCharacters } ?? true
  }
}

struct OAuthCallbackHandoff {
  private let daemonURL: URL
  private let nativeToken: String

  init(ready: DaemonReady) {
    daemonURL = URL(string: ready.url)!
    nativeToken = ready.nativeToken
  }

  func deliver(_ callback: URL) async throws {
    guard CommanderOAuthCallback.isValid(callback) else {
      throw OAuthCallbackHandoffError.invalidCallback
    }
    guard let url = URL(string: "/api/native/oauth/callback", relativeTo: daemonURL) else {
      throw OAuthCallbackHandoffError.invalidDaemonResponse
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 10
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(nativeToken, forHTTPHeaderField: "X-Commander-Native")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["callbackUrl": callback.absoluteString])
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw OAuthCallbackHandoffError.invalidDaemonResponse }
    guard (200..<300).contains(http.statusCode) else {
      let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      throw OAuthCallbackHandoffError.daemon(body?["error"] as? String ?? "Commander could not finish sign-in")
    }
  }
}

private enum OAuthCallbackHandoffError: LocalizedError {
  case invalidCallback
  case invalidDaemonResponse
  case daemon(String)

  var errorDescription: String? {
    switch self {
    case .invalidCallback: "Commander rejected an invalid sign-in callback."
    case .invalidDaemonResponse: "Commander received an invalid response from its local service."
    case .daemon(let message): message
    }
  }
}
