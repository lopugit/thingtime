import XCTest

@MainActor
final class BackgroundPhotoSuspensionUITests: XCTestCase {
    func testNormallyLaunchedFixtureBecomesSuspended() async throws {
        guard ProcessInfo.processInfo.environment["THINGTIME_BACKGROUND_SUSPENSION_PROBE"] == "1" else {
            throw XCTSkip("Opt in after normally launching the isolated daemon fixture")
        }
        let app = XCUIApplication(bundleIdentifier: "com.thingtime.photos-background-acceptance")
        guard app.state == .notRunning else {
            XCTFail("The target must start through the normal launcher after the observer is ready")
            return
        }
        FileHandle.standardOutput.write(Data("IOS_BACKGROUND_OBSERVER_READY\n".utf8))
        let deadline = Date().addingTimeInterval(45)
        let statusURL = try XCTUnwrap(URL(string: "http://127.0.0.1:19759/receipt"))
        var detached = false
        while Date() < deadline {
            let (data, _) = try await URLSession.shared.data(from: statusURL)
            let receipt = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            if app.state == .runningForeground, receipt?["appDetached"] as? Bool == true,
               receipt?["phase"] as? String == "held" {
                detached = true
                break
            }
            try await Task.sleep(for: .milliseconds(200))
        }
        guard detached else {
            XCTFail("Normally launch the fixture and detach its waiter before pressing Home")
            return
        }
        XCUIDevice.shared.press(.home)
        let suspended = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.state == .runningBackgroundSuspended
        }, object: nil)
        let result = await XCTWaiter.fulfillment(of: [suspended], timeout: 45)
        guard result == .completed else {
            XCTFail("The target must actually suspend before attributing further bytes to its transfer daemon")
            return
        }
        FileHandle.standardOutput.write(Data("IOS_BACKGROUND_TARGET_STATE: \(app.state.rawValue)\n".utf8))
        let recoveryDeadline = Date().addingTimeInterval(120)
        while Date() < recoveryDeadline {
            let (data, _) = try await URLSession.shared.data(from: statusURL)
            let receipt = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            if receipt?["appVerified"] as? Bool == true {
                FileHandle.standardOutput.write(Data("IOS_BACKGROUND_RECOVERY_OBSERVED\n".utf8))
                return
            }
            try await Task.sleep(for: .milliseconds(200))
        }
        XCTFail("The fixture did not recover the verified daemon receipt before the observer deadline")
    }
}
