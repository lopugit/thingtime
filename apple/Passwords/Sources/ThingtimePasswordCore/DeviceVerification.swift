import Foundation
import LocalAuthentication

public enum PasswordDeviceVerification {
    // Apple's reuse applies to recent Touch ID device unlock. It is not an
    // application-maintained approval cache or proof that a ceremony succeeded.
    public static func reuseDuration(allowed: Bool?, maximum: TimeInterval = LATouchIDAuthenticationMaximumAllowableReuseDuration) -> TimeInterval {
        guard allowed == true, maximum.isFinite, maximum > 0 else { return 0 }
        return min(300, maximum)
    }

    public static func reuseDuration(loadPreference: () async throws -> Bool) async throws -> TimeInterval {
        try Task.checkCancellation()
        let allowed: Bool
        do { allowed = try await loadPreference() }
        catch {
            try Task.checkCancellation()
            if error is CancellationError { throw error }
            // Missing authorization is a failure, not an offline preference.
            if let failure = error as? PasswordProviderError,
               [.invalidSession, .sessionChanged, .sessionUnavailable, .permissionDenied, .cancelled].contains(failure) { throw failure }
            return 0
        }
        try Task.checkCancellation()
        return reuseDuration(allowed: allowed)
    }
}
