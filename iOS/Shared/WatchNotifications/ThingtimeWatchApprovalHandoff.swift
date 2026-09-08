import Foundation

/// Only the approval-inbox handoff crosses WatchConnectivity. The reusable
/// Watch credential and the device claim secret are deliberately absent.
struct ThingtimeWatchApprovalHandoff: Equatable, Sendable {
    static let kind = "watch-approval-offer-v1"
    let pairingID: String
    let userCode: String
    let approvalToken: String
    let origin: String
    let expiresAt: String

    var message: [String: Any] {
        ["kind": Self.kind, "pairingId": pairingID, "userCode": userCode,
         "approvalToken": approvalToken, "origin": origin, "expiresAt": expiresAt]
    }

    static func decode(_ message: [String: Any]) -> Self? {
        guard message["kind"] as? String == kind,
              let pairingID = message["pairingId"] as? String, !pairingID.isEmpty, pairingID.count <= 160,
              let code = message["userCode"] as? String, code.range(of: "^[0-9]{4}$", options: .regularExpression) != nil,
              let token = message["approvalToken"] as? String, token.range(of: "^ttapprove_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let origin = message["origin"] as? String, let url = URL(string: origin), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              url.path.isEmpty || url.path == "/", url.query == nil, url.fragment == nil,
              let expiresAt = message["expiresAt"] as? String else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let expiry = formatter.date(from: expiresAt), expiry > Date(), expiry.timeIntervalSinceNow <= 600 else { return nil }
        return Self(pairingID: pairingID, userCode: code, approvalToken: token, origin: origin.trimmingCharacters(in: CharacterSet(charactersIn: "/")), expiresAt: expiresAt)
    }
}
