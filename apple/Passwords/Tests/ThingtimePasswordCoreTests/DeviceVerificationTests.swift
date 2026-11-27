import XCTest
import LocalAuthentication
@testable import ThingtimePasswordCore

final class DeviceVerificationTests: XCTestCase {
    func testReuseIsOptInAndClampedToApplesLimit() {
        XCTAssertEqual(PasswordDeviceVerification.reuseDuration(allowed: true, maximum: 600), 300)
        XCTAssertEqual(PasswordDeviceVerification.reuseDuration(allowed: true, maximum: 60), 60)
        for allowed in [false, nil] as [Bool?] {
            XCTAssertEqual(PasswordDeviceVerification.reuseDuration(allowed: allowed), 0)
        }
        for maximum in [0, -1, .infinity, .nan] as [TimeInterval] {
            XCTAssertEqual(PasswordDeviceVerification.reuseDuration(allowed: true, maximum: maximum), 0)
        }
        let context = LAContext()
        context.touchIDAuthenticationAllowableReuseDuration = PasswordDeviceVerification.reuseDuration(allowed: true)
        XCTAssertEqual(context.touchIDAuthenticationAllowableReuseDuration, min(300, LATouchIDAuthenticationMaximumAllowableReuseDuration))
        context.touchIDAuthenticationAllowableReuseDuration = PasswordDeviceVerification.reuseDuration(allowed: false)
        XCTAssertEqual(context.touchIDAuthenticationAllowableReuseDuration, 0)
        context.invalidate()
    }

    func testEveryOperationReadsPreferenceAndCannotRetainPreviouslyEnabledReuse() async throws {
        var reads = 0
        let load = { reads += 1; return reads == 1 }
        let first = try await PasswordDeviceVerification.reuseDuration(loadPreference: load)
        let second = try await PasswordDeviceVerification.reuseDuration(loadPreference: load)
        XCTAssertGreaterThan(first, 0)
        XCTAssertEqual(second, 0)
        XCTAssertEqual(reads, 2)
    }

    func testUnavailableOrMalformedPreferencesRequireFreshAuthentication() async throws {
        for failure in [PasswordProviderError.incompatibleService, .networkUnavailable, .invalidResponse, .serviceUnavailable] {
            let duration = try await PasswordDeviceVerification.reuseDuration { throw failure }
            XCTAssertEqual(duration, 0)
        }
    }

    func testCancellationAndAuthorizationFailuresCannotBecomeFallbackApprovals() async throws {
        for failure in [PasswordProviderError.invalidSession, .sessionChanged, .sessionUnavailable, .permissionDenied, .cancelled] {
            do {
                _ = try await PasswordDeviceVerification.reuseDuration { throw failure }
                XCTFail("Expected request failure")
            } catch { XCTAssertEqual(error as? PasswordProviderError, failure) }
        }
        do {
            _ = try await PasswordDeviceVerification.reuseDuration { throw CancellationError() }
            XCTFail("Expected cancellation")
        } catch { XCTAssertTrue(error is CancellationError) }
    }
}
